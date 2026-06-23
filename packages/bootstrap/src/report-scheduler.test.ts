import { describe, it, expect, vi } from 'vitest';
import { createReportScheduler } from './report-scheduler';

function deps() {
  const put = vi.fn(async () => {});
  const recorded: any[] = [];
  const schedule = {
    id: 's1', reportId: 'amr-resistance', params: { facility: 'F1' },
    frequency: 'weekly', dayOfWeek: 1, dayOfMonth: null, outputFormat: 'csv',
    enabled: true, lastRunAt: null, nextDueAt: null, createdBy: 'u1',
  };
  const schedules = {
    get: vi.fn(async () => schedule),
    recordRun: vi.fn(async (r: any) => { recorded.push(r); }),
    markRun: vi.fn(async () => {}),
    setNextDue: vi.fn(async () => {}),
    list: vi.fn(async () => [schedule]),
  };
  const reporting = {
    list: () => [{ id: 'amr-resistance', name: 'AMR Resistance Rate', description: '', category: 'amr',
      parameters: [{ id: 'dateRange', label: 'Date range', type: 'daterange', required: false }] }],
    run: vi.fn(async () => ({ columns: [{ key: 'antibiotic', label: 'Antibiotic', kind: 'string' }],
      rows: [{ antibiotic: 'AMP' }], chart: { type: 'bar' }, meta: { generatedAt: '', rowCount: 1 } })),
    renderPdf: vi.fn(async () => Buffer.from('%PDF')),
  };
  const logger = { error: vi.fn(), info: vi.fn() };
  return { put, recorded, schedules, reporting, logger,
    scheduler: createReportScheduler({ reporting: reporting as any, blob: { put } as any, schedules: schedules as any, logger: logger as any }) };
}

describe('report scheduler runDue', () => {
  it('renders csv, stores blob, records a success run with injected from/to', async () => {
    const d = deps();
    await d.scheduler.runDue('s1');
    expect(d.reporting.run).toHaveBeenCalledWith('amr-resistance', expect.objectContaining({ facility: 'F1', from: expect.any(String), to: expect.any(String) }));
    expect(d.put).toHaveBeenCalledWith(expect.stringMatching(/^report-schedules\/s1\/.*\.csv$/), expect.anything(), 'text/csv');
    expect(d.recorded[0]).toMatchObject({ scheduleId: 's1', status: 'success', outputFormat: 'csv', rowCount: 1 });
    expect(d.schedules.markRun).toHaveBeenCalled();
  });

  it('records a failed run (and does not throw) when rendering fails', async () => {
    const d = deps();
    d.reporting.run.mockRejectedValueOnce(new Error('boom'));
    await expect(d.scheduler.runDue('s1')).resolves.toBeUndefined();
    expect(d.recorded[0]).toMatchObject({ status: 'failed', errorMessage: expect.stringContaining('boom'), objectKey: null });
  });
});

describe('registerRunner', () => {
  it('subscribes and re-arms next due after a run', async () => {
    const d = deps();
    const handlers: Record<string, (e: any) => Promise<void>> = {};
    const eventing = {
      subscribe: vi.fn(async (type: string, h: any) => { handlers[type] = h; }),
      publish: vi.fn(async () => {}),
    };
    await d.scheduler.registerRunner(eventing as any);
    expect(eventing.subscribe).toHaveBeenCalledWith('report.schedule.due', expect.any(Function));
    await handlers['report.schedule.due']!({ payload: { scheduleId: 's1' } });
    expect(d.schedules.setNextDue).toHaveBeenCalledWith('s1', expect.any(Date));
    expect(eventing.publish).toHaveBeenCalledWith(
      { type: 'report.schedule.due', payload: { scheduleId: 's1' } },
      expect.objectContaining({ availableAt: expect.any(Date) }),
    );
  });
});

describe('reconcile', () => {
  const baseSchedule = {
    id: 's1', reportId: 'amr-resistance', params: {}, frequency: 'weekly',
    dayOfWeek: 1, dayOfMonth: null, outputFormat: 'csv', enabled: true,
    lastRunAt: null, createdBy: 'u1',
  };
  function schedulerWith(schedule: Record<string, unknown>) {
    const setNextDue = vi.fn(async () => {});
    const scheduler = createReportScheduler({
      reporting: { list: () => [], run: vi.fn(), renderPdf: vi.fn() } as any,
      blob: { put: vi.fn() } as any,
      schedules: { list: async () => [schedule], setNextDue, get: async () => schedule } as any,
      logger: { error: vi.fn() } as any,
    });
    return { scheduler, setNextDue };
  }

  it('skips schedules already armed in the future (no duplicate re-arm)', async () => {
    const { scheduler, setNextDue } = schedulerWith({ ...baseSchedule, nextDueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
    const eventing = { subscribe: vi.fn(async () => {}), publish: vi.fn(async () => {}) };
    await scheduler.reconcile(eventing as any);
    expect(eventing.publish).not.toHaveBeenCalled();
    expect(setNextDue).not.toHaveBeenCalled();
  });

  it('arms schedules that are overdue or never armed', async () => {
    const { scheduler, setNextDue } = schedulerWith({ ...baseSchedule, nextDueAt: null });
    const eventing = { subscribe: vi.fn(async () => {}), publish: vi.fn(async () => {}) };
    await scheduler.reconcile(eventing as any);
    expect(setNextDue).toHaveBeenCalledWith('s1', expect.any(Date));
    expect(eventing.publish).toHaveBeenCalledWith(
      { type: 'report.schedule.due', payload: { scheduleId: 's1' } },
      expect.objectContaining({ availableAt: expect.any(Date) }),
    );
  });
});
