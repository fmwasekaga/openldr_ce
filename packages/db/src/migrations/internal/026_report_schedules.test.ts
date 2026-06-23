import { describe, it, expect } from 'vitest';
import { internalMigrations } from './index';
import { makeMigratedDb } from './test-helpers';

describe('026_report_schedules migration', () => {
  it('is registered', () => {
    expect(internalMigrations['026_report_schedules']).toBeDefined();
  });

  it('creates writable report_schedules + report_schedule_runs tables', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('report_schedules').values({
      id: 's1', report_id: 'amr-resistance', params: { facility: 'F1' },
      frequency: 'weekly', day_of_week: 1, day_of_month: null,
      output_format: 'pdf', created_by: 'u1',
    }).execute();
    await db.insertInto('report_schedule_runs').values({
      id: 'r1', schedule_id: 's1', report_id: 'amr-resistance', report_name: 'AMR',
      output_format: 'pdf', object_key: 'k', byte_size: 10, row_count: 3, status: 'success',
    }).execute();
    const s = await db.selectFrom('report_schedules').selectAll().execute();
    const r = await db.selectFrom('report_schedule_runs').selectAll().execute();
    expect(s).toHaveLength(1);
    expect(s[0]!.params).toEqual({ facility: 'F1' });
    expect(r[0]!.status).toBe('success');
    await db.destroy();
  });
});
