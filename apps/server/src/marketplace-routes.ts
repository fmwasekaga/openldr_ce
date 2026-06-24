import { basename, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '@openldr/bootstrap';
import { CE_VERSION } from '@openldr/bootstrap';
import {
  verifyBundle, readGrant, isCompatible, readBundle,
  LocalRegistrySource, HttpRegistrySource, type RegistrySource, type Capability,
  openBundlePr, fetchRepoIndexJson, repoPathExists, mergeIndexEntry, parseIndex,
  payloadFileName, type RepoCoords, PublishError,
} from '@openldr/marketplace';
import { createRegistryStore, type RegistryRecord } from '@openldr/db';
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
  const registries = createRegistryStore(ctx.internalDb);

  function sourceFor(reg: RegistryRecord): RegistrySource {
    return reg.kind === 'http' ? new HttpRegistrySource(reg.location, fetchImpl) : new LocalRegistrySource(reg.location);
  }
  async function enabledRegistries(): Promise<RegistryRecord[]> {
    return (await registries.list()).filter((r) => r.enabled);
  }

  // The web treats `ref` opaquely, so we encode the owning registry into the ref
  // (`<registryId>::<innerRef>`). This keeps the detail/install/version-switch flow unchanged.
  const SEP = '::';
  const packRef = (registryId: string, ref: string) => `${registryId}${SEP}${ref}`;
  function unpackRef(composite: string): { registryId: string; ref: string } | null {
    const i = composite.indexOf(SEP);
    if (i <= 0) return null;
    return { registryId: composite.slice(0, i), ref: composite.slice(i + SEP.length) };
  }

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
    const regs = await enabledRegistries();
    if (regs.length === 0) return { configured: false, bundles: [], source: null, host: null };
    const bundles: unknown[] = [];
    let firstError: string | undefined;
    for (const reg of regs) {
      try {
        const listing = await sourceFor(reg).list();
        for (const l of listing) {
          bundles.push({
            ref: packRef(reg.id, l.ref), id: l.id, version: l.version, type: l.type,
            publisher: l.publisher, description: l.description, license: l.license,
            summary: l.summary, signatureFingerprint: l.signatureFingerprint, valid: l.valid,
            registryId: reg.id, registryName: reg.name,
            versions: (l.versions ?? []).map((v) => ({ version: v.version, ref: packRef(reg.id, v.ref) })),
          });
        }
      } catch (e) {
        firstError = firstError ?? (e instanceof Error ? e.message : 'registry unreachable');
      }
    }
    return {
      configured: true,
      source: regs.length === 1 ? regs[0].kind : 'multi',
      host: regs.length === 1 ? regs[0].name : `${regs.length} registries`,
      bundles,
      ...(firstError ? { error: firstError } : {}),
    };
  });

  app.get('/api/marketplace/available/:ref', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const parsed = unpackRef(decodeURIComponent((req.params as { ref: string }).ref));
    if (!parsed) { reply.code(400); return { error: 'invalid bundle ref' }; }
    const reg = await registries.get(parsed.registryId);
    if (!reg) { reply.code(404); return { error: 'registry not found' }; }
    const ref = safeRef(parsed.ref);
    if (!ref) { reply.code(400); return { error: 'invalid bundle ref' }; }
    try {
      const b = await sourceFor(reg).getBundle(ref);
      const v = verifyBundle(b);
      return {
        ref: packRef(reg.id, ref), id: b.manifest.id, version: b.manifest.version, type: b.manifest.type,
        description: b.manifest.description, readme: b.manifest.readme, license: b.manifest.license,
        publisher: b.manifest.publisher ?? null, capabilities: b.manifest.capabilities,
        compatibility: b.manifest.compatibility,
        compatible: isCompatible(b.manifest.compatibility.ceVersion, CE_VERSION),
        ceVersion: CE_VERSION, payload: b.manifest.payload, valid: v.valid,
        registryId: reg.id, registryName: reg.name,
      };
    } catch {
      reply.code(404);
      return { error: 'bundle not found' };
    }
  });

  app.post('/api/marketplace/install', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const body = (req.body ?? {}) as { ref?: unknown; acknowledgedCapabilities?: unknown };
    const parsed = unpackRef(typeof body.ref === 'string' ? body.ref : '');
    if (!parsed) { reply.code(400); return { error: 'invalid bundle ref' }; }
    const reg = await registries.get(parsed.registryId);
    if (!reg) { reply.code(404); return { error: 'registry not found' }; }
    const ref = safeRef(parsed.ref);
    if (!ref) { reply.code(400); return { error: 'invalid bundle ref' }; }
    if (body.acknowledgedCapabilities !== undefined && !Array.isArray(body.acknowledgedCapabilities)) {
      reply.code(400); return { error: 'acknowledgedCapabilities must be an array' };
    }
    try {
      const b = await sourceFor(reg).getBundle(ref);
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
        publicKeyDer: b.publicKeyDer, actor: a, ui: b.ui,
        approval: { approvedBy: a.id ?? a.name, acknowledgedCapabilities },
      });
      return { id: installed.id, version: installed.version };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post('/api/marketplace/refresh', { preHandler: requireRole('lab_admin') }, async () => {
    for (const reg of await enabledRegistries()) sourceFor(reg).refresh();
    return { ok: true };
  });

  // ── Registries CRUD (DB-backed marketplace sources) ──
  const regInput = z.object({ name: z.string().min(1), kind: z.enum(['local', 'http']), location: z.string().min(1), enabled: z.boolean().optional() });
  const regPatch = z.object({ name: z.string().min(1).optional(), kind: z.enum(['local', 'http']).optional(), location: z.string().min(1).optional(), enabled: z.boolean().optional() });

  app.get('/api/marketplace/registries', { preHandler: requireRole('lab_admin') }, async () => registries.list());

  app.post('/api/marketplace/registries', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = regInput.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: 'invalid registry' }; }
    const id = randomUUID();
    await registries.create({ id, ...p.data });
    return registries.get(id);
  });

  app.put('/api/marketplace/registries/:id', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = regPatch.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: 'invalid patch' }; }
    if (!(await registries.get(id))) { reply.code(404); return { error: 'registry not found' }; }
    await registries.update(id, p.data);
    return registries.get(id);
  });

  app.delete('/api/marketplace/registries/:id', { preHandler: requireRole('lab_admin') }, async (req) => {
    await registries.remove((req.params as { id: string }).id);
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
