import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('048_managed_origin', () => {
  it('adds a nullable managed_origin column to the three config tables', async () => {
    const db = await makeMigratedDb();

    // Minimal rows that satisfy the NOT NULL columns of each table, WITHOUT managed_origin.
    await db.insertInto('reports').values({
      id: 'r1', name: 'R', category: 'c', design_id: 'd', primary_query_id: 'q',
    } as never).execute();

    await db.insertInto('dashboards').values({
      id: 'db1', name: 'D', layout: '[]', widgets: '[]', filters: '[]',
    } as never).execute();

    await db.insertInto('form_definitions').values({
      id: 'f1', name: 'F', status: 'draft', active: false, schema: '{}',
      created_at: '2026-01-01', updated_at: '2026-01-01',
    } as never).execute();

    // Omitted column defaults to null (nullable, no default).
    for (const [table, id] of [['reports', 'r1'], ['dashboards', 'db1'], ['form_definitions', 'f1']] as const) {
      const row = await db.selectFrom(table).selectAll().where('id', '=', id).executeTakeFirst();
      expect(row).toBeTruthy();
      expect((row as any).managed_origin).toBeNull();
    }

    // Round-trips a 'central' stamp.
    await db.updateTable('reports').set({ managed_origin: 'central' } as never).where('id', '=', 'r1').execute();
    const stamped = await db.selectFrom('reports').selectAll().where('id', '=', 'r1').executeTakeFirst();
    expect((stamped as any).managed_origin).toBe('central');

    await db.destroy();
  });
});
