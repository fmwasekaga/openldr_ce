import { describe, expect, it, vi } from 'vitest';
import type { ChangeRow, Logger, SafeFetchResult } from '@openldr/db';
import type { FhirResource } from '@openldr/fhir';
import { createSyncPushRunner, type PushDeps } from './push-worker';
import type { PushBatch } from './batch';

const row = (seq: number, xid: number, id: string, op = 'upsert'): ChangeRow => ({
  seq,
  xid,
  resource_type: 'Patient',
  resource_id: id,
  op,
});

// Minimal fake Kysely answering only the runner's change_log version/site_id read. It HONORS the
// `where('seq','>',lo).where('seq','<=',hi)` bounds the runner applies, so a seq deliberately left out
// of `metaRows` (or filtered out of range) is genuinely absent — exercising the missing-meta skip path.
function fakeDb(metaRows: { seq: number; version: number; site_id: string | null }[]): PushDeps['internalDb'] {
  let lo = Number.NEGATIVE_INFINITY;
  let hi = Number.POSITIVE_INFINITY;
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.where = (col: string, op: string, val: number) => {
    if (col === 'seq' && op === '>') lo = val;
    if (col === 'seq' && op === '<=') hi = val;
    return chain;
  };
  chain.execute = async () => metaRows.filter((m) => m.seq > lo && m.seq <= hi);
  return { selectFrom: () => chain } as unknown as PushDeps['internalDb'];
}

function fakeLogger(): Logger & { warns: unknown[]; errors: unknown[] } {
  const warns: unknown[] = [];
  const errors: unknown[] = [];
  return {
    warns,
    errors,
    info() {},
    debug() {},
    warn(o: unknown) {
      warns.push(o);
    },
    error(o: unknown) {
      errors.push(o);
    },
  };
}

// A safe-frontier fetch that dispenses canned SafeFetchResults per cycle (mirrors what
// fetchSafeChangeRows would return from real PG), so the runner genuinely drives planProjection.
function fetchQueue(results: SafeFetchResult[]): PushDeps['fetchSafeRows'] {
  let i = 0;
  return async () => results[Math.min(i++, results.length - 1)];
}

const okContent: PushDeps['fetchContent'] = async (resourceType, id, version) =>
  ({ resourceType, id, meta: { versionId: String(version) } }) as unknown as FhirResource;

describe('createSyncPushRunner', () => {
  it('builds one SyncRecord per safe change row (upsert carries resource, delete does not; siteId copied)', async () => {
    const pushes: { batch: PushBatch; token: string }[] = [];
    let advancedTo: number | undefined;
    const deps: PushDeps = {
      internalDb: fakeDb([
        { seq: 1, version: 5, site_id: 'lab-a' },
        { seq: 2, version: 6, site_id: 'lab-a' },
      ]),
      fetchSafeRows: fetchQueue([{ rows: [row(1, 10, 'p1', 'upsert'), row(2, 10, 'p2', 'delete')], boundary: 100, xmax: 200 }]),
      fetchContent: okContent,
      postPush: async (batch, token) => {
        pushes.push({ batch, token });
        return { ackSeq: 2, applied: 2, skipped: 0, rejects: [] };
      },
      getToken: async () => 'tok-123',
      readCursor: async () => 0,
      advanceCursor: async (s) => {
        advancedTo = s;
      },
      logger: fakeLogger(),
    };

    const result = await createSyncPushRunner(deps).runCycle();

    expect(pushes).toHaveLength(1);
    expect(pushes[0].token).toBe('tok-123');
    expect(pushes[0].batch.fromSeq).toBe(0);
    const recs = pushes[0].batch.records;
    expect(recs).toHaveLength(2);
    // upsert: full record with resource + copied siteId/version/seq
    expect(recs[0]).toMatchObject({ resourceType: 'Patient', id: 'p1', version: 5, op: 'upsert', siteId: 'lab-a', seq: 1 });
    expect(recs[0].resource).toBeDefined();
    // delete: no resource, siteId still copied
    expect(recs[1]).toMatchObject({ resourceType: 'Patient', id: 'p2', version: 6, op: 'delete', siteId: 'lab-a', seq: 2 });
    expect(recs[1].resource).toBeUndefined();
    expect(advancedTo).toBe(2);
    expect(result.outcome).toBe('progressed');
    expect(result.applied).toBe(2);
  });

  it('advances the cursor to central ackSeq on success (not the local frontier)', async () => {
    let advancedTo: number | undefined;
    const deps: PushDeps = {
      internalDb: fakeDb([
        { seq: 1, version: 1, site_id: 's' },
        { seq: 2, version: 1, site_id: 's' },
        { seq: 3, version: 1, site_id: 's' },
      ]),
      // all three safe → local frontier would be 3, but central only acks 2
      fetchSafeRows: fetchQueue([{ rows: [row(1, 10, 'p1'), row(2, 10, 'p2'), row(3, 10, 'p3')], boundary: 100, xmax: 200 }]),
      fetchContent: okContent,
      postPush: async () => ({ ackSeq: 2, applied: 2, skipped: 0, rejects: [] }),
      getToken: async () => 't',
      readCursor: async () => 0,
      advanceCursor: async (s) => {
        advancedTo = s;
      },
      logger: fakeLogger(),
    };

    await createSyncPushRunner(deps).runCycle();
    expect(advancedTo).toBe(2); // ackSeq, not the frontier (3)
  });

  it('does NOT advance the cursor when postPush throws (retry next cycle)', async () => {
    const readCursor = vi.fn(async () => 0);
    const advanceCursor = vi.fn(async () => {});
    const logger = fakeLogger();
    const deps: PushDeps = {
      internalDb: fakeDb([{ seq: 1, version: 1, site_id: 's' }]),
      fetchSafeRows: fetchQueue([{ rows: [row(1, 10, 'p1')], boundary: 100, xmax: 200 }]),
      fetchContent: okContent,
      postPush: async () => {
        throw new Error('ECONNREFUSED');
      },
      getToken: async () => 't',
      readCursor,
      advanceCursor,
      logger,
    };

    const result = await createSyncPushRunner(deps).runCycle();
    expect(result.outcome).toBe('failed');
    expect(result.applied).toBe(0);
    expect(readCursor).toHaveBeenCalledTimes(1);
    expect(advanceCursor).not.toHaveBeenCalled();
    expect(logger.errors).toHaveLength(1);
  });

  it('quarantines a persistently-rejected record: logs it AND still advances past it', async () => {
    let advancedTo: number | undefined;
    const logger = fakeLogger();
    const deps: PushDeps = {
      internalDb: fakeDb([
        { seq: 1, version: 1, site_id: 's' },
        { seq: 2, version: 6, site_id: 's' },
      ]),
      fetchSafeRows: fetchQueue([{ rows: [row(1, 10, 'p1'), row(2, 10, 'p2')], boundary: 100, xmax: 200 }]),
      fetchContent: okContent,
      // central applied p1, rejected p2 — but acks past both so the reject never replays
      postPush: async () => ({ ackSeq: 2, applied: 1, skipped: 0, rejects: [{ id: 'p2', version: 6, seq: 2, reason: 'schema-invalid' }] }),
      getToken: async () => 't',
      readCursor: async () => 0,
      advanceCursor: async (s) => {
        advancedTo = s;
      },
      logger,
    };

    const result = await createSyncPushRunner(deps).runCycle();
    expect(result.outcome).toBe('progressed');
    expect(result.applied).toBe(1);
    expect(advancedTo).toBe(2); // advanced PAST the rejected seq 2 — never blocks the stream
    expect(logger.warns).toHaveLength(1);
    expect(logger.warns[0]).toMatchObject({ id: 'p2', version: 6, seq: 2, reason: 'schema-invalid' });
  });

  it('reuses the projection safe-frontier: emits only the safe prefix and carries pendingGaps across cycles', async () => {
    // Cycle 1 mirrors plan.test.ts "invisible in-flight gap below an unsafe row": seq6 is an invisible
    // gap observed with x0 = xmax = 100; seq5 is safe. Only p5 is emitted; the gap is carried forward.
    // Cycle 2 then CONFIRMS gap6 rolled back because boundary(150) >= carried x0(100) and emits p7.
    // If pendingGaps were NOT carried, cycle 2 would re-observe gap6 fresh with x0 = xmax = 200 > 150,
    // re-block, and never emit p7 — so emitting p7 proves the carry routes through planProjection.
    const pushes: PushBatch[] = [];
    let cursorVal = 4;
    const advanceCalls: number[] = [];
    const deps: PushDeps = {
      internalDb: fakeDb([
        { seq: 5, version: 1, site_id: 's' },
        { seq: 7, version: 2, site_id: 's' },
      ]),
      fetchSafeRows: fetchQueue([
        { rows: [row(5, 50, 'p5'), row(7, 80, 'p7')], boundary: 60, xmax: 100 }, // cycle 1: gap at 6, x0=100
        { rows: [row(7, 80, 'p7')], boundary: 150, xmax: 200 }, // cycle 2: boundary now >= 100 → gap6 confirmed
      ]),
      fetchContent: okContent,
      postPush: async (batch) => {
        pushes.push(batch);
        const last = batch.records[batch.records.length - 1];
        return { ackSeq: last.seq, applied: batch.records.length, skipped: 0, rejects: [] };
      },
      getToken: async () => 't',
      readCursor: async () => cursorVal,
      advanceCursor: async (s) => {
        cursorVal = s;
        advanceCalls.push(s);
      },
      logger: fakeLogger(),
    };

    const runner = createSyncPushRunner(deps);

    const result1 = await runner.runCycle();
    expect(result1.outcome).toBe('progressed');
    expect(result1.applied).toBe(1);
    expect(pushes[0].records.map((r) => r.id)).toEqual(['p5']); // only the SAFE prefix (seq7 > frontier 5)
    expect(pushes[0].records[0].seq).toBe(5);
    expect(cursorVal).toBe(5);

    const result2 = await runner.runCycle();
    expect(result2.outcome).toBe('progressed');
    expect(result2.applied).toBe(1);
    expect(pushes[1].records.map((r) => r.id)).toEqual(['p7']); // gap6 confirmed via CARRIED pendingGaps
    expect(pushes[1].records[0].seq).toBe(7);
    expect(cursorVal).toBe(7);
  });

  it('getToken failure behaves like a transport outage: logged, no advance, returns 0', async () => {
    const readCursor = vi.fn(async () => 0);
    const advanceCursor = vi.fn(async () => {});
    const postPush = vi.fn(async () => ({ ackSeq: 1, applied: 1, skipped: 0, rejects: [] }));
    const logger = fakeLogger();
    const deps: PushDeps = {
      internalDb: fakeDb([{ seq: 1, version: 1, site_id: 's' }]),
      fetchSafeRows: fetchQueue([{ rows: [row(1, 10, 'p1')], boundary: 100, xmax: 200 }]),
      fetchContent: okContent,
      postPush,
      getToken: async () => {
        throw new Error('token endpoint 503');
      },
      readCursor,
      advanceCursor,
      logger,
    };

    const result = await createSyncPushRunner(deps).runCycle();
    expect(result.outcome).toBe('failed');
    expect(result.applied).toBe(0);
    expect(postPush).not.toHaveBeenCalled(); // failed before transport
    expect(advanceCursor).not.toHaveBeenCalled();
    expect(logger.errors).toHaveLength(1);
  });

  it('skips a bodiless upsert (fetchContent null): record excluded, warn logged, others still sent', async () => {
    const pushes: PushBatch[] = [];
    let advancedTo: number | undefined;
    const logger = fakeLogger();
    const deps: PushDeps = {
      internalDb: fakeDb([
        { seq: 1, version: 1, site_id: 's' },
        { seq: 2, version: 2, site_id: 's' },
      ]),
      fetchSafeRows: fetchQueue([{ rows: [row(1, 10, 'p1', 'upsert'), row(2, 10, 'p2', 'upsert')], boundary: 100, xmax: 200 }]),
      // p1's content has vanished → null; p2 resolves normally
      fetchContent: async (resourceType, id, version) =>
        id === 'p1' ? null : (({ resourceType, id, meta: { versionId: String(version) } }) as unknown as FhirResource),
      postPush: async (batch) => {
        pushes.push(batch);
        return { ackSeq: 2, applied: 1, skipped: 0, rejects: [] };
      },
      getToken: async () => 't',
      readCursor: async () => 0,
      advanceCursor: async (s) => {
        advancedTo = s;
      },
      logger,
    };

    const result = await createSyncPushRunner(deps).runCycle();
    expect(pushes).toHaveLength(1);
    expect(pushes[0].records.map((r) => r.id)).toEqual(['p2']); // p1 skipped, not a bodiless upsert
    expect(logger.warns.some((w) => (w as { id?: string }).id === 'p1')).toBe(true);
    expect(advancedTo).toBe(2); // cursor still advances past the skipped record (quarantine)
    expect(result.outcome).toBe('progressed');
    expect(result.applied).toBe(1);
  });

  it('skips records with null site_id (M1) or missing meta (M2); an all-skipped cycle advances without pushing', async () => {
    let pushed = false;
    let advancedTo: number | undefined;
    const logger = fakeLogger();
    const deps: PushDeps = {
      internalDb: fakeDb([
        { seq: 1, version: 1, site_id: null }, // M1: null site_id
        // seq 2 intentionally omitted → M2: missing meta
      ]),
      fetchSafeRows: fetchQueue([{ rows: [row(1, 10, 'p1', 'upsert'), row(2, 10, 'p2', 'upsert')], boundary: 100, xmax: 200 }]),
      fetchContent: okContent,
      postPush: async () => {
        pushed = true;
        return { ackSeq: 2, applied: 0, skipped: 0, rejects: [] };
      },
      getToken: async () => 't',
      readCursor: async () => 0,
      advanceCursor: async (s) => {
        advancedTo = s;
      },
      logger,
    };

    const result = await createSyncPushRunner(deps).runCycle();
    // The cursor ADVANCED (see advancedTo below), so per spec §5.1.1 this is 'progressed', not 'drained'
    // — 'drained' would stop the host's drain loop even though there is more backlog to collect at the
    // new cursor. See the dedicated regression test below for the full failure scenario this guards.
    expect(result.outcome).toBe('progressed');
    expect(result.applied).toBe(0);
    expect(pushed).toBe(false); // nothing pushed — every record was a defensive skip
    expect(logger.warns).toHaveLength(2); // one for null site_id, one for missing meta
    expect(advancedTo).toBe(2); // frontier still advances so the bad rows are not re-scanned forever
  });

  it('a guard-skipped window that advances the cursor reports progressed, not drained (regression: 30h backlog-drain bug)', async () => {
    // Scenario from the slice's headline use case: a lab bulk-imports a large backlog BEFORE
    // sync.site_id is set, so every imported change_log row carries site_id = null. Sync is then
    // enabled. Each cycle: fetchSafeRows returns a full window, every row is skipped by the M1 null
    // site_id guard, but newCursor > cursor (the frontier still moved past the skipped window). If this
    // reported 'drained', the host drain loop would stop after ONE window per tick — the exact pre-S7
    // rate (500 records / 15 min tick) this slice exists to fix. It must report 'progressed' so the
    // drain loop re-reads the cursor and keeps collecting new windows within the same time budget.
    let pushed = false;
    let advancedTo: number | undefined;
    const logger = fakeLogger();
    const deps: PushDeps = {
      internalDb: fakeDb([
        { seq: 1, version: 1, site_id: null },
        { seq: 2, version: 1, site_id: null },
      ]),
      fetchSafeRows: fetchQueue([{ rows: [row(1, 10, 'p1', 'upsert'), row(2, 10, 'p2', 'upsert')], boundary: 100, xmax: 200 }]),
      fetchContent: okContent,
      postPush: async () => {
        pushed = true;
        return { ackSeq: 2, applied: 0, skipped: 0, rejects: [] };
      },
      getToken: async () => 't',
      readCursor: async () => 0,
      advanceCursor: async (s) => {
        advancedTo = s;
      },
      logger,
    };

    const result = await createSyncPushRunner(deps).runCycle();
    expect(result.outcome).toBe('progressed'); // cursor advanced → drain loop must continue
    expect(result.applied).toBe(0);
    expect(pushed).toBe(false); // nothing pushed — every record was a defensive skip
    expect(advancedTo).toBe(2); // frontier advanced past the all-guard-skipped window
  });

  it('clamps a central ackSeq beyond the local frontier to newCursor (I2)', async () => {
    let advancedTo: number | undefined;
    const deps: PushDeps = {
      internalDb: fakeDb([
        { seq: 1, version: 1, site_id: 's' },
        { seq: 2, version: 1, site_id: 's' },
      ]),
      fetchSafeRows: fetchQueue([{ rows: [row(1, 10, 'p1'), row(2, 10, 'p2')], boundary: 100, xmax: 200 }]),
      fetchContent: okContent,
      // buggy/hostile central acks far past what the lab pushed (frontier is 2)
      postPush: async () => ({ ackSeq: 999, applied: 2, skipped: 0, rejects: [] }),
      getToken: async () => 't',
      readCursor: async () => 0,
      advanceCursor: async (s) => {
        advancedTo = s;
      },
      logger: fakeLogger(),
    };

    await createSyncPushRunner(deps).runCycle();
    expect(advancedTo).toBe(2); // clamped to newCursor — NOT 999 (no silent skip past unsent records)
  });

  it('pure-gap cycle (no safe rows): returns 0, pushes nothing, and does not advance the frontier', async () => {
    let pushed = false;
    const advanceCursor = vi.fn(async () => {});
    const deps: PushDeps = {
      internalDb: fakeDb([{ seq: 7, version: 1, site_id: 's' }]),
      // seq6 is a freshly-observed in-flight gap (x0 = xmax 100 > boundary 60) → blocks; seq7 sits above it
      fetchSafeRows: fetchQueue([{ rows: [row(7, 50, 'p7')], boundary: 60, xmax: 100 }]),
      fetchContent: okContent,
      postPush: async (batch) => {
        pushed = true;
        return { ackSeq: batch.records.length, applied: 0, skipped: 0, rejects: [] };
      },
      getToken: async () => 't',
      readCursor: async () => 5,
      advanceCursor,
      logger: fakeLogger(),
    };

    const result = await createSyncPushRunner(deps).runCycle();
    expect(result.outcome).toBe('drained');
    expect(result.applied).toBe(0);
    expect(pushed).toBe(false);
    expect(advanceCursor).not.toHaveBeenCalled(); // frontier held before the in-flight gap (newCursor === cursor)
  });

  it('reports drained when there is nothing to push (no network call)', async () => {
    let posted = 0;
    const deps: PushDeps = {
      internalDb: fakeDb([]),
      fetchSafeRows: fetchQueue([{ rows: [], boundary: 0, xmax: 0 }]),
      fetchContent: okContent,
      postPush: async () => {
        posted++;
        throw new Error('must not post');
      },
      getToken: async () => 't',
      readCursor: async () => 0,
      advanceCursor: async () => {},
      logger: fakeLogger(),
    };

    const r = await createSyncPushRunner(deps).runCycle();
    expect(r.outcome).toBe('drained');
    expect(r.applied).toBe(0);
    expect(posted).toBe(0);
  });

  it('reports failed when the transport throws, and does not advance the cursor', async () => {
    let cursor = 0;
    const deps: PushDeps = {
      internalDb: fakeDb([{ seq: 1, version: 1, site_id: 's' }]),
      fetchSafeRows: fetchQueue([{ rows: [row(1, 10, 'p1')], boundary: 100, xmax: 200 }]),
      fetchContent: okContent,
      postPush: async () => {
        throw new Error('central down');
      },
      getToken: async () => 't',
      readCursor: async () => cursor,
      advanceCursor: async (s) => {
        cursor = s;
      },
      logger: fakeLogger(),
    };

    const r = await createSyncPushRunner(deps).runCycle();
    expect(r.outcome).toBe('failed');
    expect(cursor).toBe(0);
  });

  it('reports failed when central acks at or behind the cursor: cursor unmoved, error logged', async () => {
    // A success path with N>0 records ALWAYS has newCursor > cursor, so target <= cursor means the
    // central acked backwards (stale/cached 200, proxy replay, buggy reimplementation, hostile peer).
    // Reporting 'progressed' here would make the drain loop re-post this IDENTICAL window until the
    // budget expires — every tick, forever — because the cursor never moves. 'failed' stops the drain
    // and makes the anomaly operator-visible rather than a silent permanent wedge.
    let cursor = 5;
    const advanceCursor = vi.fn(async (s: number) => {
      cursor = s;
    });
    const logger = fakeLogger();
    const deps: PushDeps = {
      internalDb: fakeDb([
        { seq: 6, version: 1, site_id: 's' },
        { seq: 7, version: 1, site_id: 's' },
      ]),
      fetchSafeRows: fetchQueue([{ rows: [row(6, 10, 'p6'), row(7, 10, 'p7')], boundary: 100, xmax: 200 }]),
      fetchContent: okContent,
      // central acks 5 — at the cursor we already held, behind the two records (seq 6,7) we just sent
      postPush: async () => ({ ackSeq: 5, applied: 2, skipped: 0, rejects: [] }),
      getToken: async () => 't',
      readCursor: async () => cursor,
      advanceCursor,
      logger,
    };

    const r = await createSyncPushRunner(deps).runCycle();
    expect(r.outcome).toBe('failed');
    expect(r.applied).toBe(2); // reporting-only: central may genuinely have applied them
    expect(advanceCursor).not.toHaveBeenCalled();
    expect(cursor).toBe(5); // wedge is now retried + logged, never silently advanced past
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toMatchObject({ ackSeq: 5, cursor: 5, newCursor: 7, count: 2 });
  });

  it('reports progressed on a posted window — even when central applied 0', async () => {
    // The window WAS processed and the cursor advanced; `applied` is reporting only. A drain loop
    // keying off the count would stop here with records still queued.
    const deps: PushDeps = {
      internalDb: fakeDb([{ seq: 1, version: 1, site_id: 's' }]),
      fetchSafeRows: fetchQueue([{ rows: [row(1, 10, 'p1')], boundary: 100, xmax: 200 }]),
      fetchContent: okContent,
      postPush: async () => ({ ackSeq: 5, applied: 0, skipped: 0, rejects: [] }),
      getToken: async () => 't',
      readCursor: async () => 0,
      advanceCursor: async () => {},
      logger: fakeLogger(),
    };

    const r = await createSyncPushRunner(deps).runCycle();
    expect(r.outcome).toBe('progressed');
    expect(r.applied).toBe(0);
  });
});
