import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('024_plugin_registry', () => {
  it('adds enabled/active/approved_by/granted_at to plugins', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('plugins').values({
      id: 'p', version: '1.0.0', sha256: 'a'.repeat(64), manifest: {} as never, status: 'installed',
      enabled: true, active: true, approved_by: 'admin', granted_at: new Date(),
    }).execute();
    const row = await db.selectFrom('plugins').selectAll().where('id', '=', 'p').executeTakeFirst();
    expect(row?.enabled).toBe(true);
    expect(row?.active).toBe(true);
    expect(row?.approved_by).toBe('admin');
  });
});
