import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@openldr/db';
import { createSyncPullRunner, type PullDeps } from './pull-worker';
import type { PullRecord } from './batch';

const rec = (seq: number, entityId: string, op: 'upsert' | 'delete' = 'upsert'): PullRecord => ({
  seq,
  entityType: 'form',
  entityId,
  op,
  contentHash: op === 'upsert' ? `h-${entityId}` : null,
  body: op === 'upsert' ? { id: entityId } : undefined,
});

// A terminology bulk (hold) record: the default isHoldRecord predicate treats these as all-or-nothing.
const holdRec = (
  seq: number,
  entityId: string,
  entityType: 'terminology_system' | 'concept_map' = 'terminology_system',
): PullRecord => ({
  seq,
  entityType,
  entityId,
  op: 'upsert',
  contentHash: `h-${entityId}`,
  body: { url: entityId, generation: seq },
});

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

describe('createSyncPullRunner', () => {
  it('applies one record per pull record (upsert + delete), advances the cursor to nextSeq, returns the count', async () => {
    const applyRecord = vi.fn(async () => 'applied' as const);
    const advanceCursor = vi.fn(async () => {});
    const deps: PullDeps = {
      postPull: async () => ({ records: [rec(1, 'f1', 'upsert'), rec(2, 'f2', 'delete')], nextSeq: 2 }),
      getToken: async () => 'tok-123',
      applyRecord,
      readCursor: async () => 0,
      advanceCursor,
      logger: fakeLogger(),
    };

    const applied = await createSyncPullRunner(deps).runCycle();

    expect(applyRecord).toHaveBeenCalledTimes(2);
    expect(applyRecord).toHaveBeenNthCalledWith(1, expect.objectContaining({ seq: 1, entityId: 'f1', op: 'upsert' }));
    expect(applyRecord).toHaveBeenNthCalledWith(2, expect.objectContaining({ seq: 2, entityId: 'f2', op: 'delete' }));
    expect(advanceCursor).toHaveBeenCalledWith(2);
    expect(applied).toBe(2);
  });

  it('passes the read cursor as fromSeq and the token to postPull', async () => {
    const posts: { fromSeq: number; token: string }[] = [];
    const deps: PullDeps = {
      postPull: async (req, token) => {
        posts.push({ fromSeq: req.fromSeq, token });
        return { records: [rec(6, 'f6')], nextSeq: 6 };
      },
      getToken: async () => 'tok-xyz',
      applyRecord: async () => 'applied',
      readCursor: async () => 5,
      advanceCursor: async () => {},
      logger: fakeLogger(),
    };

    await createSyncPullRunner(deps).runCycle();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({ fromSeq: 5, token: 'tok-xyz' });
  });

  it('empty response: applies nothing, does NOT advance the cursor, returns 0', async () => {
    const applyRecord = vi.fn(async () => 'applied' as const);
    const advanceCursor = vi.fn(async () => {});
    const deps: PullDeps = {
      postPull: async () => ({ records: [], nextSeq: 42 }),
      getToken: async () => 't',
      applyRecord,
      readCursor: async () => 0,
      advanceCursor,
      logger: fakeLogger(),
    };

    const applied = await createSyncPullRunner(deps).runCycle();
    expect(applied).toBe(0);
    expect(applyRecord).not.toHaveBeenCalled();
    expect(advanceCursor).not.toHaveBeenCalled();
  });

  it('does NOT advance the cursor when postPull throws (retry next cycle)', async () => {
    const advanceCursor = vi.fn(async () => {});
    const applyRecord = vi.fn(async () => 'applied' as const);
    const logger = fakeLogger();
    const deps: PullDeps = {
      postPull: async () => {
        throw new Error('ECONNREFUSED');
      },
      getToken: async () => 't',
      applyRecord,
      readCursor: async () => 0,
      advanceCursor,
      logger,
    };

    const applied = await createSyncPullRunner(deps).runCycle();
    expect(applied).toBe(0);
    expect(applyRecord).not.toHaveBeenCalled();
    expect(advanceCursor).not.toHaveBeenCalled();
    expect(logger.warns).toHaveLength(1);
  });

  it('getToken failure behaves like a transport outage: no postPull, no advance, logged, returns 0', async () => {
    const postPull = vi.fn(async () => ({ records: [rec(1, 'f1')], nextSeq: 1 }));
    const advanceCursor = vi.fn(async () => {});
    const logger = fakeLogger();
    const deps: PullDeps = {
      postPull,
      getToken: async () => {
        throw new Error('token endpoint 503');
      },
      applyRecord: async () => 'applied',
      readCursor: async () => 0,
      advanceCursor,
      logger,
    };

    const applied = await createSyncPullRunner(deps).runCycle();
    expect(applied).toBe(0);
    expect(postPull).not.toHaveBeenCalled(); // failed before transport (getToken inside the try)
    expect(advanceCursor).not.toHaveBeenCalled();
    expect(logger.warns).toHaveLength(1);
  });

  it('quarantines a per-record apply failure: logs + skips it, still applies the others, cursor STILL advances to nextSeq', async () => {
    const advanceCursor = vi.fn(async () => {});
    const logger = fakeLogger();
    const applyRecord = vi.fn(async (r: PullRecord) => {
      if (r.entityId === 'f2') throw new Error('constraint violation');
      return 'applied' as const;
    });
    const deps: PullDeps = {
      postPull: async () => ({
        records: [rec(1, 'f1'), rec(2, 'f2'), rec(3, 'f3')],
        nextSeq: 3,
      }),
      getToken: async () => 't',
      applyRecord,
      readCursor: async () => 0,
      advanceCursor,
      logger,
    };

    const applied = await createSyncPullRunner(deps).runCycle();
    expect(applyRecord).toHaveBeenCalledTimes(3); // every record attempted; one bad one does not stop the loop
    expect(applied).toBe(2); // f1 + f3 applied, f2 skipped
    expect(advanceCursor).toHaveBeenCalledWith(3); // advanced PAST the failed seq — never blocks the stream
    expect(logger.warns).toHaveLength(1);
    expect(logger.warns[0]).toMatchObject({ entityType: 'form', entityId: 'f2', seq: 2 });
  });

  it('does not advance the cursor backward when nextSeq <= cursor (defensive)', async () => {
    const advanceCursor = vi.fn(async () => {});
    const deps: PullDeps = {
      // stale/hostile response: nextSeq (7) is not past the current cursor (10)
      postPull: async () => ({ records: [rec(7, 'f7')], nextSeq: 7 }),
      getToken: async () => 't',
      applyRecord: async () => 'applied',
      readCursor: async () => 10,
      advanceCursor,
      logger: fakeLogger(),
    };

    const applied = await createSyncPullRunner(deps).runCycle();
    expect(applied).toBe(1); // the served record was still applied
    expect(advanceCursor).not.toHaveBeenCalled(); // but the cursor is never regressed
  });

  it('quarantine-only batch (one throws): still advances to nextSeq, the bad one skipped (unchanged S2 behavior)', async () => {
    const advanceCursor = vi.fn(async () => {});
    const logger = fakeLogger();
    const applyRecord = vi.fn(async (r: PullRecord) => {
      if (r.entityId === 'f2') throw new Error('constraint violation');
      return 'applied' as const;
    });
    const deps: PullDeps = {
      postPull: async () => ({ records: [rec(1, 'f1'), rec(2, 'f2'), rec(3, 'f3')], nextSeq: 3 }),
      getToken: async () => 't',
      applyRecord,
      readCursor: async () => 0,
      advanceCursor,
      logger,
    };

    const applied = await createSyncPullRunner(deps).runCycle();
    expect(applied).toBe(2); // f1 + f3, f2 skipped
    expect(advanceCursor).toHaveBeenCalledWith(3); // whole window handled → advance to nextSeq
    expect(logger.warns).toHaveLength(1);
    expect(logger.warns[0]).toMatchObject({ entityType: 'form', entityId: 'f2', seq: 2 });
  });

  it('HOLDS a failed bulk record mid-window: caps the advance at the last safe seq BEFORE it, later records not processed', async () => {
    const advanceCursor = vi.fn(async () => {});
    const logger = fakeLogger();
    const applyRecord = vi.fn(async (r: PullRecord) => {
      if (r.entityId === 'loinc') throw new Error('bulk drain failed');
      return 'applied' as const;
    });
    const deps: PullDeps = {
      postPull: async () => ({
        // [q(seq1 ok), hold(seq2 throws), q(seq3)] — held at seq2; seq3 must NOT be processed.
        records: [rec(1, 'f1'), holdRec(2, 'loinc'), rec(3, 'f3')],
        nextSeq: 3,
      }),
      getToken: async () => 't',
      applyRecord,
      readCursor: async () => 0,
      advanceCursor,
      logger,
    };

    const applied = await createSyncPullRunner(deps).runCycle();
    expect(applyRecord).toHaveBeenCalledTimes(2); // f1 applied, loinc thrown, loop stopped BEFORE f3
    expect(applied).toBe(1); // only f1
    expect(advanceCursor).toHaveBeenCalledWith(1); // capped at seq1 (NOT nextSeq 3) → held record + rest replay
    expect(logger.warns).toHaveLength(1);
    expect(logger.warns[0]).toMatchObject({ entityType: 'terminology_system', entityId: 'loinc', seq: 2 });
  });

  it('a bulk record as the FIRST record that throws: cursor NOT advanced (nothing safe before it), applied 0', async () => {
    const advanceCursor = vi.fn(async () => {});
    const logger = fakeLogger();
    const applyRecord = vi.fn(async () => {
      throw new Error('bulk drain failed');
    });
    const deps: PullDeps = {
      postPull: async () => ({ records: [holdRec(1, 'loinc'), rec(2, 'f2')], nextSeq: 2 }),
      getToken: async () => 't',
      applyRecord,
      readCursor: async () => 0,
      advanceCursor,
      logger,
    };

    const applied = await createSyncPullRunner(deps).runCycle();
    expect(applyRecord).toHaveBeenCalledTimes(1); // stopped at the first (held) record
    expect(applied).toBe(0);
    expect(advanceCursor).not.toHaveBeenCalled(); // safeSeq stays at cursor (0) → not > cursor → no advance
    expect(logger.warns).toHaveLength(1);
    expect(logger.warns[0]).toMatchObject({ entityType: 'terminology_system', entityId: 'loinc', seq: 1 });
  });

  it('both bulk records succeed: advances to nextSeq (no hold triggered)', async () => {
    const advanceCursor = vi.fn(async () => {});
    const applyRecord = vi.fn(async () => 'applied' as const);
    const deps: PullDeps = {
      postPull: async () => ({
        records: [holdRec(1, 'loinc'), holdRec(2, 'icd10-to-loinc', 'concept_map')],
        nextSeq: 2,
      }),
      getToken: async () => 't',
      applyRecord,
      readCursor: async () => 0,
      advanceCursor,
      logger: fakeLogger(),
    };

    const applied = await createSyncPullRunner(deps).runCycle();
    expect(applied).toBe(2);
    expect(advanceCursor).toHaveBeenCalledWith(2); // both succeeded → whole window handled
  });

  it('mixed all-success (per-row + bulk): advances to nextSeq', async () => {
    const advanceCursor = vi.fn(async () => {});
    const applyRecord = vi.fn(async () => 'applied' as const);
    const deps: PullDeps = {
      postPull: async () => ({
        records: [rec(1, 'f1'), holdRec(2, 'loinc'), rec(3, 'f3')],
        nextSeq: 3,
      }),
      getToken: async () => 't',
      applyRecord,
      readCursor: async () => 0,
      advanceCursor,
      logger: fakeLogger(),
    };

    const applied = await createSyncPullRunner(deps).runCycle();
    expect(applied).toBe(3);
    expect(advanceCursor).toHaveBeenCalledWith(3);
  });

  it('default predicate: a terminology_system throw HOLDS but a report throw QUARANTINES (advances past it)', async () => {
    const advanceCursor = vi.fn(async () => {});
    const logger = fakeLogger();
    // report record that throws should be quarantined (advance past), NOT held.
    const reportRec: PullRecord = { seq: 1, entityType: 'report', entityId: 'r1', op: 'upsert', contentHash: 'h', body: {} };
    const applyRecord = vi.fn(async () => {
      throw new Error('apply failed');
    });
    const deps: PullDeps = {
      postPull: async () => ({ records: [reportRec], nextSeq: 1 }),
      getToken: async () => 't',
      applyRecord,
      readCursor: async () => 0,
      advanceCursor,
      logger, // rely on the DEFAULT isHoldRecord (no override): report is quarantine
    };

    const applied = await createSyncPullRunner(deps).runCycle();
    expect(applied).toBe(0);
    expect(advanceCursor).toHaveBeenCalledWith(1); // report quarantined → advance past it to nextSeq
    expect(logger.warns[0]).toMatchObject({ entityType: 'report', seq: 1 });
  });

  it('respects an explicit isHoldRecord override', async () => {
    const advanceCursor = vi.fn(async () => {});
    const logger = fakeLogger();
    // Override: treat 'form' as hold. A failing form must then HOLD (cap advance), not quarantine.
    const applyRecord = vi.fn(async (r: PullRecord) => {
      if (r.entityId === 'f2') throw new Error('boom');
      return 'applied' as const;
    });
    const deps: PullDeps = {
      postPull: async () => ({ records: [rec(1, 'f1'), rec(2, 'f2'), rec(3, 'f3')], nextSeq: 3 }),
      getToken: async () => 't',
      applyRecord,
      readCursor: async () => 0,
      advanceCursor,
      isHoldRecord: (r) => r.entityType === 'form',
      logger,
    };

    const applied = await createSyncPullRunner(deps).runCycle();
    expect(applyRecord).toHaveBeenCalledTimes(2); // held at seq2 → seq3 not processed
    expect(applied).toBe(1);
    expect(advanceCursor).toHaveBeenCalledWith(1); // capped at seq1
    expect(logger.warns[0]).toMatchObject({ entityId: 'f2', seq: 2 });
  });
});
