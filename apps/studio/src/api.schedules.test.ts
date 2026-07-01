import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchSchedules, createSchedule, updateSchedule, deleteSchedule, runScheduleNow, fetchScheduleRuns, downloadScheduleRun } from './api';

afterEach(() => vi.restoreAllMocks());

describe('schedule api', () => {
  it('createSchedule POSTs the body and returns the record', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 's1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createSchedule('amr-resistance', { frequency: 'weekly', dayOfWeek: 1, outputFormat: 'pdf', params: {} })).resolves.toEqual({ id: 's1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/reports/amr-resistance/schedules', expect.objectContaining({ method: 'POST' }));
  });

  it('updateSchedule PATCHes', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 's1', enabled: false }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await updateSchedule('s1', { enabled: false });
    expect(fetchMock).toHaveBeenCalledWith('/api/reports/schedules/s1', expect.objectContaining({ method: 'PATCH' }));
  });

  it('deleteSchedule + runScheduleNow + fetchSchedules + fetchScheduleRuns hit the right urls', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(
      url.includes('schedule-runs') ? JSON.stringify({ runs: [], total: 0 }) : '[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await deleteSchedule('s1');
    await runScheduleNow('s1');
    await fetchSchedules('amr-resistance');
    await expect(fetchScheduleRuns({ reportId: 'amr-resistance', limit: 5 })).resolves.toEqual({ runs: [], total: 0 });
    expect(fetchMock).toHaveBeenCalledWith('/api/reports/schedules/s1', expect.objectContaining({ method: 'DELETE' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/reports/schedules/s1/run', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/reports/amr-resistance/schedules');
    expect(fetchMock).toHaveBeenCalledWith('/api/reports/schedule-runs?reportId=amr-resistance&limit=5');
  });

  it('downloadScheduleRun fetches the blob', async () => {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => 'blob:x');
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['x']), { status: 200 })));
    await expect(downloadScheduleRun('run1')).resolves.toBeUndefined();
  });

  it('mutating helpers reject on non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 403 })));
    await expect(deleteSchedule('s1')).rejects.toThrow();
  });
});
