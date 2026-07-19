import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import type { AppContext } from '@openldr/bootstrap';
import { dangerResetDashboards, dangerFactoryReset, dangerClearAudit, getSyncConfig, setSyncConfig, enrollSite, listSites, rotateSite, revokeSite, mergePatients } from '@openldr/bootstrap';
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
    // Apply the new config to the live workers so enable/disable/reconfigure takes effect without a
    // restart. Best-effort: a reconcile failure must not fail the save (the config IS persisted; the
    // next boot / next save reconciles). Logged for visibility.
    try { await ctx.syncRuntime.reconcile(); }
    catch (err) { ctx.logger.warn({ err }, 'sync: reconcile after settings save failed'); }
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

  // Sync S7-A: list quarantined poison-bulk records (lab_admin, user-authed).
  app.get('/api/settings/sync/quarantine', { preHandler: requireRole('lab_admin') }, async () => ctx.sync.listQuarantine());

  // Sync S7-A: manually retry a quarantined bulk entity — clears + re-syncs it by url.
  app.post('/api/settings/sync/quarantine/retry', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const b = (req.body ?? {}) as { entityType?: unknown; entityId?: unknown };
    if (typeof b.entityType !== 'string' || !b.entityType || typeof b.entityId !== 'string' || !b.entityId) {
      return reply.code(400).send({ error: 'entityType and entityId are required' });
    }
    const result = await ctx.sync.retryQuarantine(b.entityType, b.entityId);
    await recordAudit(ctx, req, { action: 'settings.sync.quarantine.retry', entityType: b.entityType, entityId: b.entityId, metadata: { ok: result.ok } });
    // The `return` on each send is load-bearing, not style — see the comment block in sync-routes.ts.
    // With compression registered globally, a bare `reply.send(x)` in an async handler resolves to
    // undefined before an async (gzipped) send has written, so Fastify re-sends undefined and clobbers
    // the body. These payloads are under the 1KB threshold today, but that's an assumption that drifts.
    if (!result.ok && (result.error ?? '').includes('not enabled')) return reply.code(409).send(result);
    return reply.code(200).send(result);
  });

  // Sync S7: same-version divergence — applyRemote found a history row at this version whose content
  // DIFFERS from the incoming record, kept the local copy, and recorded what it dropped. Detect-and-
  // surface only: an operator inspects, decides, and (if central should win) re-authors at max+1 via
  // POST /api/settings/sync/amend, then clears. lab_admin + user-authed, deliberately NOT under
  // /api/sync/* (that surface is machine-cred).
  //
  // LIST is PHI-FREE (the store does not select incoming_body). This is the surface a UI lands on;
  // reading the dropped result content requires the explicit detail call below, which is audited.
  app.get('/api/settings/sync/divergences', { preHandler: requireRole('lab_admin') }, async () =>
    ctx.sync.listDivergences(),
  );

  // DETAIL returns incomingBody = the dropped content = PHI. Audited for that reason, even though the
  // audit row itself carries only the key.
  app.get('/api/settings/sync/divergences/:resourceType/:resourceId/:version', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = req.params as { resourceType: string; resourceId: string; version: string };
    const version = Number(p.version);
    if (!Number.isInteger(version) || version < 1) {
      return reply.code(400).send({ error: 'version must be a positive integer' });
    }
    const row = await ctx.sync.getDivergence(p.resourceType, p.resourceId, version);
    if (!row) return reply.code(404).send({ error: 'divergence not found' });
    await recordAudit(ctx, req, {
      action: 'settings.sync.divergence.view',
      entityType: p.resourceType,
      entityId: p.resourceId,
      metadata: { version },
    });
    // The `return` on each send is load-bearing, not style — see the comment block in sync-routes.ts.
    // This payload carries a full FHIR body and WILL cross the 1KB compress threshold.
    return reply.code(200).send(row);
  });

  // Clearing is the ONLY lifecycle a divergence has (spec decision 3): nothing auto-resolves it. A
  // later higher version arriving would tell you the disagreement ENDED, not that the RIGHT content
  // won — auto-closing on that would reintroduce the silent loss this slice exists to eliminate.
  app.post('/api/settings/sync/divergences/:resourceType/:resourceId/:version/clear', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = req.params as { resourceType: string; resourceId: string; version: string };
    const version = Number(p.version);
    if (!Number.isInteger(version) || version < 1) {
      return reply.code(400).send({ error: 'version must be a positive integer' });
    }
    // 404 rather than a silent success: a double-clear should tell the operator the row is already gone.
    const row = await ctx.sync.getDivergence(p.resourceType, p.resourceId, version);
    if (!row) return reply.code(404).send({ error: 'divergence not found' });

    await ctx.sync.clearDivergence(p.resourceType, p.resourceId, version);
    // Audit AFTER the clear commits (S4d precedent): a recordAudit throw must not fail an operation
    // that already succeeded. PHI-free — the key only, never the body we just discarded.
    await recordAudit(ctx, req, {
      action: 'settings.sync.divergence.clear',
      entityType: p.resourceType,
      entityId: p.resourceId,
      metadata: { version },
    });
    return reply.code(204).send();
  });

  // POST /api/settings/sync/amend — a central operator amends a lab-owned result (Sync S6a). User-authed
  // + lab_admin (this is a central-side authoring action), deliberately NOT under /api/sync/* (that
  // surface is machine-cred). fhirStore.amend does the transactional version-bump + Provenance + outbox
  // write, keeping the owning lab's site_id; the amendment then flows down that lab's pull-amendments
  // stream. Audited SECRET/PHI-free: resource reference + new version only.
  app.post('/api/settings/sync/amend', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const b = (req.body ?? {}) as { resourceType?: unknown; id?: unknown; status?: unknown; reason?: unknown; patch?: unknown; agent?: unknown; activity?: unknown };
    if (typeof b.resourceType !== 'string' || !b.resourceType || typeof b.id !== 'string' || !b.id || typeof b.status !== 'string' || !b.status) {
      return reply.code(400).send({ error: 'resourceType, id and status are required' });
    }
    try {
      const result = await ctx.fhirStore.amend({
        resourceType: b.resourceType,
        id: b.id,
        status: b.status,
        reason: typeof b.reason === 'string' ? b.reason : undefined,
        patch: b.patch && typeof b.patch === 'object' ? (b.patch as Record<string, unknown>) : undefined,
        agent: typeof b.agent === 'string' && b.agent ? b.agent : 'central',
        activity: typeof b.activity === 'string' && b.activity ? b.activity : undefined,
      });
      await recordAudit(ctx, req, {
        action: 'settings.sync.amend',
        entityType: b.resourceType,
        entityId: b.id,
        metadata: { version: result.version, provenanceId: result.provenanceId, siteId: result.siteId, activity: typeof b.activity === 'string' && b.activity ? b.activity : 'amend' },
      });
      return reply.code(200).send(result); // `return` is load-bearing — see sync-routes.ts's comment block
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'ResourceNotFoundError') return reply.code(404).send({ error: 'resource not found' });
      if (name === 'NotLabOwnedError') return reply.code(409).send({ error: 'resource is not lab-owned' });
      if (name === 'UnsupportedResourceTypeError') return reply.code(400).send({ error: 'resource type is not amendable' });
      throw e; // unknown → 500 via the global handler
    }
  });

  // POST /api/settings/sync/merge-patient — intra-lab patient merge (Sync S6b). lab_admin, user-authed.
  // Delegates to the bootstrap orchestrator (enumerate refs + atomic cascade); the merge then flows down
  // the owning lab's amendment stream. Audited PHI-free: patient ids + counts only.
  app.post('/api/settings/sync/merge-patient', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const b = (req.body ?? {}) as { survivorId?: unknown; duplicateId?: unknown; reason?: unknown; agent?: unknown };
    if (typeof b.survivorId !== 'string' || !b.survivorId || typeof b.duplicateId !== 'string' || !b.duplicateId) {
      return reply.code(400).send({ error: 'survivorId and duplicateId are required' });
    }
    try {
      const result = await mergePatients(ctx, {
        survivorId: b.survivorId, duplicateId: b.duplicateId,
        reason: typeof b.reason === 'string' ? b.reason : undefined,
        agent: typeof b.agent === 'string' && b.agent ? b.agent : 'central',
      });
      await recordAudit(ctx, req, {
        action: 'settings.sync.merge', entityType: 'Patient', entityId: b.duplicateId,
        metadata: { survivorId: result.survivorId, duplicateId: result.duplicateId, repointed: result.repointed, provenanceId: result.provenanceId },
      });
      return reply.code(200).send(result); // `return` is load-bearing — see sync-routes.ts's comment block
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'SamePatientError') return reply.code(400).send({ error: 'survivor and duplicate are the same patient' });
      if (name === 'PatientNotFoundError') return reply.code(404).send({ error: 'patient not found' });
      if (name === 'CrossSiteMergeError') return reply.code(409).send({ error: 'patients are not owned by the same site' });
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

  // Serve this server's public TLS cert (PEM) so a remote lab can trust a self-signed central. The
  // cert is public (presented in every TLS handshake) but the route is lab_admin like the rest of
  // /api/settings/*. Path = TLS_CERT_PATH (installer-mounted fullchain.pem). No AppError/appError
  // here: this file's own convention (see the divergence/enroll/danger routes above) is a plain
  // reply.code(status).send({ error }) body, not the catalog — mirrored rather than introduced.
  app.get('/api/settings/sync/central-certificate', { preHandler: requireRole('lab_admin') }, async (_req, reply) => {
    const path = ctx.cfg.TLS_CERT_PATH;
    if (!path) return reply.code(404).send({ error: 'no TLS certificate is configured (set TLS_CERT_PATH / mount the cert)' });
    let pem: string;
    try {
      pem = await readFile(path, 'utf8');
    } catch {
      return reply.code(404).send({ error: 'configured TLS certificate file was not found' });
    }
    reply.header('content-type', 'application/x-pem-file');
    reply.header('content-disposition', 'attachment; filename="central-certificate.pem"');
    // The `return` on the send is load-bearing, not style — see the comment block in sync-routes.ts:
    // with compression registered globally, a bare `reply.send(x)` in an async handler resolves to
    // undefined before an async (gzipped) send has written, so Fastify re-sends undefined and
    // clobbers the body.
    return reply.send(pem);
  });

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

  // FHIR validation strictness (Task 9) — admin-tunable gate level read by createValidationStrictness.
  // Admin-only + audited, same shape as the flags/numbers routes above.
  app.get('/api/settings/validation', { preHandler: requireRole('lab_admin') }, async () =>
    ({ strictness: await ctx.validationStrictness.get() }),
  );

  app.put('/api/settings/validation', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const body = req.body as { strictness?: string };
    const levels = ['low', 'medium', 'high'];
    if (!body?.strictness || !levels.includes(body.strictness)) {
      reply.code(400);
      return { error: 'invalid strictness' };
    }
    const before = await ctx.validationStrictness.get();
    const level = body.strictness as 'low' | 'medium' | 'high';
    await ctx.validationStrictness.set(level, req.user?.id ?? null);
    await recordAudit(ctx, req, {
      action: 'settings.validation_strictness', entityType: 'app_setting', entityId: 'validation.strictness',
      before: { strictness: before }, after: { strictness: level },
    });
    return { strictness: level };
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
