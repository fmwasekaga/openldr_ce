import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createSyncQuarantineStore } from './sync-quarantine-store';

describe('createSyncQuarantineStore', () => {
  let db: Kysely<any>;
  beforeEach(async () => { db = await makeMigratedDb(); });

  it('increments attempts and flips holding→quarantined at the threshold', async () => {
    const q = createSyncQuarantineStore(db);
    const r1 = await q.recordFailure('terminology_system', 'http://x', { seq: 5, error: 'boom', threshold: 3 });
    expect(r1).toEqual({ attempts: 1, status: 'holding' });
    const r2 = await q.recordFailure('terminology_system', 'http://x', { seq: 6, error: 'boom', threshold: 3 });
    expect(r2.attempts).toBe(2); expect(r2.status).toBe('holding');
    const r3 = await q.recordFailure('terminology_system', 'http://x', { seq: 7, error: 'boom2', threshold: 3 });
    expect(r3).toEqual({ attempts: 3, status: 'quarantined' });

    const row = await q.get('terminology_system', 'http://x');
    expect(row?.status).toBe('quarantined');
    expect(row?.lastError).toBe('boom2');
    expect(row?.lastSeq).toBe(7);
    expect(row?.quarantinedAt).toBeTruthy();
  });

  it('clear() removes the row; list() returns rows', async () => {
    const q = createSyncQuarantineStore(db);
    await q.recordFailure('concept_map', 'http://m', { seq: 1, error: 'e', threshold: 3 });
    expect(await q.list()).toHaveLength(1);
    await q.clear('concept_map', 'http://m');
    expect(await q.list()).toHaveLength(0);
    expect(await q.get('concept_map', 'http://m')).toBeUndefined();
  });
});
