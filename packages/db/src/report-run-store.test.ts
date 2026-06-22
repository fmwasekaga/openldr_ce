import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createReportRunStore } from './report-run-store';

describe('report run store', () => {
  it('records runs and lists them newest-first with paging + total', async () => {
    const db = await makeMigratedDb();
    const store = createReportRunStore(db);

    for (let i = 0; i < 3; i++) {
      await store.record({
        reportId: 'amr-resistance', reportName: 'AMR Resistance Rate',
        format: 'preview', params: { n: String(i) }, rowCount: i,
        userId: 'u1', userName: 'ada',
      });
    }
    await store.record({
      reportId: 'test-volume', reportName: 'Test Volume',
      format: 'csv', params: {}, rowCount: 9, userId: 'u1', userName: 'ada',
    });

    const all = await store.list({ limit: 10, offset: 0 });
    expect(all.total).toBe(4);
    expect(all.runs).toHaveLength(4);
    expect(all.runs[0]!.reportId).toBe('test-volume');

    const filtered = await store.list({ reportId: 'amr-resistance', limit: 10, offset: 0 });
    expect(filtered.total).toBe(3);
    expect(filtered.runs.every((r) => r.reportId === 'amr-resistance')).toBe(true);

    const page = await store.list({ reportId: 'amr-resistance', limit: 2, offset: 0 });
    expect(page.runs).toHaveLength(2);
    expect(page.total).toBe(3);

    expect(filtered.runs[0]!.params).toEqual({ n: '2' });
    await db.destroy();
  });
});
