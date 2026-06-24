import { basename, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { CE_VERSION } from '@openldr/bootstrap';
import {
  verifyBundle, readGrant, isCompatible, readBundle,
  LocalRegistrySource, HttpRegistrySource, type RegistrySource, type Capability,
  openBundlePr, fetchRepoIndexJson, repoPathExists, mergeIndexEntry, parseIndex,
  payloadFileName, type RepoCoords, PublishError,
} from '@openldr/marketplace';
import { redact } from '@openldr/core';
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

export function registerMarketplaceRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext, fetchImpl: typeof fetch = fetch): void {
  const source: RegistrySource | null =
    ctx.cfg.MARKETPLACE_REGISTRY_URL ? new HttpRegistrySource(ctx.cfg.MARKETPLACE_REGISTRY_URL)
    : ctx.cfg.MARKETPLACE_REGISTRY_DIR ? new LocalRegistrySource(ctx.cfg.MARKETPLACE_REGISTRY_DIR)
    : null;

  const stagingDir = ctx.cfg.MARKETPLACE_REGISTRY_DIR ?? null;
  const publishRepoCfg = ctx.cfg.MARKETPLACE_PUBLISH_REPO ?? null;
  const publishToken = ctx.cfg.MARKETPLACE_PUBLISH_TOKEN ?? null;
  const publishBranch = ctx.cfg.MARKETPLACE_PUBLISH_BRANCH ?? 'main';
  const publishConfigured = Boolean(publishToken && publishRepoCfg && stagingDir);

  app.get('/api/marketplace/installed', { preHandler: requireRole('lab_admin') }, async () => {
    const rows = await ctx.plugins.list();
    const pluginRows = rows.map((r) => {
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
    const formRows = (await ctx.marketplaceForms.list()).map((r) => ({
      id: r.artifactId, version: r.version, active: true, enabled: true,
      approvedBy: r.installedBy ?? null, type: 'form-template',
      publisher: r.publisherName ? { name: r.publisherName } : null,
      capabilities: [], legacy: false, drifted: r.drifted, targetFormId: r.targetFormId,
    }));
    return [...pluginRows, ...formRows];
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
          valid: l.valid, versions: l.versions ?? [],
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
        description: b.manifest.description, readme: b.manifest.readme, license: b.manifest.license,
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
      if (b.manifest.type === 'form-template') {
        const installed = await ctx.marketplaceForms.install(b, {
          actor: a, sourceRef: ref,
          approval: { approvedBy: a.id ?? a.name, acknowledgedCapabilities },
        });
        return { id: installed.id, version: installed.version };
      }
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

  app.get('/api/marketplace/publish/status', { preHandler: requireRole('lab_admin') }, async () => {
    return { configured: publishConfigured, repo: publishConfigured ? publishRepoCfg : null };
  });

  app.post('/api/marketplace/publish', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    if (!publishConfigured || !stagingDir || !publishRepoCfg || !publishToken) {
      reply.code(412);
      return { error: 'publishing not configured' };
    }
    const ref = safeRef((req.body as { ref?: unknown } | undefined)?.ref);
    if (!ref) { reply.code(400); return { error: 'invalid bundle ref' }; }

    const [owner, repo] = publishRepoCfg.split('/');
    if (!owner || !repo) { reply.code(500); return { error: 'MARKETPLACE_PUBLISH_REPO must be owner/repo' }; }
    const coords: RepoCoords = { owner, repo, baseBranch: publishBranch, token: publishToken };

    try {
      const dir = join(stagingDir, ref);
      const b = await readBundle(dir);
      const v = verifyBundle(b);
      if (!v.valid) { reply.code(400); return { error: 'bundle failed verification — refusing to publish' }; }

      const id = b.manifest.id;
      const version = b.manifest.version;
      const bundlePath = `bundles/${id}-${version}`;

      if (await repoPathExists(coords, bundlePath, fetchImpl)) {
        reply.code(409);
        return { error: `v${version} of ${id} is already published — bump the version` };
      }

      const payloadName = payloadFileName(String((b.raw.payload as { kind?: string } | null)?.kind ?? 'plugin'));
      const files = [
        { path: `${bundlePath}/manifest.json`, bytes: new Uint8Array(await readFile(join(dir, 'manifest.json'))) },
        { path: `${bundlePath}/${payloadName}`, bytes: new Uint8Array(await readFile(join(dir, payloadName))) },
        { path: `${bundlePath}/publisher.pub`, bytes: new Uint8Array(await readFile(join(dir, 'publisher.pub'))) },
      ];

      const current = (await fetchRepoIndexJson(coords, fetchImpl)) ?? parseIndex(null);
      const nowIso = new Date().toISOString();
      const nextIndex = mergeIndexEntry(current, {
        id, kind: b.manifest.type, latestVersion: version,
        publisher: b.manifest.publisher?.name ?? '',
        summary: b.manifest.description ?? '',
        readme: b.manifest.readme ?? '',
        path: bundlePath, signatureFingerprint: v.fingerprint,
      }, nowIso);

      const result = await openBundlePr({
        ...coords, files, indexJson: JSON.stringify(nextIndex, null, 2),
        branchName: `publish/${id}-${version}`,
        prTitle: `Publish ${id} ${version}`,
        prBody: `Adds \`${bundlePath}\` and updates \`index.json\`.\n\n_Opened from OpenLDR CE._`,
      }, fetchImpl);

      const a = actor(req);
      try {
        await ctx.audit.record({
          actorType: 'user', actorId: a.id ?? null, actorName: a.name,
          action: 'marketplace.publish', entityType: 'marketplace.artifact', entityId: `${id}@${version}`,
          metadata: { prUrl: result.prUrl, prNumber: result.prNumber, repo: publishRepoCfg },
        });
      } catch { /* audit must not break the publish */ }

      return result;
    } catch (err) {
      if (err instanceof PublishError) {
        const status = err.kind === 'version-exists' ? 409 : err.kind === 'no-token' ? 412 : 502;
        reply.code(status);
        return { error: redact(err.message) };
      }
      reply.code(400);
      return { error: redact(err instanceof Error ? err.message : String(err)) };
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

  app.post('/api/marketplace/:id/detach', { preHandler: requireRole('lab_admin') }, async (req) => {
    await ctx.marketplaceForms.detach((req.params as { id: string }).id, { actor: actor(req) });
    return { ok: true };
  });

  app.delete('/api/marketplace/:id', { preHandler: requireRole('lab_admin') }, async (req) => {
    const { id } = req.params as { id: string };
    const version = (req.query as { version?: string } | undefined)?.version;
    await ctx.plugins.remove(id, version, { actor: actor(req) });
    return { ok: true };
  });
}
