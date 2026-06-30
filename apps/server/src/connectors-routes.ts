import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '@openldr/bootstrap';
import { createPluginTarget, createConnectorDb } from '@openldr/bootstrap';
import type { ConnectorStore } from '@openldr/db';
import { redact } from '@openldr/core';
import { requireRole } from './rbac';
import { recordAudit } from './audit-helper';

export interface ConnectorsRouteDeps {
  connectors: ConnectorStore;
}

const createInput = z.object({
  name: z.string().min(1),
  pluginId: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  config: z.record(z.string()),
  allowedHost: z.string().optional(),
}).refine((v) => Boolean(v.pluginId) !== Boolean(v.type), { message: 'exactly one of pluginId or type is required' });
const updateInput = z.object({
  name: z.string().min(1).optional(),
  config: z.record(z.string()).optional(),
  allowedHost: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

/** Validate a connector baseUrl, IF PRESENT. Throws a clear error when it is unparseable,
 *  uses a non-http(s) scheme, or carries userinfo (credentials must not live in the URL).
 *  Private/loopback hosts and arbitrary ports are intentionally ALLOWED — on-prem/localhost
 *  DHIS2 servers are legitimate connector targets, so this is input-validation correctness,
 *  not SSRF IP-range blocking. Exported for tests. */
export function validateConnectorBaseUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('invalid connector baseUrl');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('invalid connector baseUrl: scheme must be http or https');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('invalid connector baseUrl: must not contain userinfo (credentials)');
  }
  return url;
}

/** Derive the egress host to pin from the connection config's baseUrl (an explicit
 *  allowedHost wins). Returns null when neither yields a host (egress stays default-deny). */
function hostFor(config: Record<string, string> | undefined, explicit: string | null | undefined): string | null {
  if (explicit !== undefined) return explicit && explicit.length > 0 ? explicit : null;
  const base = config?.baseUrl;
  if (!base) return null;
  try {
    return new URL(base).hostname || null;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerConnectorsRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext, deps: ConnectorsRouteDeps): void {
  const { connectors } = deps;
  const key = (): string | undefined => ctx.cfg.SECRETS_ENCRYPTION_KEY;

  // Installed sink plugins, for the "pick a plugin" dropdown.
  app.get('/api/connectors/sink-plugins', { preHandler: requireRole('lab_admin') }, async () => {
    const rows = await ctx.plugins.list();
    return rows
      .filter((r) => {
        const m = r.manifest as { kind?: string; payload?: { pluginKind?: string } };
        return m.kind === 'sink' || m.payload?.pluginKind === 'sink';
      })
      .map((r) => ({ id: r.id, version: r.version, enabled: r.enabled }));
  });

  app.get('/api/connectors', { preHandler: requireRole('lab_admin') }, async () => connectors.list());

  app.get('/api/connectors/:id', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await connectors.get(id);
    if (!c) { reply.code(404); return { error: 'connector not found' }; }
    return c;
  });

  app.post('/api/connectors', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const parsed = createInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: 'invalid connector input' }; }
    const { name, pluginId, type, config, allowedHost } = parsed.data;
    const id = randomUUID();
    if (type) {
      // Host (database) connector — no plugin, no baseUrl validation, no egress pin.
      try {
        await connectors.create({ id, name, type, kind: 'database', config }, key());
      } catch (e) {
        reply.code(400);
        return { error: redact(e instanceof Error ? e.message : String(e)) };
      }
      await recordAudit(ctx, req, {
        action: 'connector.create', entityType: 'connector', entityId: id,
        metadata: { name, type, configKeys: Object.keys(config) },
      });
      return connectors.get(id);
    }
    // Plugin (sink) connector path — pluginId is guaranteed by the XOR refine.
    if (config?.baseUrl !== undefined) {
      try { validateConnectorBaseUrl(config.baseUrl); }
      catch (e) { reply.code(400); return { error: redact(e instanceof Error ? e.message : 'invalid connector baseUrl') }; }
    }
    const pinnedHost = hostFor(config, allowedHost);
    try {
      await connectors.create({ id, name, pluginId: pluginId!, kind: 'sink', config, allowedHost: pinnedHost }, key());
    } catch (e) {
      reply.code(400);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
    // Audit: a connector binds an egress host + (encrypted) credentials. Record metadata only —
    // never the config values (secrets).
    await recordAudit(ctx, req, {
      action: 'connector.create', entityType: 'connector', entityId: id,
      metadata: { name, pluginId: pluginId!, allowedHost: pinnedHost, configKeys: Object.keys(config) },
    });
    return connectors.get(id);
  });

  app.put('/api/connectors/:id', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateInput.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: 'invalid connector patch' }; }
    if (!(await connectors.get(id))) { reply.code(404); return { error: 'connector not found' }; }
    const patch = parsed.data;
    if (patch.config?.baseUrl !== undefined) {
      try { validateConnectorBaseUrl(patch.config.baseUrl); }
      catch (e) { reply.code(400); return { error: redact(e instanceof Error ? e.message : 'invalid connector baseUrl') }; }
    }
    // Re-derive the pinned host when the config (baseUrl) changes, unless explicitly given.
    const allowedHost = patch.config !== undefined ? hostFor(patch.config, patch.allowedHost) : patch.allowedHost;
    try {
      await connectors.update(id, { name: patch.name, config: patch.config, enabled: patch.enabled, allowedHost }, key());
    } catch (e) {
      reply.code(400);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
    // Audit: record which fields changed (and whether secrets were rotated) — never the values.
    await recordAudit(ctx, req, {
      action: 'connector.update', entityType: 'connector', entityId: id,
      metadata: {
        fields: Object.keys(patch),
        secretsRotated: patch.config !== undefined,
        ...(allowedHost !== undefined ? { allowedHost } : {}),
      },
    });
    return connectors.get(id);
  });

  app.delete('/api/connectors/:id', { preHandler: requireRole('lab_admin') }, async (req) => {
    const { id } = req.params as { id: string };
    const existing = await connectors.get(id);
    await connectors.remove(id);
    await recordAudit(ctx, req, {
      action: 'connector.delete', entityType: 'connector', entityId: id,
      metadata: { name: existing?.name, pluginId: existing?.pluginId },
    });
    return { ok: true };
  });

  // Live connection test: resolve → loadSink → health_check + pull_metadata (restricted to allowedHost).
  app.post('/api/connectors/:id/test', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const connector = await connectors.get(id);
    if (!connector) { reply.code(404); return { error: 'connector not found' }; }
    // Audit the live test as a security event: it decrypts the stored credentials and makes a
    // live outbound connection. Record outcome (never the secrets/metadata body).
    const auditTest = (outcome: 'ok' | 'failed', detail?: string): Promise<void> =>
      recordAudit(ctx, req, {
        action: 'connector.test', entityType: 'connector', entityId: id,
        metadata: { outcome, pluginId: connector.pluginId, host: connector.allowedHost, ...(detail ? { detail } : {}) },
      });
    // Host (database) connector — run a SELECT 1 to verify connectivity.
    if (connector.type) {
      try {
        const config = await connectors.getDecryptedConfig(id, key());
        const conn = createConnectorDb(connector.type, config);
        try { await conn.query('select 1'); } finally { await conn.close(); }
        await auditTest('ok');
        return { ok: true };
      } catch (e) {
        await auditTest('failed', 'error');
        return { ok: false, error: redact(e instanceof Error ? e.message : String(e)) };
      }
    }
    try {
      const config = await connectors.getDecryptedConfig(id, key());
      const sink = await ctx.plugins.loadSink(connector.pluginId!);
      if (!sink) { await auditTest('failed', 'sink not installed'); return { ok: false, error: `sink plugin '${connector.pluginId}' is not installed` }; }
      const target = createPluginTarget(sink, config, connector.allowedHost);
      const health = await target.healthCheck();
      if (health.status !== 'up') { await auditTest('failed', 'unreachable'); return { ok: false, error: redact(health.detail ?? 'unreachable') }; }
      const md = await target.pullMetadata();
      await auditTest('ok');
      return {
        ok: true,
        metadata: {
          dataElements: md.dataElements.length,
          orgUnits: md.orgUnits.length,
          categoryOptionCombos: md.categoryOptionCombos.length,
          programs: md.programs?.length ?? 0,
          programStages: md.programStages?.length ?? 0,
        },
      };
    } catch (e) {
      await auditTest('failed', 'error');
      return { ok: false, error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });
}
