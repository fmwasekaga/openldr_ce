import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { dangerResetDashboards, dangerFactoryReset, dangerClearAudit } from '@openldr/bootstrap';
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
