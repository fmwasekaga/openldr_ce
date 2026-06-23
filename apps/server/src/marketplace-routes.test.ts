import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppContext } from '@openldr/bootstrap';
import { generatePublisherKeypair, packBundle } from '@openldr/marketplace';
import { registerMarketplaceRoutes } from './marketplace-routes';

// ── A temp registry dir with one signed plugin bundle (built via packBundle). ──
let registryDir: string;
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
});
afterAll(async () => { await rm(registryDir, { recursive: true, force: true }); });

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

function fakeCtx(plugins: unknown, cfg: Record<string, unknown>): AppContext {
  return { cfg, plugins } as unknown as AppContext;
}

function appWith(cfg: Record<string, unknown>, plugins: unknown, roles: string[] = ['lab_admin']) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'admin', username: 'admin', displayName: null, roles } as never;
  });
  registerMarketplaceRoutes(app, fakeCtx(plugins, cfg));
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
    expect(res.json()).toEqual({ configured: false, bundles: [] });
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
});
