import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createReportScheduleStore } from './report-schedule-store';

describe('report schedule store', () => {
  it('CRUD + next-due/markRun + runs', async () => {
    const db = await makeMigratedDb();
    const store = createReportScheduleStore(db);

    await store.create({
      id: 's1', reportId: 'amr-resistance', params: { facility: 'F1' },
      frequency: 'weekly', dayOfWeek: 1, dayOfMonth: null,
      outputFormat: 'pdf', createdBy: 'u1', nextDueAt: new Date('2026-03-16T06:00:00Z'),
    });
    expect((await store.get('s1'))?.reportId).toBe('amr-resistance');
    expect((await store.list({ reportId: 'amr-resistance' })).map((s) => s.id)).toEqual(['s1']);
    expect((await store.get('s1'))?.params).toEqual({ facility: 'F1' });

    await store.update('s1', { enabled: false, outputFormat: 'csv' });
    expect((await store.get('s1'))?.enabled).toBe(false);
    expect((await store.get('s1'))?.outputFormat).toBe('csv');

    await store.setNextDue('s1', new Date('2026-03-23T06:00:00Z'));
    await store.markRun('s1', new Date('2026-03-16T06:05:00Z'));
    const s = await store.get('s1');
    expect(s?.lastRunAt?.toISOString()).toBe('2026-03-16T06:05:00.000Z');

    await store.recordRun({
      id: 'run1', scheduleId: 's1', reportId: 'amr-resistance', reportName: 'AMR',
      runAt: new Date('2026-03-16T06:05:00Z'), periodStart: new Date('2026-03-09T00:00:00Z'),
      periodEnd: new Date('2026-03-15T23:59:59Z'), outputFormat: 'csv',
      objectKey: 'report-schedules/s1/run1.csv', byteSize: 42, rowCount: 3,
      status: 'success', errorMessage: null,
    });
    const runs = await store.listRuns({ scheduleId: 's1', limit: 10, offset: 0 });
    expect(runs.total).toBe(1);
    expect(runs.runs[0]!.objectKey).toBe('report-schedules/s1/run1.csv');
    expect((await store.getRun('run1'))?.status).toBe('success');

    await store.remove('s1');
    expect(await store.get('s1')).toBeNull();
    await db.destroy();
  });
});
