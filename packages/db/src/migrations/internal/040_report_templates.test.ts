import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('040_report_templates', () => {
  it('creates report_templates and round-trips a row', async () => {
    const db = await makeMigratedDb();

    await db
      .insertInto('report_templates')
      .values({
        id: 'rt-1',
        name: 'AMR facility summary',
        description: 'demo',
        category: 'amr',
        status: 'draft',
        page: JSON.stringify({ size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } }),
        parameters: JSON.stringify([]),
        dataset: null,
        rows: JSON.stringify([]),
      } as never)
      .execute();

    const row = await db
      .selectFrom('report_templates')
      .select(['id', 'name', 'category', 'status', 'rows'])
      .where('id', '=', 'rt-1')
      .executeTakeFirstOrThrow();

    expect(row).toMatchObject({ id: 'rt-1', name: 'AMR facility summary', category: 'amr', status: 'draft' });
    expect(row.rows).toBeTruthy();

    await db.destroy();
  });
});
