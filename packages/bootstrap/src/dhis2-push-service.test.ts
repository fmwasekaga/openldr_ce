import { describe, it, expect, vi } from 'vitest';
import { buildDhis2PushService } from './dhis2-push-service';

function memData(seed: { mappings?: Record<string, unknown>; orgUnitMaps?: unknown[] } = {}) {
  const mappings = new Map<string, unknown>(Object.entries(seed.mappings ?? {}));
  const orgUnitMaps = seed.orgUnitMaps ?? [];
  return {
    async get(_p: string, c: string, k: string) {
      return c === 'mappings' ? (mappings.get(k) ?? null) : null;
    },
    async list(_p: string, c: string) {
      if (c === 'orgUnitMaps') {
        return orgUnitMaps.map((doc, i) => ({ collection: c, key: String(i), doc, updatedAt: new Date(0) }));
      }
      return [];
    },
    put: vi.fn(), delete: vi.fn(), purge: vi.fn(),
  } as any;
}

const aggDef = { kind: 'aggregate', id: 'm1', name: 'AMR', connectorId: 'c1', source: { kind: 'report', reportId: 'r1' }, orgUnitColumn: 'facility', columns: [] };

describe('buildDhis2PushService', () => {
  it('loads the mapping + org-unit map from plugin_data and pushes via the orchestration', async () => {
    const push = vi.fn(async () => ({ kind: 'aggregate', dryRun: false, build: { payload: { dataValues: [] }, skipped: [] } }) as any);
    const pluginData = memData({
      mappings: { m1: { id: 'm1', name: 'AMR', definition: aggDef } },
      orgUnitMaps: [
        { facilityId: 'f1', orgUnitId: 'OU1' },
        { facilityId: 'f2', orgUnitId: 'OU2' },
        { facilityId: 'bad' }, // missing orgUnitId -> filtered out
      ],
    });
    const svc = buildDhis2PushService({ pluginData, push });
    const out = await svc({ mappingId: 'm1', period: '2026', dryRun: false });
    expect(push).toHaveBeenCalledWith({
      connectorId: 'c1',
      mapping: aggDef,
      orgUnitMap: { f1: 'OU1', f2: 'OU2' },
      period: '2026',
      dryRun: false,
      trigger: 'workflow',
    });
    expect(out).toMatchObject({ kind: 'aggregate' });
  });

  it('passes dryRun through and defaults it to false', async () => {
    const push = vi.fn(async () => ({}) as any);
    const pluginData = memData({ mappings: { m1: { id: 'm1', name: 'AMR', definition: aggDef } } });
    const svc = buildDhis2PushService({ pluginData, push });
    await svc({ mappingId: 'm1', period: '2026', dryRun: true });
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, orgUnitMap: {} }));
    await svc({ mappingId: 'm1', period: '2026' });
    expect(push).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: false }));
  });

  it('throws for an unknown mapping', async () => {
    const push = vi.fn();
    const svc = buildDhis2PushService({ pluginData: memData(), push });
    await expect(svc({ mappingId: 'nope', period: '2026' })).rejects.toThrow(/unknown DHIS2 mapping/);
    expect(push).not.toHaveBeenCalled();
  });

  it('throws when the mapping has no connector configured', async () => {
    const push = vi.fn();
    const noConn = { id: 'm1', name: 'AMR', definition: { kind: 'aggregate', id: 'm1' } };
    const pluginData = memData({ mappings: { m1: noConn } });
    const svc = buildDhis2PushService({ pluginData, push });
    await expect(svc({ mappingId: 'm1', period: '2026' })).rejects.toThrow(/no connector/);
    expect(push).not.toHaveBeenCalled();
  });
});
