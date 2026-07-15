import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { buildApp } from './app';
import { ctxWith } from './test-helpers';

describe('GET /health', () => {
  it('returns 200 and overall up when all checks pass', async () => {
    const app = await buildApp(ctxWith('up'));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('up');
    await app.close();
  });

  it('returns 503 when any check is down', async () => {
    const app = await buildApp(ctxWith('down'));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe('down');
    await app.close();
  });
});

describe('SPA static root (WEB_DIST_DIR)', () => {
  it('serves the studio SPA under /studio and 404s unknown non-/studio non-/api paths', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'webdist-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root">SPA</div>');
    process.env.WEB_DIST_DIR = dir;
    try {
      const app = await buildApp(ctxWith('up'));
      await app.ready();

      // Client-side route under /studio → SPA shell
      const spa = await app.inject({ method: 'GET', url: '/studio/dashboard' });
      expect(spa.statusCode).toBe(200);
      expect(spa.body).toContain('id="root"');

      // Unknown /api path → 404 JSON
      const apiMiss = await app.inject({ method: 'GET', url: '/api/nope' });
      expect(apiMiss.statusCode).toBe(404);
      expect(apiMiss.json()).toMatchObject({ error: 'not found' });

      // Root (/) → 404 — landing owns it, not the app
      const root = await app.inject({ method: 'GET', url: '/' });
      expect(root.statusCode).toBe(404);

      await app.close();
    } finally {
      delete process.env.WEB_DIST_DIR;
    }
  });
});

describe('GET /api/config', () => {
  it('returns authEnforced and OIDC shape from ctx.cfg', async () => {
    const app = await buildApp(ctxWith('up'));
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // AUTH_DEV_BYPASS: true → authEnforced = false
    expect(body.authEnforced).toBe(false);
    expect(body.oidc).toMatchObject({
      issuerUrl: 'https://kc.example/realms/openldr',
      clientId: 'openldr-web',
      audience: null,
    });
    await app.close();
  });
});

describe('auth routes', () => {
  it('GET /api/me returns the resolved actor under dev bypass', async () => {
    const app = await buildApp(ctxWith('up'));
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
    const app = await buildApp(ctxWith('up'));

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
    const app = await buildApp(ctxWith('up'));

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
    const app = await buildApp(ctxWith('up'));

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
    const app = await buildApp(ctxWith('up'));

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
    const app = await buildApp(ctxWith('up'));

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
    const app = await buildApp(ctxWith('up'));

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
    const app = await buildApp(ctxWith('up'));

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
    const app = await buildApp(ctxWith('up'));

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
    const app = await buildApp(ctxWith('up'));

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

