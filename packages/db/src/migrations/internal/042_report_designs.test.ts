import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('042_report_designs', () => {
  it('creates report_designs and round-trips a row', async () => {
    const db = await makeMigratedDb();

    await db
      .insertInto('report_designs')
      .values({
        id: 'd1',
        name: 'D',
        pages: JSON.stringify([]),
        parameters: JSON.stringify([]),
        margins: null,
      } as never)
      .execute();

    const row = await db
      .selectFrom('report_designs')
      .select(['id', 'name', 'paper', 'orientation', 'pages'])
      .where('id', '=', 'd1')
      .executeTakeFirstOrThrow();

    expect(row).toMatchObject({ id: 'd1', name: 'D', paper: 'A4', orientation: 'portrait' });
    expect(row.pages).toBeTruthy();

    await db.destroy();
  });
});
