import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerReportRoutes } from './reports-routes';
import { registerErrorHandler } from './error-handler';
import { ReportNotFoundError } from '@openldr/bootstrap';

function appWith(reporting: unknown) {
  const app = Fastify();
  registerErrorHandler(app);
  registerReportRoutes(app, { reporting } as never);
  return app;
}

const okResult = {
  columns: [{ key: 'antibiotic', label: 'Antibiotic', kind: 'string' }, { key: 'percentR', label: '%R', kind: 'percent' }],
  rows: [{ antibiotic: 'AMP', percentR: 72 }],
  chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
  meta: { generatedAt: '2026-01-01T00:00:00Z', rowCount: 1 },
};

describe('report routes', () => {
  it('GET /api/reports lists', async () => {
    const app = appWith({ list: () => [{ id: 'amr-resistance', name: 'AMR', description: 'd' }], run: vi.fn() });
    const res = await app.inject({ method: 'GET', url: '/api/reports' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('GET /api/reports/:id returns result', async () => {
    const app = appWith({ list: vi.fn(), run: vi.fn(async () => okResult) });
    const res = await app.inject({ method: 'GET', url: '/api/reports/amr-resistance?from=2026-01-01' });
    expect(res.statusCode).toBe(200);
    expect(res.json().rows[0].antibiotic).toBe('AMP');
  });

  it('404 on unknown report', async () => {
    const app = appWith({ list: vi.fn(), run: vi.fn(async () => { throw new ReportNotFoundError('nope'); }) });
    const res = await app.inject({ method: 'GET', url: '/api/reports/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('RP0002');
  });

  it('400 on invalid params (ZodError) surfaces code + offending field', async () => {
    const { ZodError } = await import('zod');
    const issue = { code: 'custom' as const, path: ['from'], message: 'Required' };
    const app = appWith({ list: vi.fn(), run: vi.fn(async () => { throw new ZodError([issue]); }) });
    const res = await app.inject({ method: 'GET', url: '/api/reports/amr-resistance' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('RP0004');
    expect(res.json().error).toContain('from');
  });

  it('503 on connection failure', async () => {
    const app = appWith({ list: vi.fn(), run: vi.fn(async () => { throw new Error('connect ECONNREFUSED'); }) });
    const res = await app.inject({ method: 'GET', url: '/api/reports/amr-resistance' });
    expect(res.statusCode).toBe(503);
  });

  it('CSV export sets content-type and hits the csv handler', async () => {
    const app = appWith({ list: vi.fn(), run: vi.fn(async () => okResult) });
    const res = await app.inject({ method: 'GET', url: '/api/reports/amr-resistance.csv' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('Antibiotic,%R');
  });
});

describe('GET /api/reports/:id/options', () => {
  const reporting = {
    list: vi.fn(),
    run: vi.fn(),
    options: async (id: string) => (id === 'amr-resistance' ? { facility: ['F1', 'F2'] } : {}),
  };

  it('returns the option map for a report', async () => {
    const app = appWith(reporting);
    const res = await app.inject({ method: 'GET', url: '/api/reports/amr-resistance/options' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ facility: ['F1', 'F2'] });
  });

  it('returns {} for reports without options', async () => {
    const app = appWith(reporting);
    const res = await app.inject({ method: 'GET', url: '/api/reports/amr-antibiogram/options' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });
});

describe('report run history routes', () => {
  function appWithRuns() {
    const recorded: unknown[] = [];
    const ctx = {
      reporting: {
        list: () => [{ id: 'amr-resistance', name: 'AMR Resistance Rate', description: '', category: 'amr', parameters: [] }],
        run: async () => ({ columns: [], rows: [], chart: { type: 'stat', value: '0', label: 'x' }, meta: { generatedAt: '', rowCount: 0 } }),
        renderPdf: async () => Buffer.from(''),
        options: async () => ({}),
      },
      reportRuns: {
        record: async (r: unknown) => { recorded.push(r); },
        list: async () => ({ runs: [{ id: 'r1', reportId: 'amr-resistance', reportName: 'AMR Resistance Rate', format: 'preview', params: {}, rowCount: 1, userName: 'ada', createdAt: new Date('2026-01-01') }], total: 1 }),
      },
    } as unknown as Parameters<typeof registerReportRoutes>[1];

    const app = Fastify();
    registerErrorHandler(app);
    app.addHook('onRequest', async (req) => {
      (req as { user?: unknown }).user = { id: 'u1', username: 'ada', displayName: 'Ada', roles: [], status: 'active' };
    });
    registerReportRoutes(app, ctx);
    return { app, recorded };
  }

  it('POST /api/reports/:id/runs records with the stamped user + resolved name', async () => {
    const { app, recorded } = appWithRuns();
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/api/reports/amr-resistance/runs',
      payload: { format: 'preview', rowCount: 3, params: { from: '2026-01-01' } },
    });
    expect(res.statusCode).toBe(201);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      reportId: 'amr-resistance', reportName: 'AMR Resistance Rate',
      format: 'preview', rowCount: 3, userId: 'u1', userName: 'ada',
    });
    await app.close();
  });

  it('POST rejects an invalid format with 400', async () => {
    const { app } = appWithRuns();
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/reports/amr-resistance/runs', payload: { format: 'nope' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('POST unknown report id → 404', async () => {
    const { app } = appWithRuns();
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/reports/does-not-exist/runs', payload: { format: 'preview' } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET /api/reports/runs returns { runs, total }', async () => {
    const { app } = appWithRuns();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/reports/runs?reportId=amr-resistance&limit=10' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 1 });
    expect(res.json().runs).toHaveLength(1);
    await app.close();
  });
});

describe('report schedule routes', () => {
  function appWithSchedules(roles = ['lab_manager']) {
    const created: any[] = [];
    const ctx = {
      reporting: { list: () => [{ id: 'amr-resistance', name: 'AMR Resistance Rate', description: '', category: 'amr', parameters: [] }] },
      eventing: { publish: async () => {} },
      reportSchedules: {
        create: async (s: any) => { created.push(s); },
        listPaged: async () => ({ schedules: [{ id: 's1', reportId: 'amr-resistance', params: {}, frequency: 'weekly', dayOfWeek: 1, dayOfMonth: null, outputFormat: 'pdf', enabled: true, lastRunAt: null, nextDueAt: new Date('2026-03-16T06:00:00Z'), createdBy: 'u1' }], total: 1 }),
        get: async (id: string) => (id === 's1' ? { id: 's1', reportId: 'amr-resistance', frequency: 'weekly', dayOfWeek: 1, dayOfMonth: null, outputFormat: 'pdf', enabled: true, params: {}, lastRunAt: null, nextDueAt: null, createdBy: 'u1' } : null),
        update: async () => {}, remove: async () => {},
      },
      reportScheduler: { runNow: () => {} },
    } as unknown as Parameters<typeof registerReportRoutes>[1];
    const app = Fastify();
    registerErrorHandler(app);
    app.addHook('onRequest', async (req) => { (req as { user?: unknown }).user = { id: 'u1', username: 'ada', displayName: 'Ada', roles, status: 'active' }; });
    registerReportRoutes(app, ctx);
    return { app, created };
  }

  it('POST creates a schedule with computed nextDueAt + createdBy', async () => {
    const { app, created } = appWithSchedules();
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/reports/amr-resistance/schedules', payload: { frequency: 'weekly', dayOfWeek: 1, outputFormat: 'pdf' } });
    expect(res.statusCode).toBe(201);
    expect(created[0]).toMatchObject({ reportId: 'amr-resistance', frequency: 'weekly', outputFormat: 'pdf', createdBy: 'u1' });
    expect(created[0].nextDueAt).toBeInstanceOf(Date);
    await app.close();
  });

  it('GET lists schedules for a report', async () => {
    const { app } = appWithSchedules();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/reports/amr-resistance/schedules' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 1 });
    expect(res.json().schedules).toHaveLength(1);
    await app.close();
  });

  it('forbids creation for a non-manager (403)', async () => {
    const { app } = appWithSchedules(['lab_technician']);
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/reports/amr-resistance/schedules', payload: { frequency: 'daily', outputFormat: 'csv' } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('PATCH updates and DELETE removes; run-now returns 202', async () => {
    const { app } = appWithSchedules();
    await app.ready();
    expect((await app.inject({ method: 'PATCH', url: '/api/reports/schedules/s1', payload: { enabled: false } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: '/api/reports/schedules/s1' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/reports/schedules/s1/run' })).statusCode).toBe(202);
    await app.close();
  });
});

describe('report schedule-run routes', () => {
  function appWithRuns() {
    const ctx = {
      reportSchedules: {
        listRuns: async () => ({ runs: [{ id: 'run1', scheduleId: 's1', reportId: 'amr-resistance', reportName: 'AMR', runAt: new Date('2026-03-16T06:05:00Z'), periodStart: null, periodEnd: null, outputFormat: 'csv', objectKey: 'report-schedules/s1/run1.csv', byteSize: 4, rowCount: 1, status: 'success', errorMessage: null }], total: 1 }),
        getRun: async (id: string) => (id === 'run1' ? { id: 'run1', scheduleId: 's1', reportId: 'amr-resistance', reportName: 'AMR', runAt: new Date(), periodStart: null, periodEnd: null, outputFormat: 'csv', objectKey: 'report-schedules/s1/run1.csv', byteSize: 4, rowCount: 1, status: 'success', errorMessage: null } : id === 'failed' ? { id: 'failed', objectKey: null, outputFormat: 'csv' } : null),
      },
      blob: { get: async () => new TextEncoder().encode('a,b\n1,2') },
    } as unknown as Parameters<typeof registerReportRoutes>[1];
    const app = Fastify();
    registerErrorHandler(app);
    app.addHook('onRequest', async (req) => { (req as { user?: unknown }).user = { id: 'u1', username: 'ada', displayName: 'Ada', roles: ['lab_technician'], status: 'active' }; });
    registerReportRoutes(app, ctx);
    return { app };
  }

  it('GET schedule-runs returns { runs, total }', async () => {
    const { app } = appWithRuns();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/reports/schedule-runs?reportId=amr-resistance&limit=5' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 1 });
    await app.close();
  });

  it('download streams the blob with a content-type', async () => {
    const { app } = appWithRuns();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/reports/schedule-runs/run1/download' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('a,b');
    await app.close();
  });

  it('download 404 for a failed run with no object_key', async () => {
    const { app } = appWithRuns();
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/api/reports/schedule-runs/failed/download' })).statusCode).toBe(404);
    await app.close();
  });
});
