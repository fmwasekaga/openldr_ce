import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { dangerResetDashboards, dangerFactoryReset, dangerClearAudit, getSyncConfig, setSyncConfig, enrollSite, listSites, rotateSite, revokeSite } from '@openldr/bootstrap';
import { requireRole } from './rbac';
import { recordAudit } from './audit-helper';

// Duck-type by error name — robust across module/bundle boundaries and consistent with the
// `IdentityAdminNotConfiguredError` handling in users-routes (that class lives in @openldr/ports,
// which apps/server intentionally does not depend on, so name-based detection is the shared idiom).
function errName(e: unknown): string | null {
  return e instanceof Error ? e.name : null;
}

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

  // POST /api/settings/sync/amend — a central operator amends a lab-owned result (Sync S6a). User-authed
  // + lab_admin (this is a central-side authoring action), deliberately NOT under /api/sync/* (that
  // surface is machine-cred). fhirStore.amend does the transactional version-bump + Provenance + outbox
  // write, keeping the owning lab's site_id; the amendment then flows down that lab's pull-amendments
  // stream. Audited SECRET/PHI-free: resource reference + new version only.
  app.post('/api/settings/sync/amend', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const b = (req.body ?? {}) as { resourceType?: unknown; id?: unknown; status?: unknown; reason?: unknown; patch?: unknown; agent?: unknown };
    if (typeof b.resourceType !== 'string' || !b.resourceType || typeof b.id !== 'string' || !b.id || typeof b.status !== 'string' || !b.status) {
      reply.code(400).send({ error: 'resourceType, id and status are required' });
      return;
    }
    try {
      const result = await ctx.fhirStore.amend({
        resourceType: b.resourceType,
        id: b.id,
        status: b.status,
        reason: typeof b.reason === 'string' ? b.reason : undefined,
        patch: b.patch && typeof b.patch === 'object' ? (b.patch as Record<string, unknown>) : undefined,
        agent: typeof b.agent === 'string' && b.agent ? b.agent : 'central',
      });
      await recordAudit(ctx, req, {
        action: 'settings.sync.amend',
        entityType: b.resourceType,
        entityId: b.id,
        metadata: { version: result.version, provenanceId: result.provenanceId, siteId: result.siteId },
      });
      reply.code(200).send(result);
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'ResourceNotFoundError') { reply.code(404).send({ error: 'resource not found' }); return; }
      if (name === 'NotLabOwnedError') { reply.code(409).send({ error: 'resource is not lab-owned' }); return; }
      throw e; // unknown → 500 via the global handler
    }
  });

  // ------------------------------------------------------------------
  // Sync S4d enrollment (central mints lab clients). Admin-only + audited, under /api/settings/*
  // (user-authed) — deliberately NOT under /api/sync/* (that surface is machine-cred + skips the
  // user auth gate). The client secret is returned ONCE in the enroll/rotate response body (over
  // HTTPS); no GET ever returns it and it is never written to the audit log.
  // ------------------------------------------------------------------
  app.post('/api/settings/sync/enroll', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const body = (req.body ?? {}) as { siteId?: string; name?: string | null; centralUrl?: string };
    if (!body.siteId) { reply.code(400); return { error: 'siteId required' }; }
    if (!body.centralUrl) { reply.code(400); return { error: 'centralUrl required' }; }
    // Wrap ONLY the orchestrator + error→status mapping in the try. Audit runs after the try
    // succeeds so an audit failure can never turn a completed enrollment into a 500 — that would
    // lose the one-time client secret to the caller and a retry would hit AlreadyEnrolledError.
    let r;
    try {
      r = await enrollSite(ctx, {
        siteId: body.siteId,
        name: body.name || null,
        centralUrl: body.centralUrl,
        actor: req.user?.id ?? null,
      });
    } catch (e) {
      switch (errName(e)) {
        case 'AlreadyEnrolledError': reply.code(409); return { error: e instanceof Error ? e.message : 'already enrolled' };
        case 'InvalidSiteIdError': reply.code(400); return { error: e instanceof Error ? e.message : 'invalid site id' };
        case 'MissingCentralUrlError': reply.code(400); return { error: 'centralUrl required' };
        case 'IdentityAdminNotConfiguredError': reply.code(503); return { error: 'identity provider admin client is not configured' };
        default: throw e;
      }
    }
    await recordAudit(ctx, req, {
      action: 'settings.sync.enroll', entityType: 'sync_site', entityId: body.siteId,
      metadata: { clientId: r.clientId },
    });
    return r;
  });

  app.get('/api/settings/sync/sites', { preHandler: requireRole('lab_admin') }, async () => listSites(ctx));

  app.post('/api/settings/sync/sites/:siteId/rotate', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const { siteId } = req.params as { siteId: string };
    // Audit after the try (see enroll) so an audit failure never masks a successful rotation and
    // loses the one-time regenerated secret.
    let r;
    try {
      r = await rotateSite(ctx, siteId);
    } catch (e) {
      switch (errName(e)) {
        case 'SiteNotFoundError': reply.code(404); return { error: e instanceof Error ? e.message : 'site not found' };
        case 'IdentityAdminNotConfiguredError': reply.code(503); return { error: 'identity provider admin client is not configured' };
        default: throw e;
      }
    }
    await recordAudit(ctx, req, {
      action: 'settings.sync.rotate', entityType: 'sync_site', entityId: siteId,
      metadata: { clientId: r.clientId },
    });
    return r;
  });

  app.post('/api/settings/sync/sites/:siteId/revoke', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const { siteId } = req.params as { siteId: string };
    try {
      await revokeSite(ctx, siteId);
    } catch (e) {
      if (errName(e) === 'IdentityAdminNotConfiguredError') { reply.code(503); return { error: 'identity provider admin client is not configured' }; }
      throw e;
    }
    await recordAudit(ctx, req, { action: 'settings.sync.revoke', entityType: 'sync_site', entityId: siteId, metadata: {} });
    return { revoked: true };
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
