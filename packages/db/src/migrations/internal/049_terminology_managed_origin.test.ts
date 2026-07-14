import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('049_terminology_managed_origin', () => {
  it('adds a nullable managed_origin column to the three terminology metadata tables', async () => {
    const db = await makeMigratedDb();

    // Minimal rows that satisfy the NOT NULL columns of each table, WITHOUT managed_origin.
    await db.insertInto('publishers').values({
      id: 'p1', name: 'P', role: 'local',
    } as never).execute();

    await db.insertInto('coding_systems').values({
      id: 'cs1', system_code: 'LOINC', system_name: 'LOINC',
    } as never).execute();

    await db.insertInto('term_mappings').values({
      id: 'tm1', from_system: 'a', from_code: '1', to_system: 'b', to_code: '2', map_type: 'equivalent',
    } as never).execute();

    // Omitted column defaults to null (nullable, no default) on all three tables.
    for (const [table, id] of [['publishers', 'p1'], ['coding_systems', 'cs1'], ['term_mappings', 'tm1']] as const) {
      const row = await db.selectFrom(table).selectAll().where('id', '=', id).executeTakeFirst();
      expect(row).toBeTruthy();
      expect((row as any).managed_origin).toBeNull();
    }

    // Round-trips a 'central' stamp.
    await db.updateTable('publishers').set({ managed_origin: 'central' } as never).where('id', '=', 'p1').execute();
    const stamped = await db.selectFrom('publishers').selectAll().where('id', '=', 'p1').executeTakeFirst();
    expect((stamped as any).managed_origin).toBe('central');

    await db.destroy();
  });
});
