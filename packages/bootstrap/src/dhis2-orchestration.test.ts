import { describe, it, expect, vi } from 'vitest';
import { createLogger } from '@openldr/core';
import { createDhis2Orchestration } from './dhis2-orchestration';

const aggMapping = {
  kind: 'aggregate',
  id: 'm1',
  name: 'm1',
  source: { kind: 'report', reportId: 'amr-resistance', params: { region: 'north' } },
  orgUnitColumn: 'facility',
  columns: [],
};

const trackerMapping = {
  kind: 'tracker',
  id: 'tm1',
  name: 'tm1',
  source: { kind: 'event-source', sourceId: 'amr-isolates' },
};

function fakeConnector(over: Record<string, unknown> = {}) {
  return {
    id: 'c1', name: 'DHIS2', pluginId: 'dhis2-sink', kind: 'sink',
    allowedHost: 'dhis.example', enabled: true, createdAt: new Date(0), updatedAt: new Date(0),
    ...over,
  };
}

function memData() {
  const docs = new Map<string, unknown>();
  return {
    store: {
      async get(_p: string, _c: string, k: string) { return docs.get(k) ?? null; },
      async put(_p: string, _c: string, k: string, doc: unknown) { docs.set(k, doc); },
      async delete(_p: string, _c: string, k: string) { docs.delete(k); },
      async list(_p: string, c: string) { return [...docs.entries()].map(([key, doc]) => ({ collection: c, key, doc, updatedAt: new Date(0) })); },
      async purge() { docs.clear(); },
    } as any,
    docs,
  };
}

function pushResult(over: Record<string, unknown> = {}) {
  return { status: 'OK', imported: 1, updated: 0, ignored: 0, conflicts: [], ...over };
}

function deps(over: Record<string, unknown> = {}) {
  const data = memData();
  const target = {
    pullMetadata: vi.fn(async () => ({ dataElements: [], orgUnits: [], categoryOptionCombos: [], programs: [], programStages: [] })),
    pushAggregate: vi.fn(async () => ({ payload: { dataValues: [{ dataElement: 'de1', value: 1 }] }, skipped: [], result: pushResult() })),
    pushEvents: vi.fn(async () => ({ payload: { events: [{ event: 'e1' }] }, skipped: [], result: pushResult() })),
    healthCheck: vi.fn(async () => ({ status: 'up' as const })),
  };
  const base = {
    connectors: {
      get: vi.fn(async (_id: string) => fakeConnector()),
      getDecryptedConfig: vi.fn(async () => ({ baseUrl: 'https://dhis.example', token: 's3cr3t' })),
    },
    loadSink: vi.fn(async () => ({ invoke: vi.fn() })),
    reporting: {
      run: vi.fn(async () => ({ rows: [{ facility: 'f1', value: 1 }] })),
      runEventSource: vi.fn(async () => ({ rows: [{ id: 'i1' }] })),
    },
    createTarget: vi.fn(() => target),
    secretsKey: 'k',
    pluginData: data.store,
    logger: createLogger({ level: 'silent' }),
  };
  return { deps: { ...base, ...over }, target, data };
}

describe('createDhis2Orchestration', () => {
  it('aggregate push runs the report and calls pushAggregate with the passed orgUnitMap, returning the build', async () => {
    const { deps: d, target } = deps();
    const orch = createDhis2Orchestration(d as any);
    const out = await orch.push({ connectorId: 'c1', mapping: aggMapping, orgUnitMap: { f1: 'OU1' }, period: '2026', dryRun: false });
    expect(d.reporting.run).toHaveBeenCalledWith('amr-resistance', { region: 'north' });
    expect(target.pushAggregate).toHaveBeenCalledWith(expect.objectContaining({ orgUnitMap: { f1: 'OU1' }, period: '2026', dryRun: false }));
    expect(out).toMatchObject({ kind: 'aggregate', dryRun: false, build: { payload: { dataValues: [{ dataElement: 'de1', value: 1 }] }, skipped: [] } });
  });

  it('dryRun aggregate does NOT write a push-history doc', async () => {
    const { deps: d, data } = deps();
    const orch = createDhis2Orchestration(d as any);
    const out = await orch.push({ connectorId: 'c1', mapping: aggMapping, period: '2026', dryRun: true });
    expect(out).toMatchObject({ kind: 'aggregate', dryRun: true });
    expect(data.docs.size).toBe(0);
  });

  it('a real aggregate push writes a pushes doc with the right fields', async () => {
    const { deps: d, data } = deps();
    const orch = createDhis2Orchestration(d as any);
    await orch.push({ connectorId: 'c1', mapping: aggMapping, period: '2026', dryRun: false });
    expect(data.docs.size).toBe(1);
    const doc = [...data.docs.values()][0] as Record<string, unknown>;
    expect(doc).toMatchObject({
      period: '2026', kind: 'aggregate', connectorId: 'c1', status: 'OK',
      imported: 1, updated: 0, ignored: 0, conflicts: 0, skipped: 0, count: 1, trigger: 'manual',
    });
    expect(typeof doc.id).toBe('string');
    expect(typeof doc.at).toBe('string');
  });

  it('a tracker real push runs the event source and writes a tracker pushes doc', async () => {
    const { deps: d, target, data } = deps();
    const orch = createDhis2Orchestration(d as any);
    const out = await orch.push({ connectorId: 'c1', mapping: trackerMapping, period: '202601', dryRun: false });
    expect(d.reporting.runEventSource).toHaveBeenCalledWith('amr-isolates', expect.objectContaining({ from: expect.any(String), to: expect.any(String) }));
    expect(target.pushEvents).toHaveBeenCalled();
    expect(out).toMatchObject({ kind: 'tracker', dryRun: false });
    const doc = [...data.docs.values()][0] as Record<string, unknown>;
    expect(doc).toMatchObject({ kind: 'tracker', count: 1, connectorId: 'c1' });
  });

  it('tags the push doc with a supplied trigger', async () => {
    const { deps: d, data } = deps();
    const orch = createDhis2Orchestration(d as any);
    await orch.push({ connectorId: 'c1', mapping: aggMapping, period: '2026', dryRun: false, trigger: 'scheduled' });
    const doc = [...data.docs.values()][0] as Record<string, unknown>;
    expect(doc.trigger).toBe('scheduled');
  });

  it('a failed real push writes a failure doc and rethrows', async () => {
    const { deps: d, target, data } = deps();
    target.pushAggregate.mockRejectedValueOnce(new Error('egress blew up'));
    const orch = createDhis2Orchestration(d as any);
    await expect(orch.push({ connectorId: 'c1', mapping: aggMapping, period: '2026', dryRun: false })).rejects.toThrow(/egress blew up/);
    expect(data.docs.size).toBe(1);
    const doc = [...data.docs.values()][0] as Record<string, unknown>;
    expect(doc).toMatchObject({ status: 'failed', kind: 'aggregate', connectorId: 'c1' });
    expect(doc.error).toMatch(/egress blew up/);
  });

  it('a failed dryRun push does NOT write a doc', async () => {
    const { deps: d, target, data } = deps();
    target.pushAggregate.mockRejectedValueOnce(new Error('boom'));
    const orch = createDhis2Orchestration(d as any);
    await expect(orch.push({ connectorId: 'c1', mapping: aggMapping, period: '2026', dryRun: true })).rejects.toThrow();
    expect(data.docs.size).toBe(0);
  });

  it('metadata resolves the connector and returns pullMetadata', async () => {
    const { deps: d, target } = deps();
    const orch = createDhis2Orchestration(d as any);
    const md = await orch.metadata('c1');
    expect(d.connectors.get).toHaveBeenCalledWith('c1');
    expect(d.createTarget).toHaveBeenCalled();
    expect(target.pullMetadata).toHaveBeenCalled();
    expect(md).toMatchObject({ dataElements: [], orgUnits: [] });
  });

  it('validate returns the validator output (string[])', async () => {
    const { deps: d } = deps();
    const orch = createDhis2Orchestration(d as any);
    const errs = await orch.validate({ connectorId: 'c1', mapping: aggMapping });
    expect(Array.isArray(errs)).toBe(true);
  });

  it('throws for a missing connector', async () => {
    const { deps: d } = deps({ connectors: { get: vi.fn(async () => null), getDecryptedConfig: vi.fn() } });
    const orch = createDhis2Orchestration(d as any);
    await expect(orch.metadata('nope')).rejects.toThrow();
  });

  it('throws for a disabled connector', async () => {
    const { deps: d } = deps({ connectors: { get: vi.fn(async () => fakeConnector({ enabled: false })), getDecryptedConfig: vi.fn() } });
    const orch = createDhis2Orchestration(d as any);
    await expect(orch.metadata('c1')).rejects.toThrow(/disabled/);
  });

  it('throws when the sink plugin is not installed', async () => {
    const { deps: d } = deps({ loadSink: vi.fn(async () => undefined) });
    const orch = createDhis2Orchestration(d as any);
    await expect(orch.metadata('c1')).rejects.toThrow();
  });

  it('mirrors host audit records when an audit store is supplied', async () => {
    const records: unknown[] = [];
    const audit = { record: vi.fn(async (e: unknown) => { records.push(e); return e; }), list: vi.fn(), count: vi.fn(), get: vi.fn() };
    const { deps: d } = deps({ audit });
    const orch = createDhis2Orchestration(d as any);
    await orch.push({ connectorId: 'c1', mapping: aggMapping, period: '2026', dryRun: false });
    expect(audit.record).toHaveBeenCalled();
    expect((records[0] as { action: string }).action).toBe('dhis2.push');
  });
});
