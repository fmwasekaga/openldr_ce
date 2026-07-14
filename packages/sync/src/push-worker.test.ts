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

// Minimal fake Kysely that answers only the runner's change_log version/site_id read. The chain
// ignores its args and returns the configured meta rows (the runner keys them by seq, so a superset
// is fine).
function fakeDb(metaRows: { seq: number; version: number; site_id: string | null }[]): PushDeps['internalDb'] {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.where = () => chain;
  chain.execute = async () => metaRows;
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

    const applied = await createSyncPushRunner(deps).runCycle();

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
    expect(applied).toBe(2);
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

    const applied = await createSyncPushRunner(deps).runCycle();
    expect(applied).toBe(0);
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

    const applied = await createSyncPushRunner(deps).runCycle();
    expect(applied).toBe(1);
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

    const applied1 = await runner.runCycle();
    expect(applied1).toBe(1);
    expect(pushes[0].records.map((r) => r.id)).toEqual(['p5']); // only the SAFE prefix (seq7 > frontier 5)
    expect(pushes[0].records[0].seq).toBe(5);
    expect(cursorVal).toBe(5);

    const applied2 = await runner.runCycle();
    expect(applied2).toBe(1);
    expect(pushes[1].records.map((r) => r.id)).toEqual(['p7']); // gap6 confirmed via CARRIED pendingGaps
    expect(pushes[1].records[0].seq).toBe(7);
    expect(cursorVal).toBe(7);
  });
});
