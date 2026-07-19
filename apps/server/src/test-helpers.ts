import type { AppContext } from '@openldr/bootstrap';
import { HealthRegistry, createLogger } from '@openldr/core';

/**
 * Shared hand-built AppContext fixture for server route tests.
 *
 * Extracted from app.test.ts so any test needing the REAL buildApp (rather than a bespoke
 * Fastify instance) can drive it against the same stub context — notably compress.test.ts,
 * which must assert against the real registration ORDER, not just the options object.
 */
type FakeAdmin = AppContext['terminology']['admin'];
type FakeOntology = AppContext['terminology']['ontology'];
type FakeLoaders = AppContext['terminology']['loaders'];

/** Minimal in-memory fake admin store for route tests.
 *  The harness hand-mocks ctx (no pg-mem DB available here), so we use a fake.
 *  @openldr/db is not a dep of @openldr/server — types are derived from AppContext.
 *  The LOINC publisher is pre-seeded to satisfy the "LOINC present" assertion. */
function buildFakeAdmin(): FakeAdmin {
  type PubRole = 'local' | 'standard' | 'external';
  type PubRow = { id: string; name: string; role: PubRole; icon: string | null; seeded: boolean; sortOrder: number };
  const publishers: PubRow[] = [
    { id: 'pub-loinc', name: 'LOINC', role: 'standard', icon: null, seeded: true, sortOrder: 1 },
  ];
  const systems: Array<{ id: string; systemCode: string; systemName: string; url: string | null; systemVersion: string | null; description: string | null; active: boolean; publisherId: string | null; seeded: boolean }> = [
    { id: 'sys1', systemCode: 'X', systemName: 'Test System', url: 'http://x', systemVersion: null, description: null, active: true, publisherId: null, seeded: false },
  ];
  type TermRow = { system: string; code: string; display: string | null; status: string; shortName: string | null; class: string | null; unit: string | null; replacedBy: string | null; metadata: Record<string, unknown> | null; mappingCount: number };
  const terms: TermRow[] = [
    { system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE', shortName: null, class: null, unit: null, replacedBy: null, metadata: null, mappingCount: 0 },
  ];
  type MappingRow = { id: string; fromSystem: string; fromCode: string; toSystem: string; toCode: string; toDisplay: string | null; mapType: string; relationship: string | null; owner: string | null; isActive: boolean };
  const mappings: MappingRow[] = [];
  type ValueSetRow = {
    id: string; url: string; version: string | null; name: string | null; title: string | null;
    status: string; experimental: boolean; description: string | null; compose: { include?: Array<{ system?: string; concept?: Array<{ code: string; display?: string }> }> };
    immutable: boolean; category: string | null; publisherId: string | null;
  };
  const valueSets: ValueSetRow[] = [];
  let pubSeq = 0;
  let sysSeq = 0;
  let tmSeq = 0;
  let vsSeq = 0;

  const adminErr = (msg: string, kind: 'not-found' | 'conflict') =>
    Object.assign(new Error(msg), { name: 'TerminologyAdminError', kind });

  return {
    publishers: {
      async list() { return [...publishers]; },
      async create(input) {
        const p = { id: `pub-test-${++pubSeq}`, name: input.name, role: input.role, icon: input.icon ?? null, seeded: false, sortOrder: 100 };
        publishers.push(p);
        return p;
      },
      async update(id, input) {
        const p = publishers.find((x) => x.id === id);
        if (!p) throw adminErr(`not found: ${id}`, 'not-found');
        Object.assign(p, { name: input.name, role: input.role, icon: input.icon ?? null });
        return p;
      },
      async delete(id) {
        const idx = publishers.findIndex((x) => x.id === id);
        if (idx === -1) throw adminErr(`not found: ${id}`, 'not-found');
        if (publishers[idx].seeded) throw adminErr(`cannot delete seeded publisher: ${id}`, 'conflict');
        publishers.splice(idx, 1);
      },
      async deletionImpact() { return { systemCount: 0, termCount: 0 }; },
    },
    codingSystems: {
      async list(publisherId) { return publisherId ? systems.filter((s) => s.publisherId === publisherId) : [...systems]; },
      async create(input) {
        const s = { id: `cs-test-${++sysSeq}`, systemCode: input.systemCode, systemName: input.systemName, url: input.url ?? null, systemVersion: input.systemVersion ?? null, description: input.description ?? null, active: input.active, publisherId: input.publisherId ?? null, seeded: false };
        systems.push(s);
        return s;
      },
      async update(id, input) {
        const s = systems.find((x) => x.id === id);
        if (!s) throw adminErr(`not found: ${id}`, 'not-found');
        Object.assign(s, { systemName: input.systemName, url: input.url ?? null, systemVersion: input.systemVersion ?? null, description: input.description ?? null, active: input.active, publisherId: input.publisherId ?? null });
        return s;
      },
      async delete(id) {
        const idx = systems.findIndex((x) => x.id === id);
        if (idx === -1) throw adminErr(`not found: ${id}`, 'not-found');
        systems.splice(idx, 1);
      },
      async deletionImpact() { return { termCount: 0, mappingCount: 0 }; },
      async upsertByUrl() { /* no-op in fake */ },
    },
    terms: {
      async search(systemUrl, q) {
        let rows = terms.filter((t) => t.system === systemUrl);
        if (q.query && q.query.trim()) {
          const lower = q.query.trim().toLowerCase();
          rows = rows.filter((t) => t.code.toLowerCase().includes(lower) || (t.display ?? '').toLowerCase().includes(lower));
        }
        if (q.statuses && q.statuses.length) rows = rows.filter((t) => q.statuses!.includes(t.status));
        const total = rows.length;
        return { rows: rows.slice(q.offset, q.offset + q.limit), total };
      },
      async create(input) {
        const t: TermRow = {
          system: input.system, code: input.code, display: input.display ?? null, status: input.status,
          shortName: input.shortName ?? null, class: input.class ?? null, unit: input.unit ?? null,
          replacedBy: input.replacedBy ?? null, metadata: input.metadata ?? null, mappingCount: 0,
        };
        terms.push(t);
        return t;
      },
      async update(system, code, input) {
        const t = terms.find((x) => x.system === system && x.code === code);
        if (!t) throw adminErr(`term not found: ${system}|${code}`, 'not-found');
        Object.assign(t, { display: input.display ?? null, status: input.status, shortName: input.shortName ?? null, class: input.class ?? null, unit: input.unit ?? null, replacedBy: input.replacedBy ?? null, metadata: input.metadata ?? null });
        return t;
      },
      async delete(system, code) {
        const idx = terms.findIndex((x) => x.system === system && x.code === code);
        if (idx === -1) throw adminErr(`term not found: ${system}|${code}`, 'not-found');
        terms.splice(idx, 1);
      },
      async importRows(rows) {
        for (const r of rows) {
          const existing = terms.find((t) => t.system === r.system && t.code === r.code);
          const props = r.properties ?? {};
          if (existing) {
            Object.assign(existing, {
              display: r.display, status: r.status, shortName: (props.shortName as string) ?? null,
              class: (props.class as string) ?? null, unit: (props.unit as string) ?? null,
              metadata: (props.metadata as Record<string, unknown>) ?? null,
            });
          } else {
            terms.push({
              system: r.system, code: r.code, display: r.display, status: r.status,
              shortName: (props.shortName as string) ?? null, class: (props.class as string) ?? null,
              unit: (props.unit as string) ?? null, replacedBy: null,
              metadata: (props.metadata as Record<string, unknown>) ?? null, mappingCount: 0,
            });
          }
        }
        return { imported: rows.length };
      },
    },
    termMappings: {
      async listOutgoing(system, code) {
        return mappings.filter((m) => m.fromSystem === system && m.fromCode === code) as never[];
      },
      async listReverse(system, code) {
        return mappings.filter((m) => m.toSystem === system && m.toCode === code) as never[];
      },
      async create(input) {
        const m: MappingRow = {
          id: `tm-test-${++tmSeq}`, fromSystem: input.fromSystem, fromCode: input.fromCode,
          toSystem: input.toSystem, toCode: input.toCode, toDisplay: input.toDisplay ?? null,
          mapType: input.mapType, relationship: input.relationship ?? null, owner: input.owner ?? null, isActive: input.isActive,
        };
        mappings.push(m);
        return { mapping: m as never, draftCreated: false };
      },
      async update(id, input) {
        const m = mappings.find((x) => x.id === id);
        if (!m) throw adminErr(`mapping not found: ${id}`, 'not-found');
        Object.assign(m, { toSystem: input.toSystem, toCode: input.toCode, toDisplay: input.toDisplay ?? null, mapType: input.mapType, relationship: input.relationship ?? null, owner: input.owner ?? null, isActive: input.isActive });
        return m as never;
      },
      async delete(id) {
        const idx = mappings.findIndex((x) => x.id === id);
        if (idx === -1) throw adminErr(`mapping not found: ${id}`, 'not-found');
        mappings.splice(idx, 1);
      },
    },
    valueSets: {
      async list(publisherId) {
        return valueSets.filter((v) => !publisherId || v.publisherId === publisherId).map((v) => ({
          id: v.id, url: v.url, name: v.name, title: v.title, version: v.version, status: v.status,
          immutable: v.immutable, publisherId: v.publisherId, category: v.category,
          codeCount: v.compose.include?.flatMap((i) => i.concept ?? []).length ?? 0,
          primarySystem: v.compose.include?.find((i) => i.system)?.system ?? null,
        })) as never[];
      },
      async get(id) {
        const v = valueSets.find((x) => x.id === id);
        if (!v) throw adminErr(`value set not found: ${id}`, 'not-found');
        return v as never;
      },
      async getByUrl(url) {
        const v = valueSets.find((x) => x.url === url);
        if (!v) return null;
        return {
          id: v.id, url: v.url, name: v.name, title: v.title, version: v.version, status: v.status,
          immutable: v.immutable, publisherId: v.publisherId, category: v.category,
          codeCount: v.compose.include?.flatMap((i) => i.concept ?? []).length ?? 0,
          primarySystem: v.compose.include?.find((i) => i.system)?.system ?? null,
        } as never;
      },
      async save(input) {
        const existing = valueSets.find((x) => x.url === input.url);
        const v: ValueSetRow = existing ?? {
          id: `vs-test-${++vsSeq}`,
          url: input.url,
          version: null,
          name: null,
          title: null,
          status: input.status,
          experimental: false,
          description: null,
          compose: { include: [] },
          immutable: false,
          category: null,
          publisherId: null,
        };
        Object.assign(v, {
          version: input.version ?? null,
          name: input.name ?? null,
          title: input.title ?? null,
          status: input.status,
          experimental: input.experimental ?? false,
          description: input.description ?? null,
          compose: input.compose,
          category: input.category ?? null,
          publisherId: input.publisherId ?? null,
        });
        if (!existing) valueSets.push(v);
        return v as never;
      },
      async duplicate(id) {
        const src = valueSets.find((x) => x.id === id);
        if (!src) throw adminErr(`value set not found: ${id}`, 'not-found');
        const dup: ValueSetRow = { ...src, id: `vs-test-${++vsSeq}`, url: `${src.url}-copy`, immutable: false };
        valueSets.push(dup);
        return dup as never;
      },
      async delete(id) {
        const idx = valueSets.findIndex((x) => x.id === id);
        if (idx === -1) throw adminErr(`value set not found: ${id}`, 'not-found');
        valueSets.splice(idx, 1);
      },
      async expand(id) {
        const v = valueSets.find((x) => x.id === id);
        if (!v) throw adminErr(`value set not found: ${id}`, 'not-found');
        const codes = (v.compose.include ?? []).flatMap((i) => (i.concept ?? []).map((c) => ({ system: i.system ?? 's1', code: c.code, display: c.display ?? null })));
        return { codes, total: codes.length };
      },
      async importFhir(resource) {
        const r = resource as { url?: string; title?: string; status?: string; compose?: ValueSetRow['compose'] };
        return this.save({ url: r.url ?? 'urn:test:imported', title: r.title ?? null, status: r.status ?? 'draft', compose: r.compose ?? { include: [] } }) as never;
      },
      async importFhirCatalog(resource) {
        const r = resource as { valueSets?: Array<{ url: string; title?: string | null; name?: string | null; status?: string; compose?: ValueSetRow['compose'] }> };
        let imported = 0;
        let skipped = 0;
        let valueSet: ValueSetRow | null = null;
        for (const entry of r.valueSets ?? []) {
          if (valueSets.some((v) => v.url === entry.url)) {
            skipped += 1;
            continue;
          }
          valueSet = await this.save({
            url: entry.url,
            title: entry.title ?? entry.name ?? null,
            status: entry.status ?? 'draft',
            compose: entry.compose ?? { include: [] },
          }) as never;
          imported += 1;
        }
        return { imported, skipped, valueSet: valueSet as never };
      },
      async exportFhir(id) {
        const v = valueSets.find((x) => x.id === id);
        if (!v) throw adminErr(`value set not found: ${id}`, 'not-found');
        return { resourceType: 'ValueSet', id: v.id, url: v.url, status: v.status, compose: v.compose };
      },
    },
  };
}

function buildFakeOntology(): FakeOntology {
  const distributions = new Map<string, Awaited<ReturnType<FakeOntology['getDistribution']>>>();
  distributions.set('sys1', {
    codingSystemId: 'sys1',
    ontologyType: 'loinc',
    sourcePath: 'fixture',
    indexStatus: 'ready',
    indexError: null,
    nodeCount: 2,
    edgeCount: 1,
    manifest: null,
    builtAt: null,
    updatedAt: new Date().toISOString(),
    stale: false,
  });
  const root = { code: 'ROOT-A', display: 'Root A', kind: 'category', extra: null, childCount: 1, group: null };
  const child = { code: 'CHILD-1', display: 'Child One', kind: 'term', extra: null, childCount: 0, group: null };
  return {
    async listDistributions() {
      return [...distributions.values()].filter((d): d is NonNullable<typeof d> => d != null);
    },
    async getDistribution(id) {
      return distributions.get(id) ?? null;
    },
    async build(id, sourcePath, onProgress) {
      onProgress({ codingSystemId: id, phase: 'fixture', processed: 1, total: 1 });
      distributions.set(id, { ...(distributions.get(id) ?? distributions.get('sys1')!), codingSystemId: id, sourcePath, indexStatus: 'ready' });
    },
    async rebuild(id, onProgress) {
      onProgress({ codingSystemId: id, phase: 'fixture', processed: 1, total: 1 });
    },
    async unlink(id) {
      distributions.delete(id);
    },
    async roots() {
      return [root];
    },
    async children(_id, parent) {
      return parent === 'ROOT-A' ? [child] : [];
    },
    async node(_id, code) {
      if (code === root.code) return root;
      if (code === child.code) return child;
      return null;
    },
    async search(_id, query) {
      return query.toLowerCase().includes('child') ? [child] : [];
    },
    async path(_id, code) {
      return code === child.code ? [root, child].map((n) => ({ code: n.code, display: n.display })) : [];
    },
    async panelMembers() {
      return [];
    },
    async answerOptions() {
      return [];
    },
    async specimenCodes() {
      return [];
    },
  };
}

function buildFakeLoaders(): FakeLoaders {
  return {
    async loinc(dir, acceptLicense) {
      if (!acceptLicense) throw new Error('LOINC import requires accepting the LOINC license (--accept-license)');
      return { system: 'http://loinc.org', conceptsLoaded: dir.includes('empty') ? 0 : 2, resourceUrl: 'http://loinc.org' };
    },
    async amr() {
      return [];
    },
    async resource() {
      return { system: 'urn:test', conceptsLoaded: 0, resourceUrl: 'urn:test' };
    },
  };
}

function fakeInternalDb() {
  // Minimal stub so buildApp can construct route deps (e.g. createConnectorStore).
  // These stores are never exercised in app.test.ts — their tables don't exist here.
  const stub = {
    selectFrom: () => stub,
    insertInto: () => stub,
    deleteFrom: () => stub,
    select: () => stub,
    where: () => stub,
    orderBy: () => stub,
    limit: () => stub,
    execute: async () => [],
    executeTakeFirst: async () => undefined,
    executeTakeFirstOrThrow: async () => { throw new Error('stub'); },
    onConflict: () => ({ doUpdateSet: () => stub }),
    values: () => stub,
    destroy: async () => {},
  };
  return stub as unknown as import('@openldr/bootstrap').AppContext['internalDb'];
}

export function ctxWith(status: 'up' | 'down'): AppContext {
  const health = new HealthRegistry();
  health.register({ name: 'auth', check: async () => ({ status, latencyMs: 1 }) });
  return {
    logger: createLogger({ level: 'silent' }),
    internalDb: fakeInternalDb(),
    fhirStore: { listByType: async () => [] } as never,
    auth: {
      directory: {
        async list() { const e = new Error('admin not configured'); e.name = 'IdentityAdminNotConfiguredError'; throw e; },
        async get() { const e = new Error('admin not configured'); e.name = 'IdentityAdminNotConfiguredError'; throw e; },
        async create() { const e = new Error('admin not configured'); e.name = 'IdentityAdminNotConfiguredError'; throw e; },
        async update() { const e = new Error('admin not configured'); e.name = 'IdentityAdminNotConfiguredError'; throw e; },
        async setRoles() { const e = new Error('admin not configured'); e.name = 'IdentityAdminNotConfiguredError'; throw e; },
      },
      clients: {
        async findUuidByClientId() { const e = new Error('admin not configured'); e.name = 'IdentityAdminNotConfiguredError'; throw e; },
        async createConfidentialClient() { const e = new Error('admin not configured'); e.name = 'IdentityAdminNotConfiguredError'; throw e; },
        async addSiteIdMapper() { const e = new Error('admin not configured'); e.name = 'IdentityAdminNotConfiguredError'; throw e; },
        async addAudienceMapper() { const e = new Error('admin not configured'); e.name = 'IdentityAdminNotConfiguredError'; throw e; },
        async getClientSecret() { const e = new Error('admin not configured'); e.name = 'IdentityAdminNotConfiguredError'; throw e; },
        async regenerateClientSecret() { const e = new Error('admin not configured'); e.name = 'IdentityAdminNotConfiguredError'; throw e; },
        async deleteClient() { const e = new Error('admin not configured'); e.name = 'IdentityAdminNotConfiguredError'; throw e; },
      },
    } as never,
    syncSites: {} as never,
    syncSiteCursors: {} as never,
    blob: {} as never,
    eventing: {} as never,
    store: {} as never,
    health,
    reporting: {} as never,
    reportRuns: {} as never,
    reportSchedules: {} as never,
    reportScheduler: {} as never,
    pluginScheduleRunner: {} as never,
    audit: {} as never,
    users: {
      list: async () => [],
      get: async () => undefined,
    } as never,
    userProfiles: {
      get: async () => undefined,
      list: async () => new Map(),
      upsert: async () => undefined,
    } as never,
    forms: {} as never,
    plugins: {} as never,
    pluginData: {} as never,
    pluginBroker: {} as never,
    connectors: {} as never,
    appSettings: {} as never,
    featureFlags: { get: async () => false } as never,
    numberSettings: { get: async () => 0, all: async () => [], set: async () => 0, invalidate: () => {} } as never,
    validationStrictness: { get: async () => 'high', set: async () => {} } as never,
    activity: { getLifecycle: async () => null, listRecent: async () => [] } as never,
    sync: { status: async () => ({ enabled: false, mode: 'push', centralUrl: '', siteId: '', push: null, pull: null, pendingPush: 0 }), triggerNow: () => {} } as never,
    syncActivity: { list: async () => [] } as never,
    syncRuntime: { reconcile: async () => {} } as never,
    encryptSecret: (p: string) => p,
    decryptSecret: (b: string) => b,
    marketplaceForms: {} as never,
    terminology: { ops: {} as never, admin: buildFakeAdmin(), ontology: buildFakeOntology(), loaders: buildFakeLoaders() },
    dashboards: {} as never,
    reportDesigns: {} as never,
    reportDefs: {} as never,
    reportCategories: {} as never,
    workflows: {} as never,
    cfg: { AUTH_DEV_BYPASS: true, TARGET_STORE_ADAPTER: 'pg', OIDC_ISSUER_URL: 'https://kc.example/realms/openldr', OIDC_WEB_CLIENT_ID: 'openldr-web', OIDC_AUDIENCE: undefined } as never,
    async close() {},
  };
}
