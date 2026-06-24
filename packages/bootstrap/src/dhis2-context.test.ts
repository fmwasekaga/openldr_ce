import { describe, it, expect, vi } from 'vitest';
import { createPluginTarget } from './connector-target';

const enc = (o: unknown) => o;

describe('createPluginTarget', () => {
  function fakeSink(outputs: Record<string, unknown>) {
    return {
      id: 'dhis2-sink', version: '0.1.0',
      entrypoints: ['health_check', 'pull_metadata', 'push_aggregate', 'push_tracker'],
      invoke: vi.fn(async (ep: string) => outputs[ep]),
    };
  }

  it('pushAggregate dry-run pins no host (no egress)', async () => {
    const sink = fakeSink({ push_aggregate: { payload: { dataValues: [] }, skipped: [] } });
    const t = createPluginTarget(sink as never, { baseUrl: 'https://x' }, 'x.example');
    const out = await t.pushAggregate({ rows: [], mapping: {}, orgUnitMap: {}, period: '2026Q1', dryRun: true });
    expect(out).toEqual({ payload: { dataValues: [] }, skipped: [] });
    expect(sink.invoke).toHaveBeenCalledWith('push_aggregate', expect.objectContaining({ dryRun: true }), { config: { baseUrl: 'https://x' }, allowedHosts: [] });
  });

  it('pushAggregate real push pins [allowedHost]', async () => {
    const sink = fakeSink({ push_aggregate: { payload: { dataValues: [] }, skipped: [], result: { status: 'success', imported: 1, updated: 0, ignored: 0, deleted: 0, conflicts: [], raw: {} } } });
    const t = createPluginTarget(sink as never, { baseUrl: 'https://x' }, 'x.example');
    const out = await t.pushAggregate({ rows: [], mapping: {}, orgUnitMap: {}, period: '2026Q1', dryRun: false });
    expect(out.result?.imported).toBe(1);
    expect(sink.invoke).toHaveBeenCalledWith('push_aggregate', expect.objectContaining({ dryRun: false }), { config: { baseUrl: 'https://x' }, allowedHosts: ['x.example'] });
  });

  it('healthCheck maps ok:false to a down HealthResult', async () => {
    const sink = fakeSink({ health_check: { ok: false, error: 'boom' } });
    const t = createPluginTarget(sink as never, {}, null);
    const h = await t.healthCheck();
    expect(h.status).toBe('down');
    expect(h.detail).toContain('boom');
  });

  it('healthCheck maps ok:true to up', async () => {
    const sink = fakeSink({ health_check: { ok: true, version: '2.40' } });
    const t = createPluginTarget(sink as never, {}, null);
    expect((await t.healthCheck()).status).toBe('up');
  });
});

void enc;
