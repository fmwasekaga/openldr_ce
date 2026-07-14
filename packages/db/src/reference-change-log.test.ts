import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { recordReferenceChange } from './reference-change-log';

describe('recordReferenceChange', () => {
  it('appends an upsert row with the content hash', async () => {
    const db = await makeMigratedDb();
    await db.transaction().execute((trx) => recordReferenceChange(trx, 'dashboard', 'd1', 'upsert', 'hashA'));
    const rows = await db.selectFrom('reference_change_log').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity_type: 'dashboard', entity_id: 'd1', op: 'upsert', content_hash: 'hashA' });
    await db.destroy();
  });

  it('is a no-op when the latest row for the entity has the same content hash', async () => {
    const db = await makeMigratedDb();
    await db.transaction().execute((trx) => recordReferenceChange(trx, 'dashboard', 'd1', 'upsert', 'hashA'));
    await db.transaction().execute((trx) => recordReferenceChange(trx, 'dashboard', 'd1', 'upsert', 'hashA'));
    expect(await db.selectFrom('reference_change_log').selectAll().execute()).toHaveLength(1);
    await db.destroy();
  });

  it('appends a new row when the content hash changes', async () => {
    const db = await makeMigratedDb();
    await db.transaction().execute((trx) => recordReferenceChange(trx, 'dashboard', 'd1', 'upsert', 'hashA'));
    await db.transaction().execute((trx) => recordReferenceChange(trx, 'dashboard', 'd1', 'upsert', 'hashB'));
    expect(await db.selectFrom('reference_change_log').selectAll().execute()).toHaveLength(2);
    await db.destroy();
  });

  it('appends a delete tombstone unless the latest row is already a delete', async () => {
    const db = await makeMigratedDb();
    await db.transaction().execute((trx) => recordReferenceChange(trx, 'dashboard', 'd1', 'upsert', 'hashA'));
    await db.transaction().execute((trx) => recordReferenceChange(trx, 'dashboard', 'd1', 'delete', null));
    await db.transaction().execute((trx) => recordReferenceChange(trx, 'dashboard', 'd1', 'delete', null));
    const ops = (await db.selectFrom('reference_change_log').select('op').orderBy('seq').execute()).map((r) => r.op);
    expect(ops).toEqual(['upsert', 'delete']);
    await db.destroy();
  });

  it('does not tombstone an entity that was never logged', async () => {
    const db = await makeMigratedDb();
    await db.transaction().execute((trx) => recordReferenceChange(trx, 'report', 'never', 'delete', null));
    expect(await db.selectFrom('reference_change_log').selectAll().execute()).toHaveLength(0);
    await db.destroy();
  });
});
