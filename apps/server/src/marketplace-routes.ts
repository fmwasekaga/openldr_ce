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
import { requireCapability } from './rbac';
import { recordAudit } from './audit-helper';

const VIEW = { preHandler: requireCapability('marketplace.view') };
const MANAGE = { preHandler: requireCapability('marketplace.manage') };

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

  const localRegistryRoot = ctx.cfg.MARKETPLACE_LOCAL_REGISTRY_ROOT ?? '';
  // Read the download cap live (Settings → General "Limits & tuning") so it can be tuned
  // without a restart.
  async function sourceFor(reg: RegistryRecord): Promise<RegistrySource> {
    const maxPayloadBytes = await ctx.numberSettings.get('marketplace.max_payload_bytes');
    return reg.kind === 'http'
      ? new HttpRegistrySource(reg.location, fetchImpl, undefined, maxPayloadBytes)
      : new LocalRegistrySource(reg.location, localRegistryRoot);
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

  app.get('/api/marketplace/installed', VIEW, async () => {
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
        // Surface the stored-manifest metadata so the Installed detail view is as rich
        // as Browse (which reads it from the registry bundle).
        description: (m.description as string) ?? null,
        license: (m.license as string) ?? null,
        payload: (m.payload as unknown) ?? null,
        capabilities: g.legacy ? [] : g.capabilities,
        legacy: g.legacy,
      };
    });
    const formRows = (await ctx.marketplaceForms.list()).map((r) => ({
      id: r.artifactId, version: r.version, active: true, enabled: true,
      approvedBy: r.installedBy ?? null, type: 'form-template',
      publisher: r.publisherName ? { name: r.publisherName } : null,
      description: null, license: null, payload: null,
      capabilities: [], legacy: false, drifted: r.drifted, targetFormId: r.targetFormId,
    }));
    return [...pluginRows, ...formRows];
  });

  app.get('/api/marketplace/available', VIEW, async () => {
    const regs = await enabledRegistries();
    if (regs.length === 0) return { configured: false, bundles: [], source: null, host: null };
    const bundles: unknown[] = [];
    let firstError: string | undefined;
    for (const reg of regs) {
      try {
        const listing = await (await sourceFor(reg)).list();
        for (const l of listing) {
          bundles.push({
            ref: packRef(reg.id, l.ref), id: l.id, version: l.version, type: l.type,
            publisher: l.publisher, description: l.description, license: l.license,
            summary: l.summary, signatureFingerprint: l.signatureFingerprint, valid: l.valid,
            ...(l.invalidReason ? { invalidReason: l.invalidReason } : {}),
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

  app.get('/api/marketplace/available/:ref', VIEW, async (req, reply) => {
    const parsed = unpackRef(decodeURIComponent((req.params as { ref: string }).ref));
    if (!parsed) { reply.code(400); return { error: 'invalid bundle ref' }; }
    const reg = await registries.get(parsed.registryId);
    if (!reg) { reply.code(404); return { error: 'registry not found' }; }
    const ref = safeRef(parsed.ref);
    if (!ref) { reply.code(400); return { error: 'invalid bundle ref' }; }
    try {
      const b = await (await sourceFor(reg)).getBundle(ref);
      const v = verifyBundle(b);
      return {
        ref: packRef(reg.id, ref), id: b.manifest.id, version: b.manifest.version, type: b.manifest.type,
        description: b.manifest.description, readme: b.manifest.readme, license: b.manifest.license,
        publisher: b.manifest.publisher ?? null, capabilities: b.manifest.capabilities,
        compatibility: b.manifest.compatibility,
        compatible: isCompatible(b.manifest.compatibility.ceVersion, CE_VERSION),
        ceVersion: CE_VERSION, payload: b.manifest.payload, valid: v.valid,
        ...(v.reason ? { invalidReason: v.reason } : {}),
        registryId: reg.id, registryName: reg.name,
      };
    } catch {
      reply.code(404);
      return { error: 'bundle not found' };
    }
  });

  // On-demand rich detail for an INSTALLED plugin, read from its stored manifest. Mirrors
  // the available/:ref detail (readme, payload, compatibility) so the Installed detail view
  // reaches parity with Browse without bloating the installed LIST with every readme.
  app.get('/api/marketplace/installed/:id', VIEW, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const row = (await ctx.plugins.list()).find((r) => r.id === id);
    if (!row) { reply.code(404); return { error: 'plugin not installed' }; }
    const m = row.manifest as Record<string, unknown>;
    const g = readGrant(row.manifest);
    const compatibility = (m.compatibility as { ceVersion: string } | undefined) ?? { ceVersion: '*' };
    return {
      id: row.id, version: row.version, type: (m.type as string) ?? 'plugin',
      description: (m.description as string) ?? null,
      readme: (m.readme as string) ?? undefined,
      license: (m.license as string) ?? null,
      publisher: (m.publisher as unknown) ?? null,
      capabilities: g.legacy ? [] : g.capabilities,
      payload: (m.payload as unknown) ?? null,
      compatibility,
      compatible: isCompatible(compatibility.ceVersion, CE_VERSION),
      ceVersion: CE_VERSION,
    };
  });

  app.post('/api/marketplace/install', MANAGE, async (req, reply) => {
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
      const b = await (await sourceFor(reg)).getBundle(ref);
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

  app.post('/api/marketplace/refresh', MANAGE, async () => {
    for (const reg of await enabledRegistries()) (await sourceFor(reg)).refresh();
    return { ok: true };
  });

  // ── Registries CRUD (DB-backed marketplace sources) ──
  const regInput = z.object({ name: z.string().min(1), kind: z.enum(['local', 'http']), location: z.string().min(1), enabled: z.boolean().optional() });
  const regPatch = z.object({ name: z.string().min(1).optional(), kind: z.enum(['local', 'http']).optional(), location: z.string().min(1).optional(), enabled: z.boolean().optional() });

  app.get('/api/marketplace/registries', VIEW, async () => registries.list());

  app.post('/api/marketplace/registries', MANAGE, async (req, reply) => {
    const p = regInput.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: 'invalid registry' }; }
    const id = randomUUID();
    await registries.create({ id, ...p.data });
    // Audit: a registry is a SOURCE of installable code — adding one is security-relevant.
    await recordAudit(ctx, req, {
      action: 'marketplace.registry.create', entityType: 'marketplace.registry', entityId: id,
      metadata: { name: p.data.name, kind: p.data.kind, location: p.data.location, enabled: p.data.enabled ?? true },
    });
    return registries.get(id);
  });

  app.put('/api/marketplace/registries/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = regPatch.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: 'invalid patch' }; }
    if (!(await registries.get(id))) { reply.code(404); return { error: 'registry not found' }; }
    await registries.update(id, p.data);
    await recordAudit(ctx, req, {
      action: 'marketplace.registry.update', entityType: 'marketplace.registry', entityId: id,
      metadata: { fields: Object.keys(p.data), ...p.data },
    });
    return registries.get(id);
  });

  app.delete('/api/marketplace/registries/:id', MANAGE, async (req) => {
    const { id } = req.params as { id: string };
    const existing = await registries.get(id);
    await registries.remove(id);
    await recordAudit(ctx, req, {
      action: 'marketplace.registry.delete', entityType: 'marketplace.registry', entityId: id,
      metadata: { name: existing?.name, kind: existing?.kind, location: existing?.location },
    });
    return { ok: true };
  });

  app.get('/api/marketplace/publish/status', VIEW, async () => {
    return { configured: publishConfigured, repo: publishConfigured ? publishRepoCfg : null };
  });

  app.post('/api/marketplace/publish', MANAGE, async (req, reply) => {
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

  app.post('/api/marketplace/:id/enable', MANAGE, async (req) => {
    await ctx.plugins.setEnabled((req.params as { id: string }).id, true, { actor: actor(req) });
    return { ok: true };
  });

  app.post('/api/marketplace/:id/disable', MANAGE, async (req) => {
    await ctx.plugins.setEnabled((req.params as { id: string }).id, false, { actor: actor(req) });
    return { ok: true };
  });

  app.post('/api/marketplace/:id/rollback', MANAGE, async (req, reply) => {
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

  app.post('/api/marketplace/:id/detach', MANAGE, async (req) => {
    await ctx.marketplaceForms.detach((req.params as { id: string }).id, { actor: actor(req) });
    return { ok: true };
  });

  app.delete('/api/marketplace/:id', MANAGE, async (req) => {
    const { id } = req.params as { id: string };
    const version = (req.query as { version?: string } | undefined)?.version;
    await ctx.plugins.remove(id, version, { actor: actor(req) });
    return { ok: true };
  });
}
