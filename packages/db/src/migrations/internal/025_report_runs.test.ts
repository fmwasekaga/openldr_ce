import { describe, it, expect } from 'vitest';
import { internalMigrations } from './index';
import { makeMigratedDb } from './test-helpers';

describe('025_report_runs migration', () => {
  it('is registered in the internal migration set', () => {
    expect(internalMigrations['025_report_runs']).toBeDefined();
  });

  it('creates a writable report_runs table', async () => {
    const db = await makeMigratedDb();
    await db
      .insertInto('report_runs')
      .values({
        id: 'r1', report_id: 'amr-resistance', report_name: 'AMR Resistance Rate',
        format: 'preview', params: { from: '2026-01-01' }, row_count: 3,
        user_id: 'u1', user_name: 'ada',
      })
      .execute();
    const rows = await db.selectFrom('report_runs').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.report_id).toBe('amr-resistance');
    expect(rows[0]!.params).toEqual({ from: '2026-01-01' });
    await db.destroy();
  });
});
