import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import type { InternalSchema } from '@openldr/db';
import { createColumnPolicyStore, seedColumnExposurePolicy } from './column-policy-store';
import { HARDCODED_DENY_UNION } from './models/registry';

let db: Kysely<InternalSchema>;
beforeEach(async () => { db = await makeMigratedDb(); });

describe('column policy store', () => {
  it('seeds the hardcoded union idempotently', async () => {
    await seedColumnExposurePolicy(db);
    await seedColumnExposurePolicy(db); // second run must not throw / duplicate
    const store = createColumnPolicyStore(db);
    const hidden = await store.listHidden();
    expect(new Set(hidden.patients)).toEqual(new Set(HARDCODED_DENY_UNION.patients));
  });

  it('load() returns a ColumnPolicy map', async () => {
    await seedColumnExposurePolicy(db);
    const policy = await createColumnPolicyStore(db).load();
    expect(policy.get('patients')?.has('national_id')).toBe(true);
  });

  it('replaceTable swaps a table hidden set wholesale', async () => {
    await seedColumnExposurePolicy(db);
    const store = createColumnPolicyStore(db);
    await store.replaceTable('patients', ['national_id'], 'tester');
    const hidden = await store.listHidden();
    expect(hidden.patients).toEqual(['national_id']); // surname etc. now exposed
  });

  it('replaceTable with an empty hidden array fully exposes the table (no hidden columns)', async () => {
    await seedColumnExposurePolicy(db);
    const store = createColumnPolicyStore(db);
    await store.replaceTable('patients', []);
    const hidden = await store.listHidden();
    expect(hidden.patients).toBeUndefined();
  });

  it('a fully-exposed table stays configured after reload (regression: no revert to defaults)', async () => {
    await seedColumnExposurePolicy(db);
    const store = createColumnPolicyStore(db);
    await store.replaceTable('patients', []); // expose every column, no floor
    const policy = await store.load();
    // Must be an entry with an EMPTY Set, not `undefined` — absent would make hiddenFor() fall
    // back to HARDCODED_DENY_UNION and silently re-hide national_id/surname/etc.
    expect(policy.has('patients')).toBe(true);
    expect(policy.get('patients')?.size).toBe(0);
    const hidden = await store.listHidden();
    expect(hidden.patients).toBeUndefined();
  });
});
