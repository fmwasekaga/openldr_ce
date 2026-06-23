import { basename } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { CE_VERSION } from '@openldr/bootstrap';
import {
  verifyBundle, readGrant, isCompatible,
  LocalRegistrySource, HttpRegistrySource, type RegistrySource, type Capability,
} from '@openldr/marketplace';
import { requireRole } from './rbac';

function actor(req: FastifyRequest): { id?: string | null; name: string } {
  return { id: req.user?.id ?? null, name: req.user?.username ?? 'unknown' };
}

// A registry `ref` must be a single safe path segment — no traversal, no separators.
function safeRef(ref: unknown): string | null {
  if (typeof ref !== 'string' || ref.length === 0) return null;
  if (ref.includes('/') || ref.includes('\\') || ref.includes('..')) return null;
  if (basename(ref) !== ref) return null;
  return ref;
}

export function registerMarketplaceRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const source: RegistrySource | null =
    ctx.cfg.MARKETPLACE_REGISTRY_URL ? new HttpRegistrySource(ctx.cfg.MARKETPLACE_REGISTRY_URL)
    : ctx.cfg.MARKETPLACE_REGISTRY_DIR ? new LocalRegistrySource(ctx.cfg.MARKETPLACE_REGISTRY_DIR)
    : null;

  app.get('/api/marketplace/installed', { preHandler: requireRole('lab_admin') }, async () => {
    const rows = await ctx.plugins.list();
    return rows.map((r) => {
      const g = readGrant(r.manifest);
      const m = r.manifest as Record<string, unknown>;
      return {
        id: r.id,
        version: r.version,
        active: r.active,
        enabled: r.enabled,
        approvedBy: r.approvedBy,
        type: (m.type as string) ?? 'plugin',
        publisher: (m.publisher as unknown) ?? null,
        capabilities: g.legacy ? [] : g.capabilities,
        legacy: g.legacy,
      };
    });
  });

  app.get('/api/marketplace/available', { preHandler: requireRole('lab_admin') }, async () => {
    if (!source) return { configured: false, bundles: [], source: null, host: null };
    try {
      const listing = await source.list();
      return {
        configured: true,
        source: source.kind,
        host: source.label,
        bundles: listing.map((l) => ({
          ref: l.ref, id: l.id, version: l.version, type: l.type,
          publisher: l.publisher, description: l.description, license: l.license,
          summary: l.summary, signatureFingerprint: l.signatureFingerprint,
          valid: l.valid,
        })),
      };
    } catch (e) {
      return { configured: true, source: source.kind, host: source.label, bundles: [], error: e instanceof Error ? e.message : 'registry unreachable' };
    }
  });

  app.get('/api/marketplace/available/:ref', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    if (!source) { reply.code(400); return { error: 'no marketplace registry configured' }; }
    const ref = safeRef((req.params as { ref: string }).ref);
    if (!ref) { reply.code(400); return { error: 'invalid bundle ref' }; }
    try {
      const b = await source.getBundle(ref);
      const v = verifyBundle(b);
      return {
        ref, id: b.manifest.id, version: b.manifest.version, type: b.manifest.type,
        description: b.manifest.description, license: b.manifest.license,
        publisher: b.manifest.publisher ?? null, capabilities: b.manifest.capabilities,
        compatibility: b.manifest.compatibility,
        compatible: isCompatible(b.manifest.compatibility.ceVersion, CE_VERSION),
        ceVersion: CE_VERSION, payload: b.manifest.payload, valid: v.valid,
      };
    } catch {
      reply.code(404);
      return { error: 'bundle not found' };
    }
  });

  app.post('/api/marketplace/install', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    if (!source) { reply.code(400); return { error: 'no marketplace registry configured' }; }
    const body = (req.body ?? {}) as { ref?: unknown; acknowledgedCapabilities?: unknown };
    const ref = safeRef(body.ref);
    if (!ref) { reply.code(400); return { error: 'invalid bundle ref' }; }
    if (body.acknowledgedCapabilities !== undefined && !Array.isArray(body.acknowledgedCapabilities)) {
      reply.code(400); return { error: 'acknowledgedCapabilities must be an array' };
    }
    try {
      const b = await source.getBundle(ref);
      const a = actor(req);
      const acknowledgedCapabilities = (body.acknowledgedCapabilities as Capability[] | undefined) ?? b.manifest.capabilities;
      const installed = await ctx.plugins.install(b.wasm, b.raw, {
        publicKeyDer: b.publicKeyDer, actor: a,
        approval: { approvedBy: a.id ?? a.name, acknowledgedCapabilities },
      });
      return { id: installed.id, version: installed.version };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post('/api/marketplace/refresh', { preHandler: requireRole('lab_admin') }, async () => {
    source?.refresh();
    return { ok: true };
  });

  app.post('/api/marketplace/:id/enable', { preHandler: requireRole('lab_admin') }, async (req) => {
    await ctx.plugins.setEnabled((req.params as { id: string }).id, true, { actor: actor(req) });
    return { ok: true };
  });

  app.post('/api/marketplace/:id/disable', { preHandler: requireRole('lab_admin') }, async (req) => {
    await ctx.plugins.setEnabled((req.params as { id: string }).id, false, { actor: actor(req) });
    return { ok: true };
  });

  app.post('/api/marketplace/:id/rollback', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const version = (req.body as { version?: string } | undefined)?.version;
    if (!version) {
      reply.code(400);
      return { error: 'version is required' };
    }
    try {
      await ctx.plugins.rollback(id, version, { actor: actor(req) });
      return { ok: true };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.delete('/api/marketplace/:id', { preHandler: requireRole('lab_admin') }, async (req) => {
    const { id } = req.params as { id: string };
    const version = (req.query as { version?: string } | undefined)?.version;
    await ctx.plugins.remove(id, version, { actor: actor(req) });
    return { ok: true };
  });
}
