import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { buildApp } from './app';
import type { AppContext } from '@openldr/bootstrap';
import { HealthRegistry, createLogger } from '@openldr/core';

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

function ctxWith(status: 'up' | 'down'): AppContext {
  const health = new HealthRegistry();
  health.register({ name: 'auth', check: async () => ({ status, latencyMs: 1 }) });
  return {
    logger: createLogger({ level: 'silent' }),
    auth: {} as never,
    blob: {} as never,
    eventing: {} as never,
    store: {} as never,
    health,
    reporting: {} as never,
    audit: {} as never,
    users: {} as never,
    forms: {} as never,
    terminology: { ops: {} as never, admin: buildFakeAdmin(), ontology: buildFakeOntology(), loaders: buildFakeLoaders() },
    dashboards: {} as never,
    cfg: { AUTH_DEV_BYPASS: true } as never,
    async close() {},
  };
}

describe('GET /health', () => {
  it('returns 200 and overall up when all checks pass', async () => {
    const app = buildApp(ctxWith('up'));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('up');
    await app.close();
  });

  it('returns 503 when any check is down', async () => {
    const app = buildApp(ctxWith('down'));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe('down');
    await app.close();
  });
});

describe('auth routes', () => {
  it('GET /api/me returns the resolved actor under dev bypass', async () => {
    const app = buildApp(ctxWith('up'));
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.username).toBe('string');
    expect(Array.isArray(body.roles)).toBe(true);
    await app.close();
  });
});

describe('terminology admin routes', () => {
  it('lists seeded publishers and creates a custom publisher + system', async () => {
    const app = buildApp(ctxWith('up'));

    const list = await app.inject({ method: 'GET', url: '/api/terminology/publishers' });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.body).some((p: { name: string }) => p.name === 'LOINC')).toBe(true);

    const created = await app.inject({ method: 'POST', url: '/api/terminology/publishers', payload: { name: 'My Lab', role: 'local' } });
    expect(created.statusCode).toBe(201);

    const sys = await app.inject({ method: 'POST', url: '/api/terminology/systems', payload: { systemCode: 'MYX', systemName: 'My X', active: true } });
    expect(sys.statusCode).toBe(201);

    // 404: delete of unknown publisher id
    const del404 = await app.inject({ method: 'DELETE', url: '/api/terminology/publishers/ghost-id' });
    expect(del404.statusCode).toBe(404);

    // 409: delete of seeded publisher (pub-loinc is pre-seeded with seeded=true)
    const del409 = await app.inject({ method: 'DELETE', url: '/api/terminology/publishers/pub-loinc' });
    expect(del409.statusCode).toBe(409);

    await app.close();
  });

  it('searches terms and creates a mapping', async () => {
    const app = buildApp(ctxWith('up'));

    const list = await app.inject({ method: 'GET', url: '/api/terminology/systems/sys1/terms?q=amp' });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.body).total).toBeGreaterThanOrEqual(1);

    const created = await app.inject({ method: 'POST', url: '/api/terminology/systems/sys1/terms', payload: { code: 'NEW', display: 'New term', status: 'ACTIVE' } });
    expect(created.statusCode).toBe(201);

    const map = await app.inject({ method: 'POST', url: '/api/terminology/terms/http%3A%2F%2Fx/AMP/mappings', payload: { toSystem: 'http://loinc.org', toCode: '1', toDisplay: 'x', mapType: 'SAME-AS', isActive: true } });
    expect(map.statusCode).toBe(201);

    const template = await app.inject({ method: 'GET', url: '/api/terminology/systems/sys1/terms/template.csv' });
    expect(template.statusCode).toBe(200);
    expect(template.body).toContain('"code"');

    await app.close();
  });

  it('imports structured terminology source files and serves system-specific templates', async () => {
    const app = buildApp(ctxWith('up'));

    const snomedSystem = await app.inject({
      method: 'POST',
      url: '/api/terminology/systems',
      payload: { systemCode: 'SNOMED-CT', systemName: 'SNOMED CT', url: 'http://snomed.info/sct', active: true },
    });
    const snomedId = JSON.parse(snomedSystem.body).id as string;
    const importRes = await app.inject({
      method: 'POST',
      url: `/api/terminology/systems/${snomedId}/terms/import`,
      payload: {
        csv: [
          'id\teffectiveTime\tactive\tmoduleId\tconceptId\tlanguageCode\ttypeId\tterm\tcaseSignificanceId',
          'd1\t20250131\t1\t900000000000207008\t119297000\ten\t900000000000003001\tBlood specimen (specimen)\t900000000000448009',
          'd2\t20250131\t1\t900000000000207008\t119297000\ten\t900000000000013009\tBlood specimen\t900000000000448009',
        ].join('\n'),
      },
    });
    expect(importRes.statusCode).toBe(200);
    expect(JSON.parse(importRes.body)).toMatchObject({ imported: 1 });

    const terms = await app.inject({ method: 'GET', url: `/api/terminology/systems/${snomedId}/terms?q=119297000` });
    expect(JSON.parse(terms.body).rows[0]).toMatchObject({ code: '119297000', display: 'Blood specimen', class: 'SNOMED CT' });

    const loincTemplate = await app.inject({ method: 'GET', url: '/api/terminology/systems/sys-loinc/terms/template.csv' });
    expect(loincTemplate.statusCode).toBe(404);

    const rxnormSystem = await app.inject({
      method: 'POST',
      url: '/api/terminology/systems',
      payload: { systemCode: 'RxNorm', systemName: 'RxNorm', url: 'http://www.nlm.nih.gov/research/umls/rxnorm', active: true },
    });
    const rxnormTemplate = await app.inject({ method: 'GET', url: `/api/terminology/systems/${JSON.parse(rxnormSystem.body).id}/terms/template.csv` });
    expect(rxnormTemplate.body).toContain('RXNORM|SCD');
    expect(rxnormTemplate.headers['content-disposition']).toContain('RXNCONSO-template.RRF');

    await app.close();
  });

  it('imports raw uploaded terminology files without JSON wrapping', async () => {
    const app = buildApp(ctxWith('up'));

    const snomedSystem = await app.inject({
      method: 'POST',
      url: '/api/terminology/systems',
      payload: { systemCode: 'SNOMED-CT', systemName: 'SNOMED CT', url: 'http://snomed.info/sct', active: true },
    });
    const snomedId = JSON.parse(snomedSystem.body).id as string;
    const imported = await app.inject({
      method: 'POST',
      url: `/api/terminology/systems/${snomedId}/terms/import`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: [
        'id\teffectiveTime\tactive\tmoduleId\tconceptId\tlanguageCode\ttypeId\tterm\tcaseSignificanceId',
        'd1\t20250131\t1\t900000000000207008\t119297000\ten\t900000000000013009\tBlood specimen\t900000000000448009',
        ...Array.from({ length: 12_000 }, (_, i) => `x${i}\t20250131\t0\t900000000000207008\t900${String(i).padStart(15, '0')}\ten\t900000000000013009\tInactive filler ${i}\t900000000000448009`),
      ].join('\n'),
    });

    expect(imported.statusCode).toBe(200);
    expect(JSON.parse(imported.body)).toMatchObject({ imported: 1 });

    await app.close();
  });

  it('imports a LOINC distribution through the terminology loader', async () => {
    const app = buildApp(ctxWith('up'));

    const missingLicense = await app.inject({
      method: 'POST',
      url: '/api/terminology/import/loinc',
      payload: { path: 'D:\\terminology\\Loinc\\2.82', acceptLicense: false },
    });
    expect(missingLicense.statusCode).toBe(400);

    const imported = await app.inject({
      method: 'POST',
      url: '/api/terminology/import/loinc',
      payload: { path: 'D:\\terminology\\Loinc\\2.82', acceptLicense: true },
    });
    expect(imported.statusCode).toBe(200);
    expect(JSON.parse(imported.body)).toMatchObject({ system: 'http://loinc.org', conceptsLoaded: 2 });

    await app.close();
  });

  it('creates, lists, expands, and exports value sets', async () => {
    const app = buildApp(ctxWith('up'));

    const created = await app.inject({
      method: 'POST',
      url: '/api/terminology/valuesets',
      payload: {
        url: 'urn:test:vs',
        title: 'Test VS',
        status: 'active',
        compose: { include: [{ system: 's1', concept: [{ code: 'A', display: 'Alpha' }] }] },
      },
    });
    expect(created.statusCode).toBe(201);
    const id = JSON.parse(created.body).id;

    const list = await app.inject({ method: 'GET', url: '/api/terminology/valuesets' });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.body)[0].url).toBe('urn:test:vs');

    const expanded = await app.inject({ method: 'GET', url: `/api/terminology/valuesets/${id}/expand` });
    expect(expanded.statusCode).toBe(200);
    expect(JSON.parse(expanded.body).total).toBe(1);

    const exported = await app.inject({ method: 'GET', url: `/api/terminology/valuesets/${id}/export` });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toContain('application/fhir+json');

    await app.close();
  });

  it('imports raw FHIR ValueSet JSON uploads', async () => {
    const app = buildApp(ctxWith('up'));

    const imported = await app.inject({
      method: 'POST',
      url: '/api/terminology/valuesets/import',
      headers: { 'content-type': 'application/fhir+json' },
      payload: JSON.stringify({
        resourceType: 'ValueSet',
        url: 'urn:test:raw-vs',
        title: 'Raw VS',
        status: 'active',
        compose: { include: [{ system: 's1', concept: [{ code: 'A', display: 'Alpha' }] }] },
      }),
    });

    expect(imported.statusCode).toBe(201);
    expect(JSON.parse(imported.body)).toMatchObject({ url: 'urn:test:raw-vs', title: 'Raw VS' });

    await app.close();
  });

  it('imports a gzipped Corlix FHIR ValueSet catalog upload', async () => {
    const app = buildApp(ctxWith('up'));

    const imported = await app.inject({
      method: 'POST',
      url: '/api/terminology/valuesets/import',
      headers: { 'content-type': 'application/gzip' },
      payload: gzipSync(JSON.stringify({
        version: 'R4',
        valueSets: [{
          url: 'http://hl7.org/fhir/ValueSet/administrative-gender',
          version: '4.0.1',
          name: 'AdministrativeGender',
          title: 'AdministrativeGender',
          status: 'active',
          compose: { include: [{ system: 'http://hl7.org/fhir/administrative-gender' }] },
          expansion: [],
          primarySystem: 'http://hl7.org/fhir/administrative-gender',
        }],
        codeSystems: [],
      })),
    });

    expect(imported.statusCode).toBe(201);
    expect(JSON.parse(imported.body)).toMatchObject({ imported: 1, skipped: 0 });

    await app.close();
  });
});

describe('ontology routes', () => {
  it('reads roots/children and streams build completion over SSE', async () => {
    const app = buildApp(ctxWith('up'));

    const roots = await app.inject({ method: 'GET', url: '/api/terminology/ontology/sys1/roots' });
    expect(roots.statusCode).toBe(200);
    expect(JSON.parse(roots.body).map((node: { code: string }) => node.code)).toEqual(['ROOT-A']);

    const children = await app.inject({ method: 'GET', url: '/api/terminology/ontology/sys1/children?parent=ROOT-A' });
    expect(children.statusCode).toBe(200);
    expect(JSON.parse(children.body).map((node: { code: string }) => node.code)).toEqual(['CHILD-1']);

    const sse = await app.inject({ method: 'GET', url: '/api/terminology/ontology/sys1/build?path=fixture' });
    expect(sse.statusCode).toBe(200);
    expect(sse.body).toContain('event: done');

    await app.close();
  });
});
