import { describe, it, expect } from 'vitest';
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
    const n = await runner.runCycle();
    expect(n).toBe(2);
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
    await runner.runCycle();
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
    const n = await runner.runCycle();
    expect(n).toBe(0);
    expect(cursor).toBe(3);
  });

  it('treats a diverged apply as handled — cursor advances, no quarantine', async () => {
    const applied: unknown[] = [];
    let cursor = 0;
    const resp: AmendmentPullResponse = { records: [rec(7, 'd')], nextSeq: 7 };
    const runner = createAmendmentPullRunner({
      getToken: async () => 't',
      postPull: async () => resp,
      applyRecord: async (r) => { applied.push(r); return 'diverged' as const; },
      readCursor: async () => cursor,
      advanceCursor: async (s) => { cursor = s; },
      logger: silent,
    });
    const n = await runner.runCycle();
    expect(applied).toHaveLength(1);
    expect(n).toBe(1);
    expect(cursor).toBe(7);
  });
});
