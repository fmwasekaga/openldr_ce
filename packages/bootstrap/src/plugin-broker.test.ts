import { describe, it, expect } from 'vitest';
import { createPluginBroker } from './plugin-broker';

function memData() {
  const m = new Map<string, unknown>();
  const k = (p: string, c: string, key: string) => `${p} ${c} ${key}`;
  return {
    store: {
      async get(p: string, c: string, key: string) { return m.has(k(p, c, key)) ? m.get(k(p, c, key)) : null; },
      async put(p: string, c: string, key: string, doc: unknown) { m.set(k(p, c, key), doc); },
      async delete(p: string, c: string, key: string) { m.delete(k(p, c, key)); },
      async list(p: string, c: string) { return [...m.entries()].filter(([kk]) => kk.startsWith(`${p} ${c} `)).map(([kk, doc]) => ({ collection: c, key: kk.split(' ')[2], doc, updatedAt: new Date(0) })); },
      async purge(p: string) { for (const kk of [...m.keys()]) if (kk.startsWith(`${p} `)) m.delete(kk); },
    },
  };
}

function broker(opts: {
  caps: unknown[] | undefined;
  uiEnabled?: boolean;
  reporting?: any;
  connectors?: any;
  loadSink?: any;
  testConnector?: any;
}) {
  const data = memData();
  const row = { id: 'p1', version: '1.0.0', enabled: true, manifest: opts.caps === undefined ? {} : { capabilities: opts.caps } };
  const b = createPluginBroker({
    plugins: { list: async () => [row], loadSink: opts.loadSink ?? (async () => undefined) } as any,
    pluginData: data.store as any,
    reporting: opts.reporting ?? { list: () => [], run: async () => ({ columns: [], rows: [], meta: {} }) },
    connectors: opts.connectors ?? { list: async () => [], get: async () => null },
    testConnector: opts.testConnector,
    policy: () => ({ uiEnabled: opts.uiEnabled ?? true, egressEnabled: true }),
  });
  return { b, data };
}

const principal = { id: 'u1', roles: ['lab_admin'] };

describe('plugin broker', () => {
  it('allows private storage with no capability and namespaces by the trusted pluginId', async () => {
    const { b } = broker({ caps: [] });
    const put = await b.handle('p1', principal, { kind: 'storage.put', collection: 'c', key: 'k', doc: { n: 1 } });
    expect(put.ok).toBe(true);
    const got = await b.handle('p1', principal, { kind: 'storage.get', collection: 'c', key: 'k' });
    expect(got).toEqual({ ok: true, data: { n: 1 } });
  });

  it('denies reports.list without the host:reports capability', async () => {
    const { b } = broker({ caps: [] });
    const r = await b.handle('p1', principal, { kind: 'reports.list' });
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/host:reports/);
  });

  it('allows reports.list with the host:reports capability', async () => {
    const { b } = broker({ caps: [{ kind: 'host:reports' }], reporting: { list: () => [{ id: 'r1', name: 'R1' }], run: async () => ({ columns: [], rows: [], meta: {} }) } });
    const r = await b.handle('p1', principal, { kind: 'reports.list' });
    expect(r).toEqual({ ok: true, data: [{ id: 'r1', name: 'R1' }] });
  });

  it('refuses everything when policy.uiEnabled is false', async () => {
    const { b } = broker({ caps: [{ kind: 'host:reports' }], uiEnabled: false });
    expect((await b.handle('p1', principal, { kind: 'reports.list' })).ok).toBe(false);
    expect((await b.handle('p1', principal, { kind: 'storage.get', collection: 'c', key: 'k' })).ok).toBe(false);
  });

  it('refuses calls for an unknown / not-installed plugin', async () => {
    const { b } = broker({ caps: [] });
    const r = await b.handle('ghost', principal, { kind: 'storage.get', collection: 'c', key: 'k' });
    expect(r.ok).toBe(false);
  });

  it('connectors.list is gated by host:connectors and returns the store list (masked)', async () => {
    const { b } = broker({ caps: [{ kind: 'host:connectors' }], connectors: { list: async () => [{ id: 'x', name: 'X', pluginId: 'dhis2-sink', enabled: true }], get: async () => null } });
    const r = await b.handle('p1', principal, { kind: 'connectors.list' });
    expect(r).toEqual({ ok: true, data: [{ id: 'x', name: 'X', pluginId: 'dhis2-sink', enabled: true }] });
  });

  it('invoke calls the plugin own wasm (no host capability) and returns its output', async () => {
    const { b } = broker({ caps: [], loadSink: async () => ({ invoke: async (_e: string, input: unknown) => ({ echoed: input }) }) });
    const r = await b.handle('p1', principal, { kind: 'invoke', entrypoint: 'echo', input: { hi: 1 } });
    expect(r).toEqual({ ok: true, data: { echoed: { hi: 1 } } });
  });

  it('legacy (capabilities===undefined) rows are grandfathered unrestricted', async () => {
    const { b } = broker({ caps: undefined, reporting: { list: () => [{ id: 'r1' }], run: async () => ({ columns: [], rows: [], meta: {} }) } });
    const r = await b.handle('p1', principal, { kind: 'reports.list' });
    expect(r.ok).toBe(true);
  });

  it('denies a call for a disabled plugin', async () => {
    const data = memData();
    const b = createPluginBroker({
      plugins: { list: async () => [{ id: 'p1', version: '1', enabled: false, manifest: { capabilities: [] } }], loadSink: async () => undefined } as any,
      pluginData: data.store as any,
      reporting: { list: () => [], run: async () => ({}) },
      connectors: { list: async () => [], get: async () => null },
      policy: () => ({ uiEnabled: true, egressEnabled: true }),
    });
    expect((await b.handle('p1', principal, { kind: 'storage.get', collection: 'c', key: 'k' })).ok).toBe(false);
  });

  it('delegates connectors.test to the injected testConnector (gated by host:connectors)', async () => {
    const { b } = broker({ caps: [{ kind: 'host:connectors' }], testConnector: async (id: string) => ({ ok: true, id }) });
    const r = await b.handle('p1', principal, { kind: 'connectors.test', id: 'c9' });
    expect(r).toEqual({ ok: true, data: { ok: true, id: 'c9' } });
  });

  it('never throws — a host-service that throws becomes ok:false', async () => {
    const { b } = broker({ caps: [{ kind: 'host:reports' }], reporting: { list: () => { throw new Error('boom'); }, run: async () => ({}) } });
    const r = await b.handle('p1', principal, { kind: 'reports.list' });
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/boom/);
  });

  it('denies connectors.list when the caller lacks lab_admin (role gate, even with the capability)', async () => {
    const { b } = broker({ caps: [{ kind: 'host:connectors' }], connectors: { list: async () => [{ id: 'x' }], get: async () => null } });
    const lowPriv = { id: 'u2', roles: ['data_analyst'] };
    const r = await b.handle('p1', lowPriv, { kind: 'connectors.list' });
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/lab_admin/);
  });

  it('allows connectors.list for lab_admin with the capability', async () => {
    const { b } = broker({ caps: [{ kind: 'host:connectors' }], connectors: { list: async () => [{ id: 'x' }], get: async () => null } });
    const r = await b.handle('p1', { id: 'u', roles: ['lab_admin'] }, { kind: 'connectors.list' });
    expect(r).toEqual({ ok: true, data: [{ id: 'x' }] });
  });

  it('storage/reports ops require no special role (data_analyst allowed)', async () => {
    const { b } = broker({ caps: [{ kind: 'host:reports' }], reporting: { list: () => [{ id: 'r1' }], run: async () => ({}) } });
    const low = { id: 'u3', roles: ['data_analyst'] };
    expect((await b.handle('p1', low, { kind: 'storage.put', collection: 'c', key: 'k', doc: {} })).ok).toBe(true);
    expect((await b.handle('p1', low, { kind: 'reports.list' })).ok).toBe(true);
  });

  it('denies fhir.facilities without the host:fhir capability', async () => {
    const { b } = broker({ caps: [] });
    const r = await b.handle('p1', principal, { kind: 'fhir.facilities' });
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/host:fhir/);
  });

  it('denies schedule.list without the host:schedule capability', async () => {
    const { b } = broker({ caps: [] });
    const r = await b.handle('p1', principal, { kind: 'schedule.list' });
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/host:schedule/);
  });

  it('denies connectors.metadata/push/validate without the host:connectors capability', async () => {
    const { b } = broker({ caps: [] });
    expect((await b.handle('p1', principal, { kind: 'connectors.metadata', id: 'c1' })).ok).toBe(false);
    expect((await b.handle('p1', principal, { kind: 'connectors.push', connectorId: 'c1', mapping: {}, period: '2026', dryRun: true })).ok).toBe(false);
    expect((await b.handle('p1', principal, { kind: 'connectors.validate', connectorId: 'c1', mapping: {} })).ok).toBe(false);
  });

  it('denies reports.eventSources without the host:reports capability', async () => {
    const { b } = broker({ caps: [] });
    const r = await b.handle('p1', principal, { kind: 'reports.eventSources' });
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/host:reports/);
  });

  it('denies connectors.metadata/push/validate when the caller lacks lab_admin (role gate)', async () => {
    const { b } = broker({ caps: [{ kind: 'host:connectors' }] });
    const low = { id: 'u2', roles: ['data_analyst'] };
    expect((await b.handle('p1', low, { kind: 'connectors.metadata', id: 'c1' })).ok).toBe(false);
    const push = await b.handle('p1', low, { kind: 'connectors.push', connectorId: 'c1', mapping: {}, period: '2026', dryRun: true });
    expect(push.ok).toBe(false);
    expect((push as any).error).toMatch(/lab_admin/);
    expect((await b.handle('p1', low, { kind: 'connectors.validate', connectorId: 'c1', mapping: {} })).ok).toBe(false);
  });

  it('denies schedule.register/list/remove when the caller lacks lab_admin (role gate)', async () => {
    const { b } = broker({ caps: [{ kind: 'host:schedule' }] });
    const low = { id: 'u2', roles: ['data_analyst'] };
    expect((await b.handle('p1', low, { kind: 'schedule.register', schedule: {} })).ok).toBe(false);
    const list = await b.handle('p1', low, { kind: 'schedule.list' });
    expect(list.ok).toBe(false);
    expect((list as any).error).toMatch(/lab_admin/);
    expect((await b.handle('p1', low, { kind: 'schedule.remove', id: 's1' })).ok).toBe(false);
  });

  it('redacts connectors.test error detail (no raw message to the plugin) and logs it', async () => {
    const { b } = broker({
      caps: [{ kind: 'host:connectors' }],
      testConnector: async () => { throw new Error('connect ECONNREFUSED https://dhis.example user=admin password=s3cr3t'); },
    });
    const r = await b.handle('p1', { id: 'u', roles: ['lab_admin'] }, { kind: 'connectors.test', id: 'c1' });
    expect(r.ok).toBe(false);
    expect((r as any).error).not.toMatch(/s3cr3t/);
    expect((r as any).error).toMatch(/connectors\.test failed/);
  });
});
