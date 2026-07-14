import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { dangerResetDashboards, dangerFactoryReset, dangerClearAudit, getSyncConfig, setSyncConfig } from '@openldr/bootstrap';
import { requireRole } from './rbac';
import { recordAudit } from './audit-helper';

export interface DangerDeps {
  resetDashboards: (ctx: AppContext) => Promise<void>;
  factoryReset: (ctx: AppContext) => Promise<void>;
  clearAudit: (ctx: AppContext) => Promise<void>;
}

// Delegate to the shared bootstrap orchestrations so the CLI (`openldr settings danger …`) and
// the HTTP route run identical code. Injectable so settings-routes.test.ts can stub them.
const defaultDeps: DangerDeps = {
  resetDashboards: dangerResetDashboards,
  factoryReset: dangerFactoryReset,
  clearAudit: dangerClearAudit,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerSettingsRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext, deps: DangerDeps = defaultDeps): void {
  app.get('/api/settings/flags', { preHandler: requireRole('lab_admin') }, async () => ctx.featureFlags.all());

  // Lab⇄central sync config — writes the discrete `sync.*` app_settings keys the sync workers read
  // (client secret encrypted + write-only). Admin-only + audited, mirrored by `openldr settings sync …`.
  app.get('/api/settings/sync', { preHandler: requireRole('lab_admin') }, async () =>
    getSyncConfig(ctx.appSettings),
  );

  app.put('/api/settings/sync', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const before = await getSyncConfig(ctx.appSettings);
    let after;
    try {
      after = await setSyncConfig(ctx.appSettings, req.body, req.user?.id ?? null, ctx.encryptSecret);
    } catch (e) {
      reply.code(400);
      return { error: e instanceof Error ? e.message : 'invalid sync config' };
    }
    await recordAudit(ctx, req, {
      action: 'settings.sync.update', entityType: 'app_setting', entityId: 'sync.*',
      metadata: { before, after },
    });
    return after;
  });

  // Live sync status + manual trigger (T6). User-authed under /api/settings/* (admin-only) — NOT under
  // /api/sync/* (that surface is machine-cred and skips the user auth gate). status() is always present
  // on ctx.sync even when sync is disabled; `now` refuses (409) when disabled so it never no-ops silently.
  app.get('/api/settings/sync/status', { preHandler: requireRole('lab_admin') }, async () => ctx.sync.status());

  app.post('/api/settings/sync/now', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const s = await ctx.sync.status();
    if (!s.enabled) { reply.code(409); return { triggered: false, reason: 'disabled' }; }
    ctx.sync.triggerNow();
    await recordAudit(ctx, req, { action: 'settings.sync.now', entityType: 'app_settings', entityId: 'sync', metadata: {} });
    return { triggered: true };
  });

  app.put('/api/settings/flags/:key', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const { key } = req.params as { key: string };
    const { value } = req.body as { value: boolean };
    const after = Boolean(value);
    const before = await ctx.featureFlags.get(key);
    await ctx.featureFlags.set(key, after, req.user?.id ?? null);
    await recordAudit(ctx, req, {
      action: 'settings.flag.update', entityType: 'app_setting', entityId: key,
      metadata: { key, before, after },
    });
    reply.code(200);
    return { key, value: after };
  });

  // Admin-tunable number settings (operational limits). Admin-only + audited, mirrored by
  // `openldr settings numbers …`.
  app.get('/api/settings/numbers', { preHandler: requireRole('lab_admin') }, async () =>
    ctx.numberSettings.all(),
  );

  app.put('/api/settings/numbers/:key', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const { key } = req.params as { key: string };
    const { value } = req.body as { value: number };
    const before = await ctx.numberSettings.get(key).catch(() => null);
    let after: number;
    try {
      after = await ctx.numberSettings.set(key, Number(value), req.user?.id ?? null);
    } catch (e) {
      reply.code(400);
      return { error: e instanceof Error ? e.message : 'invalid number setting' };
    }
    await recordAudit(ctx, req, {
      action: 'settings.number.update', entityType: 'app_setting', entityId: key,
      metadata: { key, before, after },
    });
    return { key, value: after };
  });

  const DANGER: Record<string, keyof DangerDeps> = {
    'reset-dashboards': 'resetDashboards',
    'factory-reset': 'factoryReset',
    'clear-audit': 'clearAudit',
  };

  app.post('/api/settings/danger/:action', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const { action } = req.params as { action: string };
    const fn = DANGER[action];
    if (!fn) { reply.code(404); return { error: 'unknown action' }; }
    let ok = true;
    try {
      await deps[fn](ctx);
    } catch (e) {
      ok = false;
      throw e;
    } finally {
      // Record the attempt regardless of outcome — a partial factory-reset (tables wiped, reseed
      // errors) must still leave an audit trace. `ok` distinguishes success from failure.
      await recordAudit(ctx, req, {
        action: `settings.danger.${action}`, entityType: 'app_settings', entityId: 'internal-db',
        metadata: { action, ok },
      });
    }
    reply.code(200);
    return { ok: true, action };
  });
}
