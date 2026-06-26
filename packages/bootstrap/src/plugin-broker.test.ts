import { describe, it, expect } from 'vitest';
import { createPluginBroker, buildBrokerOpSchema } from './plugin-broker';

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

const defaultReporting = () => ({ list: () => [], columns: async () => [], run: async () => ({ columns: [], rows: [], meta: {} }), eventSources: () => [] });

function broker(opts: {
  caps: unknown[] | undefined;
  uiEnabled?: boolean;
  reporting?: any;
  connectors?: any;
  loadSink?: any;
  testConnector?: any;
  connectorMetadata?: any;
  connectorPush?: any;
  connectorValidate?: any;
  facilities?: any;
  schedules?: any;
  requiredRoles?: string[];
  maxDocBytes?: number;
}) {
  const data = memData();
  const manifest: any = opts.caps === undefined ? {} : { capabilities: opts.caps };
  if (opts.requiredRoles) manifest.payload = { ui: { requiredRoles: opts.requiredRoles } };
  const row = { id: 'p1', version: '1.0.0', enabled: true, manifest };
  const b = createPluginBroker({
    plugins: { list: async () => [row], loadSink: opts.loadSink ?? (async () => undefined) } as any,
    pluginData: data.store as any,
    reporting: { ...defaultReporting(), ...(opts.reporting ?? {}) },
    connectors: opts.connectors ?? { list: async () => [], get: async () => null },
    testConnector: opts.testConnector,
    connectorMetadata: opts.connectorMetadata,
    connectorPush: opts.connectorPush,
    connectorValidate: opts.connectorValidate,
    facilities: opts.facilities,
    schedules: opts.schedules,
    maxDocBytes: opts.maxDocBytes,
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
      reporting: { ...defaultReporting() },
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

  it('reports.eventSources returns the injected event-source catalog (gated by host:reports)', async () => {
    const { b } = broker({ caps: [{ kind: 'host:reports' }], reporting: { eventSources: () => [{ id: 's1', name: 'S1' }] } });
    const r = await b.handle('p1', principal, { kind: 'reports.eventSources' });
    expect(r).toEqual({ ok: true, data: [{ id: 's1', name: 'S1' }] });
  });

  it('connectors.metadata delegates to connectorMetadata(id) for lab_admin with the capability', async () => {
    const { b } = broker({ caps: [{ kind: 'host:connectors' }], connectorMetadata: async (id: string) => ({ dataElements: 3, id }) });
    const r = await b.handle('p1', principal, { kind: 'connectors.metadata', id: 'c9' });
    expect(r).toEqual({ ok: true, data: { dataElements: 3, id: 'c9' } });
  });

  it('connectors.metadata returns a structured error when no metadata dep is wired', async () => {
    const { b } = broker({ caps: [{ kind: 'host:connectors' }] });
    const r = await b.handle('p1', principal, { kind: 'connectors.metadata', id: 'c9' });
    expect(r).toEqual({ ok: false, error: 'connectors.metadata unavailable' });
  });

  it('connectors.push delegates with the FULL input object', async () => {
    const seen: unknown[] = [];
    const { b } = broker({ caps: [{ kind: 'host:connectors' }], connectorPush: async (input: unknown) => { seen.push(input); return { kind: 'aggregate', dryRun: false }; } });
    const r = await b.handle('p1', principal, { kind: 'connectors.push', connectorId: 'c1', mapping: { id: 'm' }, orgUnitMap: { f: 'OU' }, period: '2026', dryRun: false });
    expect(r).toEqual({ ok: true, data: { kind: 'aggregate', dryRun: false } });
    expect(seen[0]).toEqual({ connectorId: 'c1', mapping: { id: 'm' }, orgUnitMap: { f: 'OU' }, period: '2026', dryRun: false });
  });

  it('connectors.validate delegates and returns the validator output', async () => {
    const { b } = broker({ caps: [{ kind: 'host:connectors' }], connectorValidate: async () => ['bad dataElement'] });
    const r = await b.handle('p1', principal, { kind: 'connectors.validate', connectorId: 'c1', mapping: {} });
    expect(r).toEqual({ ok: true, data: ['bad dataElement'] });
  });

  it('fhir.facilities returns the injected facilities list (gated by host:fhir)', async () => {
    const { b } = broker({ caps: [{ kind: 'host:fhir' }], facilities: async () => [{ id: 'L1', name: 'Lab 1' }] });
    const r = await b.handle('p1', principal, { kind: 'fhir.facilities' });
    expect(r).toEqual({ ok: true, data: [{ id: 'L1', name: 'Lab 1' }] });
  });

  it('schedule.list passes the TRUSTED pluginId to the schedules dep', async () => {
    let seenPlugin: string | undefined;
    const { b } = broker({ caps: [{ kind: 'host:schedule' }], schedules: { register: async () => ({}), list: async (pid: string) => { seenPlugin = pid; return [{ id: 's1' }]; }, remove: async () => ({}) } });
    const r = await b.handle('p1', principal, { kind: 'schedule.list' });
    expect(r).toEqual({ ok: true, data: [{ id: 's1' }] });
    expect(seenPlugin).toBe('p1');
  });

  it('schedule.list returns "schedule unavailable" when no schedules dep is wired', async () => {
    const { b } = broker({ caps: [{ kind: 'host:schedule' }] });
    const r = await b.handle('p1', principal, { kind: 'schedule.list' });
    expect(r).toEqual({ ok: false, error: 'schedule unavailable' });
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

  // ── SEC-03: plugin-level required-roles gate (applies to ALL ops incl. storage.*/invoke) ──
  describe('plugin required-roles gate (SEC-03)', () => {
    const tech = { id: 'u-tech', roles: ['lab_technician'] };
    const admin = { id: 'u-admin', roles: ['lab_admin'] };

    it('DENIES storage.list/get/put/invoke for a caller lacking the plugin required role', async () => {
      const { b } = broker({ caps: [], requiredRoles: ['lab_admin'], loadSink: async () => ({ invoke: async () => ({}) }) });
      for (const op of [
        { kind: 'storage.list', collection: 'c' },
        { kind: 'storage.get', collection: 'c', key: 'k' },
        { kind: 'storage.put', collection: 'c', key: 'k', doc: { n: 1 } },
        { kind: 'invoke', entrypoint: 'e', input: {} },
      ] as const) {
        const r = await b.handle('p1', tech, op);
        expect(r.ok).toBe(false);
        expect((r as any).error).toMatch(/requires one of roles: lab_admin/);
      }
    });

    it('ALLOWS the same ops for a caller holding the plugin required role', async () => {
      const { b } = broker({ caps: [], requiredRoles: ['lab_admin'], loadSink: async () => ({ invoke: async (_e: string, input: unknown) => ({ echoed: input }) }) });
      expect((await b.handle('p1', admin, { kind: 'storage.put', collection: 'c', key: 'k', doc: { n: 1 } })).ok).toBe(true);
      expect((await b.handle('p1', admin, { kind: 'storage.get', collection: 'c', key: 'k' })).ok).toBe(true);
      expect((await b.handle('p1', admin, { kind: 'storage.list', collection: 'c' })).ok).toBe(true);
      expect((await b.handle('p1', admin, { kind: 'invoke', entrypoint: 'e', input: { hi: 1 } })).ok).toBe(true);
    });

    it('a plugin with NO requiredRoles leaves storage.* open to any authed caller (unchanged)', async () => {
      const { b } = broker({ caps: [] });
      expect((await b.handle('p1', tech, { kind: 'storage.put', collection: 'c', key: 'k', doc: {} })).ok).toBe(true);
      expect((await b.handle('p1', tech, { kind: 'storage.get', collection: 'c', key: 'k' })).ok).toBe(true);
    });
  });

  // ── SEC-12: op schema + size bounds ──
  describe('broker op schema + bounds (SEC-12)', () => {
    it('returns a structured invalid-operation error for an unknown kind', async () => {
      const { b } = broker({ caps: [] });
      const r = await b.handle('p1', principal, { kind: 'storage.nuke' } as any);
      expect(r.ok).toBe(false);
      expect((r as any).error).toMatch(/invalid operation/);
    });

    it('rejects an over-long collection / key', async () => {
      const { b } = broker({ caps: [] });
      const long = 'x'.repeat(300);
      expect((await b.handle('p1', principal, { kind: 'storage.get', collection: long, key: 'k' } as any)).ok).toBe(false);
      expect((await b.handle('p1', principal, { kind: 'storage.get', collection: 'c', key: long } as any)).ok).toBe(false);
    });

    it('rejects a storage.put doc just over the configured byte cap', async () => {
      const cap = 1024;
      const { b } = broker({ caps: [], maxDocBytes: cap });
      const big = { blob: 'a'.repeat(cap + 100) };
      const r = await b.handle('p1', principal, { kind: 'storage.put', collection: 'c', key: 'k', doc: big });
      expect(r.ok).toBe(false);
      expect((r as any).error).toMatch(/invalid operation/);
    });

    it('accepts a doc within the cap', async () => {
      const { b } = broker({ caps: [], maxDocBytes: 1024 });
      expect((await b.handle('p1', principal, { kind: 'storage.put', collection: 'c', key: 'k', doc: { n: 1 } })).ok).toBe(true);
    });

    it('rejects a reports.run params object just over the configured byte cap', async () => {
      const cap = 1024;
      const { b } = broker({ caps: [{ kind: 'host:reports' }], maxDocBytes: cap });
      const bigParams = { blob: 'a'.repeat(cap + 100) };
      const r = await b.handle('p1', principal, { kind: 'reports.run', id: 'r1', params: bigParams } as any);
      expect(r.ok).toBe(false);
      expect((r as any).error).toMatch(/invalid operation/);
    });

    it('accepts a reports.run params object within the cap', async () => {
      const { b } = broker({ caps: [{ kind: 'host:reports' }], maxDocBytes: 1024 });
      const r = await b.handle('p1', principal, { kind: 'reports.run', id: 'r1', params: { from: '2026-01-01' } });
      expect(r.ok).toBe(true);
    });

    it('rejects an out-of-range storage.list limit', async () => {
      const { b } = broker({ caps: [] });
      expect((await b.handle('p1', principal, { kind: 'storage.list', collection: 'c', limit: 5000 } as any)).ok).toBe(false);
      expect((await b.handle('p1', principal, { kind: 'storage.list', collection: 'c', limit: 0 } as any)).ok).toBe(false);
    });

    it('buildBrokerOpSchema accepts a valid op and rejects a malformed one', () => {
      const schema = buildBrokerOpSchema(1024);
      expect(schema.safeParse({ kind: 'storage.get', collection: 'c', key: 'k' }).success).toBe(true);
      expect(schema.safeParse({ kind: 'bogus' }).success).toBe(false);
    });
  });
});
