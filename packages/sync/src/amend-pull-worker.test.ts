import { describe, it, expect, vi } from 'vitest';
import { createAmendmentPullRunner } from './amend-pull-worker';
import type { AmendmentPullResponse } from './batch';

const silent = { warn() {}, info() {}, error() {} } as any;

function rec(seq: number, id: string) {
  return { seq, resourceType: 'Observation', id, version: 2, op: 'upsert' as const, siteId: 'lab-a', resource: { resourceType: 'Observation', id } as any };
}

describe('createAmendmentPullRunner', () => {
  it('applies records in seq order and advances the cursor to nextSeq', async () => {
    let cursor = 0;
    const applied: string[] = [];
    const resp: AmendmentPullResponse = { records: [rec(5, 'a'), rec(6, 'b')], nextSeq: 6 };
    const runner = createAmendmentPullRunner({
      getToken: async () => 't',
      postPull: async () => resp,
      applyRecord: async (r) => { applied.push(r.id); return 'applied'; },
      readCursor: async () => cursor,
      advanceCursor: async (s) => { cursor = s; },
      logger: silent,
    });
    const r = await runner.runCycle();
    expect(r.outcome).toBe('progressed');
    expect(r.applied).toBe(2);
    expect(applied).toEqual(['a', 'b']);
    expect(cursor).toBe(6);
  });

  it('quarantines a failing record and still advances past it (per-row, no hold)', async () => {
    let cursor = 0;
    const resp: AmendmentPullResponse = { records: [rec(5, 'bad'), rec(6, 'good')], nextSeq: 6 };
    const runner = createAmendmentPullRunner({
      getToken: async () => 't',
      postPull: async () => resp,
      applyRecord: async (r) => { if (r.id === 'bad') throw new Error('boom'); return 'applied'; },
      readCursor: async () => cursor,
      advanceCursor: async (s) => { cursor = s; },
      logger: silent,
    });
    const r = await runner.runCycle();
    expect(r.outcome).toBe('progressed');
    expect(cursor).toBe(6);
  });

  it('holds the cursor on a transport/token failure (retry next cycle)', async () => {
    let cursor = 3;
    const runner = createAmendmentPullRunner({
      getToken: async () => { throw new Error('token down'); },
      postPull: async () => ({ records: [], nextSeq: 0 }),
      applyRecord: async () => 'applied',
      readCursor: async () => cursor,
      advanceCursor: async (s) => { cursor = s; },
      logger: silent,
    });
    const r = await runner.runCycle();
    expect(r.outcome).toBe('failed');
    expect(r.applied).toBe(0);
    expect(cursor).toBe(3);
  });

  it('reports drained on an empty window', async () => {
    let cursor = 4;
    const runner = createAmendmentPullRunner({
      getToken: async () => 't',
      postPull: async () => ({ records: [], nextSeq: 4 }),
      applyRecord: async () => 'applied',
      readCursor: async () => cursor,
      advanceCursor: async (s) => { cursor = s; },
      logger: silent,
    });
    const r = await runner.runCycle();
    // Asserted explicitly (not just falsy/zero) so an impl that returned 'failed' instead would be caught.
    expect(r.outcome).toBe('drained');
    expect(r.applied).toBe(0);
    expect(cursor).toBe(4); // nothing to advance to
  });

  it('a fully-diverged window still reports progressed — applied is reporting, not control', async () => {
    const applied: unknown[] = [];
    const warnings: unknown[][] = [];
    const logger = { ...silent, warn: (...args: unknown[]) => { warnings.push(args); } };
    let cursor = 0;
    const resp: AmendmentPullResponse = { records: [rec(7, 'd')], nextSeq: 7 };
    const runner = createAmendmentPullRunner({
      getToken: async () => 't',
      postPull: async () => resp,
      applyRecord: async (r) => { applied.push(r); return 'diverged' as const; },
      readCursor: async () => cursor,
      advanceCursor: async (s) => { cursor = s; },
      logger: logger as any,
    });
    const r = await runner.runCycle();
    expect(applied).toHaveLength(1); // the record WAS inspected/applied-attempted
    // A window where EVERY record diverges genuinely progressed the cursor — 'applied' excludes
    // diverged records from the count, but control (outcome) must key off the window, never the count.
    // while (runCycle() > 0) would have stopped here with the backlog unsent; this is why CycleResult
    // separates the two.
    expect(r.outcome).toBe('progressed');
    expect(r.applied).toBe(0); // but NOT counted as 'applied' — it was dropped in favor of the local copy
    expect(cursor).toBe(7); // handled, not quarantined — cursor still advances past it
    expect(warnings).toHaveLength(1);
    expect(warnings[0][0]).toMatchObject({ diverged: 1 });
    expect(warnings[0][1]).toMatch(/divergence/i);
  });

  it('reports failed (not progressed) when the window processed but the cursor could not advance — stale/hostile nextSeq', async () => {
    // Same regression class as the reference pull runner's hold guard and the push runner's
    // central-acked-behind-cursor guard: reporting 'progressed' with the cursor unmoved would make the
    // drain loop re-fetch this IDENTICAL window and hammer it for the whole budget.
    const cursor = 10;
    const advanceCursor = vi.fn(async () => {});
    const logger = { ...silent, error: vi.fn() };
    const resp: AmendmentPullResponse = { records: [rec(7, 'a')], nextSeq: 7 }; // stale: nextSeq (7) <= cursor (10)
    const runner = createAmendmentPullRunner({
      getToken: async () => 't',
      postPull: async () => resp,
      applyRecord: async () => 'applied',
      readCursor: async () => cursor,
      advanceCursor,
      logger: logger as any,
    });
    const r = await runner.runCycle();
    expect(r.outcome).toBe('failed');
    expect(r.applied).toBe(1); // reporting-only: the record was still applied
    expect(advanceCursor).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

// A fake SyncActivityRecorder that counts attempt() calls and captures every record(entry) verbatim.
function fakeActivity() {
  const records: { event: string; records?: number; error?: string; metadata?: Record<string, unknown> }[] = [];
  const attempts = { n: 0 };
  return {
    recorder: {
      attempt: () => { attempts.n++; },
      record: (e: { event: string; records?: number; error?: string; metadata?: Record<string, unknown> }) => {
        records.push(e);
      },
    },
    records,
    attempts,
  };
}

describe('amend pull runner activity emission', () => {
  it('calls attempt() once per cycle (recorder contract)', async () => {
    const { recorder, attempts } = fakeActivity();
    let cursor = 0;
    const runner = createAmendmentPullRunner({
      getToken: async () => 't',
      postPull: async () => ({ records: [], nextSeq: 0 }) as AmendmentPullResponse,
      applyRecord: async () => 'applied' as const,
      readCursor: async () => cursor,
      advanceCursor: async (s) => { cursor = s; },
      logger: silent,
      activity: recorder,
    });
    await runner.runCycle();
    expect(attempts.n).toBe(1);
  });

  it('emits one "diverged" row per diverged record, carrying resource identity', async () => {
    const { recorder, records } = fakeActivity();
    let cursor = 0;
    const resp: AmendmentPullResponse = { records: [rec(7, 'd')], nextSeq: 7 };
    const runner = createAmendmentPullRunner({
      getToken: async () => 't',
      postPull: async () => resp,
      applyRecord: async () => 'diverged' as const,
      readCursor: async () => cursor,
      advanceCursor: async (s) => { cursor = s; },
      logger: silent,
      activity: recorder,
    });
    const r = await runner.runCycle();
    expect(r.outcome).toBe('progressed');
    const diverged = records.filter((e) => e.event === 'diverged');
    expect(diverged).toHaveLength(1);
    expect(diverged[0].metadata).toMatchObject({ resourceType: 'Observation', id: 'd', version: 2, seq: 7 });
  });

  it('emits one sanitized "failed" entry when postPull throws (no raw token in the entry)', async () => {
    const { recorder, records } = fakeActivity();
    const cursor = 3;
    const runner = createAmendmentPullRunner({
      getToken: async () => 't',
      postPull: async () => {
        throw new Error('boom Bearer secrettoken123');
      },
      applyRecord: async () => 'applied' as const,
      readCursor: async () => cursor,
      advanceCursor: async () => {},
      logger: silent,
      activity: recorder,
    });
    const r = await runner.runCycle();
    expect(r.outcome).toBe('failed');
    expect(records).toHaveLength(1);
    expect(records[0].event).toBe('failed');
    expect(records[0].error).toBeDefined();
    expect(records[0].error).not.toContain('secrettoken123');
  });

  it('emits a "synced" entry carrying the applied count on a fully-applied window', async () => {
    const { recorder, records } = fakeActivity();
    let cursor = 0;
    const resp: AmendmentPullResponse = { records: [rec(5, 'a'), rec(6, 'b')], nextSeq: 6 };
    const runner = createAmendmentPullRunner({
      getToken: async () => 't',
      postPull: async () => resp,
      applyRecord: async () => 'applied' as const,
      readCursor: async () => cursor,
      advanceCursor: async (s) => { cursor = s; },
      logger: silent,
      activity: recorder,
    });
    const r = await runner.runCycle();
    expect(r.outcome).toBe('progressed');
    const synced = records.filter((e) => e.event === 'synced');
    expect(synced).toHaveLength(1);
    expect(synced[0].records).toBe(2);
  });

  it('emits one "quarantined" entry per apply-throw, and still advances past it', async () => {
    const { recorder, records } = fakeActivity();
    let cursor = 0;
    const resp: AmendmentPullResponse = { records: [rec(5, 'bad'), rec(6, 'good')], nextSeq: 6 };
    const runner = createAmendmentPullRunner({
      getToken: async () => 't',
      postPull: async () => resp,
      applyRecord: async (r) => { if (r.id === 'bad') throw new Error('boom'); return 'applied' as const; },
      readCursor: async () => cursor,
      advanceCursor: async (s) => { cursor = s; },
      logger: silent,
      activity: recorder,
    });
    const r = await runner.runCycle();
    expect(r.outcome).toBe('progressed');
    expect(cursor).toBe(6);
    const quarantined = records.filter((e) => e.event === 'quarantined');
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0].metadata).toMatchObject({ resourceType: 'Observation', id: 'bad', seq: 5 });
  });
});
