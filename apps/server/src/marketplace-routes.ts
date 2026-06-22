import { readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { readBundle, verifyBundle, readGrant, type Capability } from '@openldr/marketplace';
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
  const registryDir = ctx.cfg.MARKETPLACE_REGISTRY_DIR;

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
    if (!registryDir) return { configured: false, bundles: [] };
    let dirs: string[];
    try {
      dirs = (await readdir(registryDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return { configured: true, bundles: [], error: 'registry directory not readable' };
    }
    const bundles = [];
    for (const ref of dirs) {
      try {
        const b = await readBundle(join(registryDir, ref));
        const v = verifyBundle(b);
        bundles.push({
          ref,
          id: b.manifest.id,
          version: b.manifest.version,
          type: b.manifest.type,
          publisher: b.manifest.publisher ?? null,
          capabilities: b.manifest.capabilities,
          compatibility: b.manifest.compatibility,
          valid: v.valid,
        });
      } catch {
        // Not a readable bundle directory — skip it.
      }
    }
    return { configured: true, bundles };
  });

  app.post('/api/marketplace/install', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    if (!registryDir) {
      reply.code(400);
      return { error: 'no marketplace registry configured' };
    }
    const body = (req.body ?? {}) as { ref?: unknown; acknowledgedCapabilities?: unknown };
    const ref = safeRef(body.ref);
    if (!ref) {
      reply.code(400);
      return { error: 'invalid bundle ref' };
    }
    if (body.acknowledgedCapabilities !== undefined && !Array.isArray(body.acknowledgedCapabilities)) {
      reply.code(400);
      return { error: 'acknowledgedCapabilities must be an array' };
    }
    try {
      const b = await readBundle(join(registryDir, ref));
      const a = actor(req);
      // Default to the bundle's declared capabilities when the caller omits an explicit
      // acknowledgement; the runtime's consent check (SP-2) still rejects a mismatch.
      const acknowledgedCapabilities = (body.acknowledgedCapabilities as Capability[] | undefined) ?? b.manifest.capabilities;
      const installed = await ctx.plugins.install(b.wasm, b.raw, {
        publicKeyDer: b.publicKeyDer,
        actor: a,
        approval: { approvedBy: a.id ?? a.name, acknowledgedCapabilities },
      });
      return { id: installed.id, version: installed.version };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
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
