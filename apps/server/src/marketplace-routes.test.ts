import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { AppContext } from '@openldr/bootstrap';
import { generatePublisherKeypair, packBundle, signManifest, keyFingerprint } from '@openldr/marketplace';
import { createPluginRuntime } from '@openldr/plugins';
import { createRegistryStore } from '@openldr/db';
import { makeMigratedDb } from '@openldr/db/testing';
import { registerMarketplaceRoutes } from './marketplace-routes';
import { registerPluginUiRoutes } from './plugin-ui-routes';

// ── A temp registry dir with one signed plugin bundle (built via packBundle). ──
let registryDir: string;
let formRegistryDir: string;
/** Registry dir containing a ui-bearing plugin bundle (ui.html included, signed). */
let uiRegistryDir: string;
beforeAll(async () => {
  registryDir = await mkdtemp(join(tmpdir(), 'mkt-registry-'));
  const kp = generatePublisherKeypair();
  const manifest = {
    schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0',
    publisher: { id: 'acme', name: 'Acme', keyFingerprint: '0'.repeat(64) },
    compatibility: { ceVersion: '*' },
    capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }],
    payload: { kind: 'plugin', wasmSha256: '0'.repeat(64) },
  };
  await packBundle({ manifest, payload: new Uint8Array([1, 2, 3, 4]), outDir: join(registryDir, 'demo-1'), privateKeyDer: kp.privateKeyDer, publicKeyDer: kp.publicKeyDer });

  formRegistryDir = await mkdtemp(join(tmpdir(), 'mkt-form-registry-'));
  {
    const fkp = generatePublisherKeypair();
    const formManifest = { schemaVersion: 1, type: 'form-template', id: 'demo-form', version: '1.0.0', publisher: { id: 'acme', name: 'Acme', keyFingerprint: '0'.repeat(64) }, compatibility: { ceVersion: '*' }, capabilities: [], payload: { kind: 'form-template', questionnaireSha256: '0'.repeat(64) } };
    const q = { resourceType: 'Questionnaire', status: 'active', title: 'Demo', item: [] };
    await packBundle({ manifest: formManifest, payload: new TextEncoder().encode(JSON.stringify(q)), outDir: join(formRegistryDir, 'demo-form-1'), privateKeyDer: fkp.privateKeyDer, publicKeyDer: fkp.publicKeyDer });
  }

  // Build a ui-bearing bundle manually (packBundle doesn't handle payload.ui).
  uiRegistryDir = await mkdtemp(join(tmpdir(), 'mkt-ui-registry-'));
  {
    const ukp = generatePublisherKeypair();
    const wasmBytes = new Uint8Array([1, 2, 3, 4]);
    const uiBytes = new TextEncoder().encode('<div>panel</div>');
    const wasmSha = createHash('sha256').update(wasmBytes).digest('hex');
    const uiSha = createHash('sha256').update(uiBytes).digest('hex');
    const fp = keyFingerprint(ukp.publicKeyDer);
    const unsigned = {
      schemaVersion: 1, type: 'plugin', id: 'ui-demo', version: '1.0.0',
      publisher: { id: 'acme', name: 'Acme', keyFingerprint: fp },
      compatibility: { ceVersion: '*' },
      capabilities: [],
      payload: { kind: 'plugin', wasmSha256: wasmSha, ui: { entry: 'ui.html', sha256: uiSha, nav: { label: 'Demo Panel' } } },
    };
    const sig = signManifest(unsigned as Record<string, unknown>, wasmSha, ukp.privateKeyDer);
    const signed = { ...unsigned, signature: sig };
    const bundleDir = join(uiRegistryDir, 'ui-demo-1');
    await mkdir(bundleDir, { recursive: true });
    await writeFile(join(bundleDir, 'manifest.json'), JSON.stringify(signed));
    await writeFile(join(bundleDir, 'plugin.wasm'), wasmBytes);
    await writeFile(join(bundleDir, 'ui.html'), uiBytes);
    await writeFile(join(bundleDir, 'publisher.pub'), Buffer.from(ukp.publicKeyDer).toString('hex'));
  }
});
afterAll(async () => {
  await rm(registryDir, { recursive: true, force: true });
  await rm(formRegistryDir, { recursive: true, force: true });
  await rm(uiRegistryDir, { recursive: true, force: true });
});

function fakePlugins() {
  const calls: Record<string, unknown[]> = { install: [], setEnabled: [], rollback: [], remove: [] };
  return {
    calls,
    runtime: {
      list: async () => [{ id: 'demo', version: '1.0.0', sha256: 'a', status: 'installed', enabled: true, active: true, approvedBy: 'admin', manifest: { type: 'plugin', publisher: { id: 'acme' }, capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }] } }],
      install: async (_w: unknown, _r: unknown, opts: unknown) => { calls.install.push(opts); return { id: 'demo', version: '1.0.0' }; },
      setEnabled: async (id: string, enabled: boolean) => { calls.setEnabled.push({ id, enabled }); },
      rollback: async (id: string, version: string) => { calls.rollback.push({ id, version }); },
      remove: async (id: string, version?: string) => { calls.remove.push({ id, version }); },
      load: async () => undefined,
    },
  };
}

function fakeCtx(plugins: unknown, cfg: Record<string, unknown>, internalDb: unknown, marketplaceForms?: unknown): AppContext {
  return {
    cfg, plugins, internalDb, audit: { record: async () => ({}) },
    marketplaceForms: marketplaceForms ?? { install: async () => ({ id: 'x', version: '1', targetFormId: 'form-1' }), detach: async () => {}, list: async () => [] },
  } as unknown as AppContext;
}

type SeedRegistry = { id: string; name: string; kind: 'local' | 'http'; location: string; enabled?: boolean };

// Build an app over a freshly-migrated in-memory internal DB, optionally pre-seeding
// registry rows. The DB is returned so tests can read/seed registries directly.
async function appWith(
  cfg: Record<string, unknown>,
  plugins: unknown,
  opts: { roles?: string[]; fetchImpl?: typeof fetch; marketplaceForms?: unknown; seed?: SeedRegistry[] } = {},
) {
  const { roles = ['lab_admin'], fetchImpl, marketplaceForms, seed = [] } = opts;
  const db = await makeMigratedDb();
  const store = createRegistryStore(db);
  for (const r of seed) await store.create(r);
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'admin', username: 'admin', displayName: null, roles } as never;
  });
  registerMarketplaceRoutes(app, fakeCtx(plugins, cfg, db, marketplaceForms), fetchImpl);
  return { app, db, store };
}

// The single-bundle local registry every "happy path" test uses.
const REG: SeedRegistry = { id: 'reg-local', name: 'Local Bundles', kind: 'local', location: '' };
function localReg(): SeedRegistry { return { ...REG, location: registryDir }; }
function formReg(): SeedRegistry { return { id: 'reg-forms', name: 'Form Bundles', kind: 'local', location: formRegistryDir }; }

describe('marketplace routes', () => {
  it('lists installed artifacts (mapped shape)', async () => {
    const { runtime } = fakePlugins();
    const { app } = await appWith({}, runtime, { seed: [localReg()] });
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/installed' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0]).toMatchObject({ id: 'demo', version: '1.0.0', active: true, enabled: true, type: 'plugin', legacy: false });
    expect(body[0].capabilities).toEqual([{ kind: 'emit-fhir', resourceTypes: ['Patient'] }]);
  });

  it('403s without lab_admin', async () => {
    const { runtime } = fakePlugins();
    const { app } = await appWith({}, runtime, { roles: [], seed: [localReg()] });
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/installed' });
    expect(res.statusCode).toBe(403);
  });

  it('lists available bundles aggregated from enabled registries (tagged + composite ref)', async () => {
    const { runtime } = fakePlugins();
    const { app } = await appWith({}, runtime, { seed: [localReg()] });
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/available' });
    const body = res.json();
    expect(body.configured).toBe(true);
    expect(body.bundles).toHaveLength(1);
    expect(body.bundles[0]).toMatchObject({ id: 'demo', version: '1.0.0', valid: true, registryId: 'reg-local', registryName: 'Local Bundles' });
    expect(body.bundles[0].ref).toContain('::');
    expect(body.bundles[0].ref).toBe('reg-local::demo-1');
    // versions are also composite-encoded
    expect(body.bundles[0].versions[0].ref).toContain('::');
  });

  it('available rows include description and license', async () => {
    const { runtime } = fakePlugins();
    const { app } = await appWith({}, runtime, { seed: [localReg()] });
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/available' });
    const body = res.json();
    expect(body.bundles[0]).toHaveProperty('description');
    expect(body.bundles[0]).toHaveProperty('license');
  });

  it('aggregates bundles across multiple enabled registries', async () => {
    const { runtime } = fakePlugins();
    const { app } = await appWith({}, runtime, { seed: [localReg(), formReg()] });
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/available' });
    const body = res.json();
    expect(body.configured).toBe(true);
    expect(body.source).toBe('multi');
    expect(body.host).toBe('2 registries');
    const ids = body.bundles.map((b: any) => b.id).sort();
    expect(ids).toEqual(['demo', 'demo-form']);
    const fromForms = body.bundles.find((b: any) => b.id === 'demo-form');
    expect(fromForms).toMatchObject({ registryId: 'reg-forms', registryName: 'Form Bundles' });
  });

  it('returns full manifest detail for one composite ref (with compatible flag)', async () => {
    const { runtime } = fakePlugins();
    const { app } = await appWith({}, runtime, { seed: [localReg()] });
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/available/reg-local::demo-1' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ref: 'reg-local::demo-1', id: 'demo', version: '1.0.0', valid: true, compatible: true, ceVersion: '0.1.0', registryId: 'reg-local', registryName: 'Local Bundles' });
    expect(body.payload).toMatchObject({ kind: 'plugin' });
    expect(body.capabilities).toEqual([{ kind: 'emit-fhir', resourceTypes: ['Patient'] }]);
  });

  it('detail 400s on a non-composite (bad) ref', async () => {
    const { runtime } = fakePlugins();
    const { app } = await appWith({}, runtime, { seed: [localReg()] });
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/available/demo-1' });
    expect(res.statusCode).toBe(400);
  });

  it('detail 404s for an unknown registry id', async () => {
    const { runtime } = fakePlugins();
    const { app } = await appWith({}, runtime, { seed: [localReg()] });
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/available/nope::demo-1' });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a traversal ref on the detail endpoint', async () => {
    const { runtime } = fakePlugins();
    const { app } = await appWith({}, runtime, { seed: [localReg()] });
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/available/reg-local%3A%3A..%2Fsecrets' });
    expect(res.statusCode).toBe(400);
  });

  it('reports unconfigured when no enabled registries', async () => {
    const { runtime } = fakePlugins();
    const { app } = await appWith({}, runtime);
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/available' });
    expect(res.json()).toEqual({ configured: false, bundles: [], source: null, host: null });
  });

  it('available reports the single source kind and host', async () => {
    const { runtime } = fakePlugins();
    const { app } = await appWith({}, runtime, { seed: [localReg()] });
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/available' });
    const body = res.json();
    expect(body.source).toBe('local');
    expect(body.host).toBe('Local Bundles');
  });

  it('refresh returns ok', async () => {
    const { runtime } = fakePlugins();
    const { app } = await appWith({}, runtime, { seed: [localReg()] });
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/refresh' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('installs with consent (passes approval + actor)', async () => {
    const { runtime, calls } = fakePlugins();
    const { app } = await appWith({}, runtime, { seed: [localReg()] });
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/install', payload: { ref: 'reg-local::demo-1', acknowledgedCapabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 'demo', version: '1.0.0' });
    const opts = calls.install[0] as { approval: { approvedBy: string; acknowledgedCapabilities: unknown } };
    expect(opts.approval.approvedBy).toBe('admin');
    expect(opts.approval.acknowledgedCapabilities).toEqual([{ kind: 'emit-fhir', resourceTypes: ['Patient'] }]);
  });

  it('install rejects a non-composite ref', async () => {
    const { runtime, calls } = fakePlugins();
    const { app } = await appWith({}, runtime, { seed: [localReg()] });
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/install', payload: { ref: 'demo-1' } });
    expect(res.statusCode).toBe(400);
    expect(calls.install).toHaveLength(0);
  });

  it('install rejects a path-traversal inner ref', async () => {
    const { runtime, calls } = fakePlugins();
    const { app } = await appWith({}, runtime, { seed: [localReg()] });
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/install', payload: { ref: 'reg-local::../secrets' } });
    expect(res.statusCode).toBe(400);
    expect(calls.install).toHaveLength(0);
  });

  it('publish/status reports configured=false when unset', async () => {
    const { runtime } = fakePlugins();
    const { app } = await appWith({}, runtime, { seed: [localReg()] });
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/publish/status' });
    expect(res.json()).toEqual({ configured: false, repo: null });
  });

  it('publish/status reports configured=true when token+repo set', async () => {
    const { runtime } = fakePlugins();
    const { app } = await appWith({ MARKETPLACE_REGISTRY_DIR: registryDir, MARKETPLACE_PUBLISH_TOKEN: 't', MARKETPLACE_PUBLISH_REPO: 'o/r' }, runtime, { seed: [localReg()] });
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/publish/status' });
    expect(res.json()).toEqual({ configured: true, repo: 'o/r' });
  });

  it('publish returns 412 when not configured', async () => {
    const { runtime } = fakePlugins();
    const { app } = await appWith({}, runtime, { seed: [localReg()] });
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/publish', payload: { ref: 'demo-1' } });
    expect(res.statusCode).toBe(412);
  });

  it('publish opens a PR for a staged bundle (env stagingDir, AS-IS)', async () => {
    const { runtime } = fakePlugins();
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      const ok = (j: unknown) => ({ ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) }) as unknown as Response;
      if (u.includes('/contents/index.json')) return { ok: false, status: 404, text: async () => 'x' } as unknown as Response; // seed
      if (u.includes('/contents/bundles/')) return { ok: false, status: 404 } as unknown as Response; // no conflict
      if (u.endsWith('/git/ref/heads/main')) return ok({ object: { sha: 'base' } });
      if (u.includes('/git/commits/base')) return ok({ tree: { sha: 'bt' } });
      if (u.endsWith('/git/blobs')) return ok({ sha: 'b' });
      if (u.endsWith('/git/trees')) return ok({ sha: 't' });
      if (u.endsWith('/git/commits')) return ok({ sha: 'c' });
      if (u.endsWith('/git/refs')) return ok({ ref: 'r' });
      if (u.endsWith('/pulls')) return ok({ html_url: 'https://gh/pr/3', number: 3 });
      return { ok: false, status: 500, json: async () => ({ message: 'x' }) } as unknown as Response;
    });
    const { app } = await appWith({ MARKETPLACE_REGISTRY_DIR: registryDir, MARKETPLACE_PUBLISH_TOKEN: 't', MARKETPLACE_PUBLISH_REPO: 'o/r', MARKETPLACE_PUBLISH_BRANCH: 'main' }, runtime, { fetchImpl: fetchMock as unknown as typeof fetch, seed: [localReg()] });
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/publish', payload: { ref: 'demo-1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ prUrl: 'https://gh/pr/3', prNumber: 3 });
  });

  it('enable/disable/rollback/remove call the runtime', async () => {
    const { runtime, calls } = fakePlugins();
    const { app } = await appWith({}, runtime, { seed: [localReg()] });
    await app.inject({ method: 'POST', url: '/api/marketplace/demo/disable' });
    await app.inject({ method: 'POST', url: '/api/marketplace/demo/enable' });
    await app.inject({ method: 'POST', url: '/api/marketplace/demo/rollback', payload: { version: '1.0.0' } });
    await app.inject({ method: 'DELETE', url: '/api/marketplace/demo' });
    expect(calls.setEnabled).toEqual([{ id: 'demo', enabled: false }, { id: 'demo', enabled: true }]);
    expect(calls.rollback).toEqual([{ id: 'demo', version: '1.0.0' }]);
    expect(calls.remove).toEqual([{ id: 'demo', version: undefined }]);
  });

  it('install dispatches a form-template bundle to ctx.marketplaceForms', async () => {
    const { runtime } = fakePlugins();
    const installed: unknown[] = [];
    const marketplaceForms = { install: async (b: unknown, o: unknown) => { installed.push({ b, o }); return { id: 'demo-form', version: '1.0.0', targetFormId: 'form-9' }; }, detach: async () => {}, list: async () => [] };
    const { app } = await appWith({}, runtime, { marketplaceForms, seed: [formReg()] });
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/install', payload: { ref: 'reg-forms::demo-form-1', acknowledgedCapabilities: [] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'demo-form', version: '1.0.0' });
    expect(installed).toHaveLength(1);
  });

  it('installed merges plugin + form-template rows', async () => {
    const { runtime } = fakePlugins();
    const marketplaceForms = { install: async () => ({ id: 'x', version: '1', targetFormId: 'f' }), detach: async () => {}, list: async () => [{ artifactId: 'demo-form', version: '1.0.0', kind: 'form-template', targetFormId: 'form-9', publisherName: 'Acme', installedBy: 'admin', drifted: true }] };
    const { app } = await appWith({}, runtime, { marketplaceForms, seed: [localReg()] });
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/installed' });
    const body = res.json();
    expect(body.find((a: any) => a.id === 'demo' && a.type === 'plugin')).toBeTruthy();
    const form = body.find((a: any) => a.id === 'demo-form');
    expect(form).toMatchObject({ type: 'form-template', drifted: true, targetFormId: 'form-9' });
  });

  it('detach calls ctx.marketplaceForms.detach', async () => {
    const { runtime } = fakePlugins();
    const calls: string[] = [];
    const marketplaceForms = { install: async () => ({ id: 'x', version: '1', targetFormId: 'f' }), detach: async (id: string) => { calls.push(id); }, list: async () => [] };
    const { app } = await appWith({}, runtime, { marketplaceForms, seed: [localReg()] });
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/demo-form/detach' });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual(['demo-form']);
  });

  // ── Registries CRUD ──
  describe('registries CRUD', () => {
    it('POST creates → GET lists → PUT disables → DELETE removes', async () => {
      const { runtime } = fakePlugins();
      const { app } = await appWith({}, runtime);

      // create
      const created = await app.inject({ method: 'POST', url: '/api/marketplace/registries', payload: { name: 'Public', kind: 'http', location: 'https://example.org/reg' } });
      expect(created.statusCode).toBe(200);
      const reg = created.json();
      expect(reg).toMatchObject({ name: 'Public', kind: 'http', location: 'https://example.org/reg', enabled: true });
      expect(typeof reg.id).toBe('string');

      // list
      const listed = await app.inject({ method: 'GET', url: '/api/marketplace/registries' });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().map((r: any) => r.id)).toContain(reg.id);

      // patch enabled=false
      const patched = await app.inject({ method: 'PUT', url: `/api/marketplace/registries/${reg.id}`, payload: { enabled: false } });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().enabled).toBe(false);

      // delete
      const deleted = await app.inject({ method: 'DELETE', url: `/api/marketplace/registries/${reg.id}` });
      expect(deleted.json()).toEqual({ ok: true });
      const after = await app.inject({ method: 'GET', url: '/api/marketplace/registries' });
      expect(after.json().map((r: any) => r.id)).not.toContain(reg.id);
    });

    it('POST 400s on invalid input', async () => {
      const { runtime } = fakePlugins();
      const { app } = await appWith({}, runtime);
      const res = await app.inject({ method: 'POST', url: '/api/marketplace/registries', payload: { name: '', kind: 'ftp', location: '' } });
      expect(res.statusCode).toBe(400);
    });

    it('PUT 404s for an unknown registry', async () => {
      const { runtime } = fakePlugins();
      const { app } = await appWith({}, runtime);
      const res = await app.inject({ method: 'PUT', url: '/api/marketplace/registries/nope', payload: { enabled: false } });
      expect(res.statusCode).toBe(404);
    });

    it('a disabled registry is excluded from available', async () => {
      const { runtime } = fakePlugins();
      const { app } = await appWith({}, runtime, { seed: [{ ...localReg(), enabled: false }] });
      const res = await app.inject({ method: 'GET', url: '/api/marketplace/available' });
      expect(res.json()).toEqual({ configured: false, bundles: [], source: null, host: null });
    });

    it('CRUD requires lab_admin', async () => {
      const { runtime } = fakePlugins();
      const { app } = await appWith({}, runtime, { roles: [] });
      const res = await app.inject({ method: 'GET', url: '/api/marketplace/registries' });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── UI-bearing bundle install round-trip ──
  // Exercises the b.ui pass-through: the route must forward Bundle.ui into
  // ctx.plugins.install(). Without that, the real runtime throws because the
  // manifest declares payload.ui but no ui bytes are provided. We then read the
  // installed ui.html back through the live /api/plugins/:id/ui/asset endpoint.
  describe('ui-bearing bundle install round-trip', () => {
    it('installs a payload.ui plugin and serves its ui.html via /api/plugins/:id/ui/asset', async () => {
      // In-memory blob + plugin store backing a REAL plugin runtime, so the install
      // path actually persists ui bytes and loadUi can read them back.
      const blobMap = new Map<string, Uint8Array>();
      const fakeBlob = {
        put: vi.fn(async (k: string, b: Uint8Array) => { blobMap.set(k, b); }),
        get: vi.fn(async (k: string) => { const v = blobMap.get(k); if (!v) throw new Error('missing blob: ' + k); return v; }),
        exists: vi.fn(), presign: vi.fn(), healthCheck: vi.fn(),
      } as never;
      const rows = new Map<string, { id: string; version: string; active: boolean; enabled: boolean; manifest: Record<string, unknown> }>();
      const fakeStore = {
        install: vi.fn(async (r: { id: string; version: string; manifest: Record<string, unknown> }) => {
          rows.set(`${r.id}@${r.version}`, { ...r, status: 'installed', enabled: true, active: true } as never);
        }),
        get: vi.fn(async (id: string, v?: string) => {
          for (const row of rows.values()) if (row.id === id && (v ? row.version === v : row.active && row.enabled)) return row;
          return undefined;
        }),
        list: vi.fn(async () => [...rows.values()]),
        rollback: vi.fn(), setEnabled: vi.fn(), remove: vi.fn(),
      } as never;
      const realRuntime = createPluginRuntime({
        blob: fakeBlob,
        store: fakeStore,
        runner: { run: vi.fn(async () => new TextEncoder().encode('')) } as never,
        logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        trustStore: { get: async () => undefined, pin: async () => {} },
        ceVersion: '0.1.0',
        verifyConfig: { devAllowUnsigned: false },
      });

      // App wired with BOTH marketplace routes (install) and plugin-ui routes (asset).
      const uiReg: SeedRegistry = { id: 'reg-ui', name: 'UI Bundles', kind: 'local', location: uiRegistryDir };
      const db = await makeMigratedDb();
      const regStore = createRegistryStore(db);
      await regStore.create(uiReg);
      const ctx = fakeCtx(realRuntime, { PLUGIN_UI_ENABLED: true }, db);
      const app = Fastify();
      app.addHook('onRequest', async (req) => {
        req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] } as never;
      });
      registerMarketplaceRoutes(app, ctx);
      registerPluginUiRoutes(app, ctx);

      const res = await app.inject({
        method: 'POST', url: '/api/marketplace/install',
        payload: { ref: 'reg-ui::ui-demo-1', acknowledgedCapabilities: [] },
      });
      // If the route did NOT pass b.ui, the real runtime would throw "manifest declares
      // payload.ui but no ui bytes were provided" and return 400. A 200 proves the seam works.
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: 'ui-demo', version: '1.0.0' });
      expect(blobMap.has('plugins/ui-demo/1.0.0/ui.html')).toBe(true);

      // The stored ui.html is served back, sandboxed, by the plugin-ui asset route.
      const asset = await app.inject({ method: 'GET', url: '/api/plugins/ui-demo/ui/asset' });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers['content-type']).toContain('text/html');
      expect(asset.body).toBe('<div>panel</div>');
    });
  });
});
