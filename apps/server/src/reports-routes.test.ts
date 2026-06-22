import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerReportRoutes } from './reports-routes';
import { ReportNotFoundError } from '@openldr/bootstrap';

function appWith(reporting: unknown) {
  const app = Fastify();
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
  });

  it('400 on invalid params (ZodError)', async () => {
    const { ZodError } = await import('zod');
    const app = appWith({ list: vi.fn(), run: vi.fn(async () => { throw new ZodError([]); }) });
    const res = await app.inject({ method: 'GET', url: '/api/reports/amr-resistance' });
    expect(res.statusCode).toBe(400);
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
