import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerSettingsRoutes } from './settings-routes';

const SYNC_STATUS = {
  enabled: true, mode: 'push', centralUrl: 'https://central.example', siteId: 'lab-1',
  push: { running: true, lastSeq: 7, lastSyncedAt: '2026-07-14T00:00:00.000Z' },
  pull: null, pendingPush: 3,
};

function fakeCtx(syncEnabled = true) {
  const store = new Map<string, boolean>();
  const settings = new Map<string, string>();
  const audit: any[] = [];
  const ops = { resetDashboards: 0, factoryReset: 0, clearAudit: 0 };
  const triggerNow = vi.fn();
  const reconcile = vi.fn(async () => {});
  let strictness: 'low' | 'medium' | 'high' = 'high';
  const validationStrictnessSet = vi.fn(async (level: 'low' | 'medium' | 'high', _actor: string | null) => { strictness = level; });
  return {
    ctx: {
      validationStrictness: {
        get: async () => strictness,
        set: validationStrictnessSet,
      },
      __validationStrictnessSet: validationStrictnessSet,
      sync: {
        status: async () => ({ ...SYNC_STATUS, enabled: syncEnabled }),
        triggerNow,
        listQuarantine: async () => [],
        retryQuarantine: async () => ({ ok: true }),
      },
      __triggerNow: triggerNow,
      syncRuntime: { reconcile },
      __reconcile: reconcile,
      featureFlags: {
        get: async (id: string) => store.get(id) ?? false,
        all: async () => [{ id: 'dashboard.raw_sql', labelKey: 'l', descriptionKey: 'd', value: store.get('dashboard.raw_sql') ?? false }],
        set: async (id: string, v: boolean) => { store.set(id, v); },
        invalidate: () => {},
      },
      // Minimal AppSettingStore for the sync config route.
      appSettings: {
        get: async (k: string) => (settings.has(k) ? { value: settings.get(k)! } : undefined),
        set: async (k: string, v: string) => { settings.set(k, v); },
      },
      // Fake seal: prefix so a test can assert the stored value is the ENCRYPTED form, never plaintext.
      encryptSecret: (plain: string) => `enc:${plain}`,
      decryptSecret: (blob: string) => blob.replace(/^enc:/, ''),
      audit: { record: async (e: any) => { audit.push(e); return e; } },
      logger: { error() {}, warn() {}, info() {} },
      dashboards: { store: { list: async () => [], remove: async () => {}, create: async () => ({}) } },
      internalDb: {} as any,
      cfg: {},
      __audit: audit,
      __settings: settings,
      __ops: ops,
    } as any,
    deps: {
      resetDashboards: async () => { ops.resetDashboards++; },
      factoryReset: async () => { ops.factoryReset++; },
      clearAudit: async () => { ops.clearAudit++; },
    },
  };
}

function appWithUser(roles: string[], reg: (app: any) => void) {
  const app = Fastify();
  app.addHook('preHandler', async (req: any) => { req.user = { id: 'u1', username: 'admin', roles }; });
  reg(app);
  return app;
}

describe('settings routes', () => {
  it('GET /api/settings/flags returns merged flags', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'GET', url: '/api/settings/flags' });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].id).toBe('dashboard.raw_sql');
  });

  it('PUT /api/settings/flags/:key sets the value and audits', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'PUT', url: '/api/settings/flags/dashboard.raw_sql', payload: { value: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().value).toBe(true);
    expect((ctx as any).__audit.some((e: any) => e.action === 'settings.flag.update')).toBe(true);
  });

  it('non-admin PUT is 403', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_technician'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'PUT', url: '/api/settings/flags/dashboard.raw_sql', payload: { value: true } });
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/settings/danger/factory-reset runs the op and audits', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'POST', url: '/api/settings/danger/factory-reset' });
    expect(res.statusCode).toBe(200);
    expect((ctx as any).__ops.factoryReset).toBe(1);
    expect((ctx as any).__audit.some((e: any) => e.action === 'settings.danger.factory-reset')).toBe(true);
  });

  it('unknown danger action is 404', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'POST', url: '/api/settings/danger/nuke-everything' });
    expect(res.statusCode).toBe(404);
  });

  it('PUT /api/settings/sync persists discrete keys, encrypts the secret, returns a secret-free view', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({
      method: 'PUT', url: '/api/settings/sync',
      payload: {
        enabled: true, mode: 'push', centralUrl: 'https://central.example',
        siteId: 'lab-1', oidcIssuer: 'https://kc.example', clientId: 'sync-client',
        clientSecret: 'super-secret', intervalMinutes: 30,
      },
    });
    expect(res.statusCode).toBe(200);
    const view = res.json();
    // Secret-free view.
    expect(view.clientSecretSet).toBe(true);
    expect('clientSecret' in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain('super-secret');
    expect(view).toMatchObject({ enabled: true, mode: 'push', centralUrl: 'https://central.example', siteId: 'lab-1', oidcIssuer: 'https://kc.example', clientId: 'sync-client', intervalMinutes: 30 });
    // Discrete keys landed; the secret is stored ENCRYPTED (never plaintext).
    const s = (ctx as any).__settings as Map<string, string>;
    expect(s.get('sync.enabled')).toBe('true');
    expect(s.get('sync.site_id')).toBe('lab-1');
    expect(s.get('sync.client_secret')).toBe('enc:super-secret');
    // Audit metadata carries only secret-free views.
    const row = (ctx as any).__audit.find((e: any) => e.action === 'settings.sync.update');
    expect(row).toBeTruthy();
    expect(JSON.stringify(row.metadata)).not.toContain('super-secret');
    // The live workers must reconcile so enable/disable/reconfigure takes effect without a restart.
    expect((ctx as any).__reconcile).toHaveBeenCalledTimes(1);
  });

  it('PUT /api/settings/sync with enabled but missing oidcIssuer is 400', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({
      method: 'PUT', url: '/api/settings/sync',
      payload: { enabled: true, centralUrl: 'https://central.example', siteId: 'lab-1', clientId: 'c' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/settings/sync returns the secret-free view', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    await app.inject({
      method: 'PUT', url: '/api/settings/sync',
      payload: { enabled: false, centralUrl: '', siteId: '', oidcIssuer: '', clientId: '', clientSecret: 'shh', intervalMinutes: 15 },
    });
    const res = await app.inject({ method: 'GET', url: '/api/settings/sync' });
    expect(res.statusCode).toBe(200);
    const view = res.json();
    expect(view.clientSecretSet).toBe(true);
    expect('clientSecret' in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain('shh');
  });

  it('PUT then GET /api/settings/sync round-trips the lab keys: private key write-only, public key readable', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const put = await app.inject({
      method: 'PUT', url: '/api/settings/sync',
      payload: {
        enabled: false, centralUrl: '', siteId: '', oidcIssuer: '', clientId: '', intervalMinutes: 15,
        signingPrivateKey: 'deadbeef-priv', centralPublicKey: 'cafef00d-pub',
      },
    });
    expect(put.statusCode).toBe(200);
    // The private key is sealed (ENCRYPTED), never stored/returned in plaintext.
    expect((ctx as any).__settings.get('sync.signing_private_key')).toBe('enc:deadbeef-priv');
    expect((ctx as any).__settings.get('sync.central_public_key')).toBe('cafef00d-pub');

    const res = await app.inject({ method: 'GET', url: '/api/settings/sync' });
    expect(res.statusCode).toBe(200);
    const view = res.json();
    expect(view.signingKeySet).toBe(true);
    expect(view.centralPublicKey).toBe('cafef00d-pub');
    // Private key is write-only: neither the field nor its value ever appears in the view.
    expect('signingPrivateKey' in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain('deadbeef-priv');
  });

  it('GET /api/settings/sync/status returns the live status', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'GET', url: '/api/settings/sync/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ enabled: true, mode: 'push', pendingPush: 3, push: { lastSeq: 7 } });
  });

  it('GET /api/settings/sync/status is 403 for non-admins', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_technician'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'GET', url: '/api/settings/sync/status' });
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/settings/sync/now triggers + audits when enabled', async () => {
    const { ctx, deps } = fakeCtx(true);
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'POST', url: '/api/settings/sync/now' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ triggered: true });
    expect((ctx as any).__triggerNow).toHaveBeenCalledTimes(1);
    expect((ctx as any).__audit.some((e: any) => e.action === 'settings.sync.now')).toBe(true);
  });

  it('POST /api/settings/sync/now is 409 and does NOT trigger when disabled', async () => {
    const { ctx, deps } = fakeCtx(false);
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'POST', url: '/api/settings/sync/now' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ triggered: false, reason: 'disabled' });
    expect((ctx as any).__triggerNow).not.toHaveBeenCalled();
    expect((ctx as any).__audit.some((e: any) => e.action === 'settings.sync.now')).toBe(false);
  });

  it('GET /api/settings/sync/quarantine lists quarantined items', async () => {
    const rows = [{ entityType: 'terminology_system', entityId: 'http://x', attempts: 3, status: 'quarantined' }];
    const { ctx, deps } = fakeCtx();
    (ctx as any).sync.listQuarantine = async () => rows;
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'GET', url: '/api/settings/sync/quarantine' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(rows);
  });

  it('POST /api/settings/sync/quarantine/retry delegates + audits', async () => {
    const retry = vi.fn(async () => ({ ok: true }));
    const { ctx, deps } = fakeCtx();
    (ctx as any).sync.retryQuarantine = retry;
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'POST', url: '/api/settings/sync/quarantine/retry', payload: { entityType: 'terminology_system', entityId: 'http://x' } });
    expect(res.statusCode).toBe(200);
    expect(retry).toHaveBeenCalledWith('terminology_system', 'http://x');
    expect((ctx as any).__audit.some((e: any) => e.action === 'settings.sync.quarantine.retry')).toBe(true);
  });

  it('retry returns 400 on missing fields; 409 when pull disabled', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    expect((await app.inject({ method: 'POST', url: '/api/settings/sync/quarantine/retry', payload: {} })).statusCode).toBe(400);

    const { ctx: ctx2, deps: deps2 } = fakeCtx();
    (ctx2 as any).sync.retryQuarantine = async () => ({ ok: false, error: 'sync pull is not enabled on this node' });
    const app2 = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx2, deps2));
    expect((await app2.inject({ method: 'POST', url: '/api/settings/sync/quarantine/retry', payload: { entityType: 'terminology_system', entityId: 'http://x' } })).statusCode).toBe(409);
  });

  it('failed danger op still audits the attempt (ok: false) and returns 500', async () => {
    const { ctx, deps } = fakeCtx();
    deps.clearAudit = async () => { throw new Error('reseed blew up'); };
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'POST', url: '/api/settings/danger/clear-audit' });
    expect(res.statusCode).toBe(500);
    const row = (ctx as any).__audit.find((e: any) => e.action === 'settings.danger.clear-audit');
    expect(row).toBeTruthy();
    expect(row.metadata.ok).toBe(false);
  });

  it('GET /api/settings/validation returns the default strictness', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'GET', url: '/api/settings/validation' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ strictness: 'high' });
  });

  it('PUT /api/settings/validation sets the strictness and audits', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'PUT', url: '/api/settings/validation', payload: { strictness: 'medium' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ strictness: 'medium' });
    expect((ctx as any).__validationStrictnessSet).toHaveBeenCalledWith('medium', 'u1');
    const row = (ctx as any).__audit.find((e: any) => e.action === 'settings.validation_strictness');
    expect(row).toBeTruthy();
    expect(row.entityType).toBe('app_setting');
    expect(row.entityId).toBe('validation.strictness');
    expect(row.before).toEqual({ strictness: 'high' });
    expect(row.after).toEqual({ strictness: 'medium' });
  });

  it('PUT /api/settings/validation with an invalid level is 400', async () => {
    const { ctx, deps } = fakeCtx();
    const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
    const res = await app.inject({ method: 'PUT', url: '/api/settings/validation', payload: { strictness: 'bogus' } });
    expect(res.statusCode).toBe(400);
    expect((ctx as any).__validationStrictnessSet).not.toHaveBeenCalled();
  });

  describe('GET /api/settings/sync/central-certificate', () => {
    const PEM = '-----BEGIN CERTIFICATE-----\nMIIFakeFakeFakeFakeFake==\n-----END CERTIFICATE-----\n';

    it('lab_admin GET with a readable TLS_CERT_PATH streams the PEM as a download', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'openldr-cert-'));
      const file = join(dir, 'fullchain.pem');
      await writeFile(file, PEM, 'utf8');
      try {
        const { ctx, deps } = fakeCtx();
        (ctx as any).cfg.TLS_CERT_PATH = file;
        const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
        const res = await app.inject({ method: 'GET', url: '/api/settings/sync/central-certificate' });
        expect(res.statusCode).toBe(200);
        expect(res.body).toBe(PEM);
        expect(res.headers['content-type']).toContain('application/x-pem-file');
        expect(res.headers['content-disposition']).toContain('attachment');
        expect(res.headers['content-disposition']).toContain('.pem');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('TLS_CERT_PATH unset is 404', async () => {
      const { ctx, deps } = fakeCtx();
      const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
      const res = await app.inject({ method: 'GET', url: '/api/settings/sync/central-certificate' });
      expect(res.statusCode).toBe(404);
    });

    it('TLS_CERT_PATH set but the file does not exist is 404', async () => {
      const { ctx, deps } = fakeCtx();
      (ctx as any).cfg.TLS_CERT_PATH = join(tmpdir(), 'openldr-cert-does-not-exist', 'no-such-file.pem');
      const app = appWithUser(['lab_admin'], (a) => registerSettingsRoutes(a, ctx, deps));
      const res = await app.inject({ method: 'GET', url: '/api/settings/sync/central-certificate' });
      expect(res.statusCode).toBe(404);
    });

    it('non-admin GET is 403', async () => {
      const { ctx, deps } = fakeCtx();
      (ctx as any).cfg.TLS_CERT_PATH = join(tmpdir(), 'irrelevant.pem');
      const app = appWithUser(['lab_technician'], (a) => registerSettingsRoutes(a, ctx, deps));
      const res = await app.inject({ method: 'GET', url: '/api/settings/sync/central-certificate' });
      expect(res.statusCode).toBe(403);
    });
  });
});
