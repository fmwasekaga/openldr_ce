import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppContext } from '@openldr/bootstrap';
import { generatePublisherKeypair, packBundle } from '@openldr/marketplace';
import { registerMarketplaceRoutes } from './marketplace-routes';

// ── A temp registry dir with one signed plugin bundle (built via packBundle). ──
let registryDir: string;
let formRegistryDir: string;
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
});
afterAll(async () => {
  await rm(registryDir, { recursive: true, force: true });
  await rm(formRegistryDir, { recursive: true, force: true });
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

function fakeCtx(plugins: unknown, cfg: Record<string, unknown>, marketplaceForms?: unknown): AppContext {
  return {
    cfg, plugins, audit: { record: async () => ({}) },
    marketplaceForms: marketplaceForms ?? { install: async () => ({ id: 'x', version: '1', targetFormId: 'form-1' }), detach: async () => {}, list: async () => [] },
  } as unknown as AppContext;
}

function appWith(cfg: Record<string, unknown>, plugins: unknown, roles: string[] = ['lab_admin'], fetchImpl?: typeof fetch, marketplaceForms?: unknown) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'admin', username: 'admin', displayName: null, roles } as never;
  });
  registerMarketplaceRoutes(app, fakeCtx(plugins, cfg, marketplaceForms), fetchImpl);
  return app;
}

describe('marketplace routes', () => {
  it('lists installed artifacts (mapped shape)', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime);
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/installed' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0]).toMatchObject({ id: 'demo', version: '1.0.0', active: true, enabled: true, type: 'plugin', legacy: false });
    expect(body[0].capabilities).toEqual([{ kind: 'emit-fhir', resourceTypes: ['Patient'] }]);
  });

  it('403s without lab_admin', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime, []);
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/installed' });
    expect(res.statusCode).toBe(403);
  });

  it('lists available bundles from the registry dir', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime);
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/available' });
    const body = res.json();
    expect(body.configured).toBe(true);
    expect(body.bundles).toHaveLength(1);
    expect(body.bundles[0]).toMatchObject({ ref: 'demo-1', id: 'demo', version: '1.0.0', valid: true });
  });

  it('available rows include description and license', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime);
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/available' });
    const body = res.json();
    expect(body.bundles[0]).toHaveProperty('description');
    expect(body.bundles[0]).toHaveProperty('license');
  });

  it('returns full manifest detail for one ref (with compatible flag)', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime);
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/available/demo-1' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ref: 'demo-1', id: 'demo', version: '1.0.0', valid: true, compatible: true, ceVersion: '0.1.0' });
    expect(body.payload).toMatchObject({ kind: 'plugin' });
    expect(body.capabilities).toEqual([{ kind: 'emit-fhir', resourceTypes: ['Patient'] }]);
  });

  it('rejects a traversal ref on the detail endpoint', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime);
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/available/..%2Fsecrets' });
    expect(res.statusCode).toBe(400);
  });

  it('reports unconfigured when no registry dir', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({}, runtime);
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/available' });
    expect(res.json()).toEqual({ configured: false, bundles: [], source: null, host: null });
  });

  it('available reports the source kind and host', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime);
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/available' });
    const body = res.json();
    expect(body.source).toBe('local');
  });

  it('refresh returns ok', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime);
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/refresh' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('installs with consent (passes approval + actor)', async () => {
    const { runtime, calls } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime);
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/install', payload: { ref: 'demo-1', acknowledgedCapabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 'demo', version: '1.0.0' });
    const opts = calls.install[0] as { approval: { approvedBy: string; acknowledgedCapabilities: unknown } };
    expect(opts.approval.approvedBy).toBe('admin');
    expect(opts.approval.acknowledgedCapabilities).toEqual([{ kind: 'emit-fhir', resourceTypes: ['Patient'] }]);
  });

  it('rejects a path-traversal ref', async () => {
    const { runtime, calls } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime);
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/install', payload: { ref: '../secrets' } });
    expect(res.statusCode).toBe(400);
    expect(calls.install).toHaveLength(0);
  });

  it('publish/status reports configured=false when unset', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime);
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/publish/status' });
    expect(res.json()).toEqual({ configured: false, repo: null });
  });

  it('publish/status reports configured=true when token+repo set', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir, MARKETPLACE_PUBLISH_TOKEN: 't', MARKETPLACE_PUBLISH_REPO: 'o/r' }, runtime);
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/publish/status' });
    expect(res.json()).toEqual({ configured: true, repo: 'o/r' });
  });

  it('publish returns 412 when not configured', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime);
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/publish', payload: { ref: 'demo-1' } });
    expect(res.statusCode).toBe(412);
  });

  it('publish opens a PR for a staged bundle', async () => {
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
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir, MARKETPLACE_PUBLISH_TOKEN: 't', MARKETPLACE_PUBLISH_REPO: 'o/r', MARKETPLACE_PUBLISH_BRANCH: 'main' }, runtime, ['lab_admin'], fetchMock as unknown as typeof fetch);
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/publish', payload: { ref: 'demo-1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ prUrl: 'https://gh/pr/3', prNumber: 3 });
  });

  it('enable/disable/rollback/remove call the runtime', async () => {
    const { runtime, calls } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime);
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
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: formRegistryDir }, runtime, ['lab_admin'], undefined, marketplaceForms);
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/install', payload: { ref: 'demo-form-1', acknowledgedCapabilities: [] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'demo-form', version: '1.0.0' });
    expect(installed).toHaveLength(1);
  });

  it('installed merges plugin + form-template rows', async () => {
    const { runtime } = fakePlugins();
    const marketplaceForms = { install: async () => ({ id: 'x', version: '1', targetFormId: 'f' }), detach: async () => {}, list: async () => [{ artifactId: 'demo-form', version: '1.0.0', kind: 'form-template', targetFormId: 'form-9', publisherName: 'Acme', installedBy: 'admin', drifted: true }] };
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime, ['lab_admin'], undefined, marketplaceForms);
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
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime, ['lab_admin'], undefined, marketplaceForms);
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/demo-form/detach' });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual(['demo-form']);
  });
});
