import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerPluginUiRoutes } from './plugin-ui-routes';

function fakeCtx(over: Partial<any> = {}) {
  return {
    cfg: { PLUGIN_UI_ENABLED: true },
    plugins: {
      list: async () => [
        { id: 'ui-demo', version: '1.0.0', enabled: true, manifest: { payload: { kind: 'plugin', ui: { entry: 'ui.html', sha256: 'x', nav: { label: 'Demo', icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1' } } } },
        { id: 'whonet', version: '1.0.0', enabled: true, manifest: { payload: { kind: 'plugin' } } },
      ],
      loadUi: async (id: string) => (id === 'ui-demo' ? new TextEncoder().encode('<div>panel</div>') : undefined),
    },
    pluginBroker: { handle: async (_id: string, _p: unknown, op: any) => ({ ok: true, data: { echoedOp: op.kind } }) },
    ...over,
  } as any;
}

function build(ctx: any): FastifyInstance {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { (req as any).user = { id: 'u1', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
  registerPluginUiRoutes(app, ctx);
  return app;
}

describe('plugin-ui routes', () => {
  let app: FastifyInstance;
  beforeEach(() => { app = build(fakeCtx()); });

  it('GET /api/plugins/ui lists only ui-contributing plugins', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plugins/ui' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.map((p: any) => p.id)).toEqual(['ui-demo']);
    expect(body[0].nav).toEqual({ label: 'Demo', icon: 'puzzle', section: 'apps' });
  });

  it('GET /api/plugins/ui returns [] when the master switch is off', async () => {
    const off = build(fakeCtx({ cfg: { PLUGIN_UI_ENABLED: false } }));
    const res = await off.inject({ method: 'GET', url: '/api/plugins/ui' });
    expect(res.json()).toEqual([]);
  });

  it('GET /api/plugins/:id/ui/asset serves the stored html', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plugins/ui-demo/ui/asset' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toBe('<div>panel</div>');
  });

  it('GET asset 404s for a plugin without ui', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plugins/whonet/ui/asset' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/plugins/:id/broker forwards to the broker', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/plugins/ui-demo/broker', payload: { op: { kind: 'reports.list' } } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, data: { echoedOp: 'reports.list' } });
  });

  it('POST broker 400s when op is missing', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/plugins/ui-demo/broker', payload: {} });
    expect(res.statusCode).toBe(400);
  });
});
