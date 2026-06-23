# Marketplace A2 — Publish (in-app GitHub PR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `lab_admin` publish a locally-staged, pre-signed bundle to the GitHub marketplace repo from the UI — the server opens a PR adding the bundle files + a merged `index.json`, using a server-side PAT.

**Architecture:** A new `github-publish.ts` in `@openldr/marketplace` wraps the GitHub REST API (plain `fetch`, injectable) — `fetchRepoIndexJson`, `repoPathExists`, and `openBundlePr` (branch→blobs→tree→commit→ref→PR). All blobs are committed base64 (uniform for binary WASM + text). The server adds `POST /api/marketplace/publish` (reads the staged bundle via the existing `readBundle`, `verifyBundle`, version-conflict guard, `mergeIndexEntry`, opens the PR, audits) and `GET /api/marketplace/publish/status`. The web adds a "Publish to GitHub" action that surfaces the PR link. Builds on A1 (merged `5b30b3d`); reuses `mergeIndexEntry`/`parseIndex`/`MarketplaceIndexEntry` shipped in A1.

**Tech Stack:** Node global `fetch`, GitHub REST API v3, Fastify, React + react-i18next + shadcn/ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-23-marketplace-a-remote-registry-design.md` (§3.3, §3.4, publish half).

---

## File Structure

- Modify: `packages/config/src/schema.ts` — `MARKETPLACE_PUBLISH_TOKEN`, `MARKETPLACE_PUBLISH_REPO`, `MARKETPLACE_PUBLISH_BRANCH`.
- Create: `packages/marketplace/src/github-publish.ts` — `PublishError`, `fetchRepoIndexJson`, `repoPathExists`, `openBundlePr`.
- Create: `packages/marketplace/src/github-publish.test.ts`.
- Modify: `packages/marketplace/src/index.ts` — export `github-publish`.
- Modify: `apps/server/src/marketplace-routes.ts` — `POST /publish`, `GET /publish/status`.
- Modify: `apps/server/src/marketplace-routes.test.ts` — publish + status tests.
- Modify: `apps/web/src/api.ts` — `getPublishStatus`, `publishArtifact`.
- Modify: `apps/web/src/pages/settings/marketplace/PackageDetail.tsx` — "Publish to GitHub" action.
- Modify: `apps/web/src/pages/settings/marketplace/MarketplaceTabs.tsx` — thread publish props.
- Modify: `apps/web/src/pages/settings/Marketplace.tsx` — publish status + handler + PR-link toast.
- Modify: `apps/web/src/pages/settings/Marketplace.test.tsx` — publish flow test.
- Modify: `apps/web/src/i18n/{en,fr,pt}.ts` — publish strings.

---

## Task 1: Config — publish keys

**Files:** Modify `packages/config/src/schema.ts`

- [ ] **Step 1: Add the keys**

In the `// Marketplace artifact security.` block (after `MARKETPLACE_REGISTRY_URL`), add:

```ts
    MARKETPLACE_PUBLISH_TOKEN: z.string().optional(),     // GitHub PAT (repo write); secret
    MARKETPLACE_PUBLISH_REPO: z.string().optional(),      // owner/repo, e.g. fmwasekaga/openldr-ce-marketplace
    MARKETPLACE_PUBLISH_BRANCH: z.string().default('main'),
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -C packages/config typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/config/src/schema.ts
git commit -m "feat(config): marketplace publish keys (token/repo/branch)"
```

---

## Task 2: `github-publish.ts` — GitHub PR helpers (TDD)

**Files:**
- Create: `packages/marketplace/src/github-publish.ts`
- Create: `packages/marketplace/src/github-publish.test.ts`
- Modify: `packages/marketplace/src/index.ts`

- [ ] **Step 1: Write the failing test — `packages/marketplace/src/github-publish.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { openBundlePr, fetchRepoIndexJson, repoPathExists, PublishError } from './github-publish';

const coords = { owner: 'o', repo: 'r', baseBranch: 'main', token: 't' };

describe('github-publish', () => {
  it('fetchRepoIndexJson returns null on 404 (seed case)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, text: async () => 'x' }) as unknown as Response);
    const idx = await fetchRepoIndexJson(coords, fetchImpl as unknown as typeof fetch);
    expect(idx).toBeNull();
  });

  it('fetchRepoIndexJson parses raw index json', async () => {
    const body = JSON.stringify({ schemaVersion: 1, name: 'M', updatedAt: 'now', packages: [] });
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => body }) as unknown as Response);
    const idx = await fetchRepoIndexJson(coords, fetchImpl as unknown as typeof fetch);
    expect(idx?.packages).toEqual([]);
  });

  it('repoPathExists is false on 404, true on 200', async () => {
    const f404 = vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response);
    expect(await repoPathExists(coords, 'bundles/x', f404 as unknown as typeof fetch)).toBe(false);
    const f200 = vi.fn(async () => ({ ok: true, status: 200 }) as unknown as Response);
    expect(await repoPathExists(coords, 'bundles/x', f200 as unknown as typeof fetch)).toBe(true);
  });

  it('openBundlePr posts base64 blobs and returns the PR url/number', async () => {
    const calls: { url: string; body: any }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: u, body });
      if (u.endsWith('/git/ref/heads/main')) return ok({ object: { sha: 'base' } });
      if (u.includes('/git/commits/base')) return ok({ tree: { sha: 'btree' } });
      if (u.endsWith('/git/blobs')) return ok({ sha: `blob-${calls.length}` });
      if (u.endsWith('/git/trees')) return ok({ sha: 'newtree' });
      if (u.endsWith('/git/commits')) return ok({ sha: 'newcommit' });
      if (u.endsWith('/git/refs')) return ok({ ref: 'refs/heads/x' });
      if (u.endsWith('/pulls')) return ok({ html_url: 'https://gh/pr/7', number: 7 });
      return { ok: false, status: 500, json: async () => ({ message: 'boom' }) } as unknown as Response;
    });
    const wasm = new Uint8Array([1, 2, 3]);
    const res = await openBundlePr({
      ...coords,
      files: [
        { path: 'bundles/demo-1/manifest.json', bytes: new TextEncoder().encode('{"a":1}') },
        { path: 'bundles/demo-1/plugin.wasm', bytes: wasm },
      ],
      indexJson: '{"schemaVersion":1}',
      branchName: 'publish/demo-1', prTitle: 'Publish demo 1', prBody: 'body',
    }, fetchImpl as unknown as typeof fetch);
    expect(res).toEqual({ prUrl: 'https://gh/pr/7', prNumber: 7 });
    // every blob create used base64 encoding
    const blobBodies = calls.filter((c) => c.url.endsWith('/git/blobs')).map((c) => c.body);
    expect(blobBodies.length).toBe(3); // 2 files + index.json
    expect(blobBodies.every((b) => b.encoding === 'base64')).toBe(true);
    // wasm blob content is the base64 of the raw bytes
    expect(blobBodies.some((b) => b.content === Buffer.from(wasm).toString('base64'))).toBe(true);
  });

  it('openBundlePr throws PublishError(network) on a failed API call', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ message: 'boom' }) }) as unknown as Response);
    await expect(openBundlePr({ ...coords, files: [], indexJson: '{}', branchName: 'b', prTitle: 't', prBody: 'b' }, fetchImpl as unknown as typeof fetch))
      .rejects.toBeInstanceOf(PublishError);
  });
});

function ok(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) } as unknown as Response;
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/marketplace test`
Expected: FAIL — `Cannot find module './github-publish'`.

- [ ] **Step 3: Implement — `packages/marketplace/src/github-publish.ts`**

```ts
import { parseIndex, type MarketplaceIndex } from './index-json';

const API = 'https://api.github.com';

export interface RepoCoords {
  owner: string;
  repo: string;
  baseBranch: string;
  token: string;
}

export class PublishError extends Error {
  constructor(public kind: 'no-token' | 'repo-unreachable' | 'version-exists' | 'network', message: string) {
    super(message);
    this.name = 'PublishError';
  }
}

function headers(token: string, raw = false): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** Fetch + parse index.json at the base branch. Returns null on 404 (first publish seeds it). */
export async function fetchRepoIndexJson(repo: RepoCoords, fetchImpl: typeof fetch = fetch): Promise<MarketplaceIndex | null> {
  const res = await fetchImpl(`${API}/repos/${repo.owner}/${repo.repo}/contents/index.json?ref=${repo.baseBranch}`, { headers: headers(repo.token, true) });
  if (res.status === 404) return null;
  if (!res.ok) throw new PublishError('repo-unreachable', `index.json: HTTP ${res.status}`);
  return parseIndex(JSON.parse(await res.text()));
}

/** True if <path> already exists on the base branch. */
export async function repoPathExists(repo: RepoCoords, path: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const res = await fetchImpl(`${API}/repos/${repo.owner}/${repo.repo}/contents/${path}?ref=${repo.baseBranch}`, { headers: headers(repo.token, true) });
  if (res.status === 404) return false;
  if (!res.ok) throw new PublishError('repo-unreachable', `${path}: HTTP ${res.status}`);
  return true;
}

export interface OpenPrArgs extends RepoCoords {
  files: { path: string; bytes: Uint8Array }[]; // bundle files (any binary/text) — all committed as base64 blobs
  indexJson: string;                            // merged index.json (utf-8)
  branchName: string;
  prTitle: string;
  prBody: string;
}

/** Create a branch with one commit (bundle files + merged index.json) and open a PR. */
export async function openBundlePr(a: OpenPrArgs, fetchImpl: typeof fetch = fetch): Promise<{ prUrl: string; prNumber: number }> {
  const base = `${API}/repos/${a.owner}/${a.repo}`;
  const gh = async (path: string, init?: RequestInit): Promise<any> => {
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { ...headers(a.token), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try { const b = await res.json(); if (b?.message) message = b.message; } catch { /* ignore */ }
      throw new PublishError(res.status === 401 || res.status === 403 || res.status === 404 ? 'repo-unreachable' : 'network', message);
    }
    return res.json();
  };

  const ref = await gh(`/git/ref/heads/${a.baseBranch}`);
  const baseSha: string = ref.object.sha;
  const baseCommit = await gh(`/git/commits/${baseSha}`);
  const baseTreeSha: string = baseCommit.tree.sha;

  const mkBlob = async (bytes: Uint8Array): Promise<string> => {
    const blob = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: Buffer.from(bytes).toString('base64'), encoding: 'base64' }) });
    return blob.sha as string;
  };

  const tree: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = [];
  for (const f of a.files) tree.push({ path: f.path, mode: '100644', type: 'blob', sha: await mkBlob(f.bytes) });
  tree.push({ path: 'index.json', mode: '100644', type: 'blob', sha: await mkBlob(new TextEncoder().encode(a.indexJson)) });

  const newTree = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: baseTreeSha, tree }) });
  const commit = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message: a.prTitle, tree: newTree.sha, parents: [baseSha] }) });
  await gh('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${a.branchName}`, sha: commit.sha }) });
  const pr = await gh('/pulls', { method: 'POST', body: JSON.stringify({ title: a.prTitle, head: a.branchName, base: a.baseBranch, body: a.prBody }) });
  return { prUrl: pr.html_url as string, prNumber: pr.number as number };
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/marketplace/src/index.ts` add:

```ts
export * from './github-publish';
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm -C packages/marketplace test`
Expected: PASS (github-publish tests + all prior).

- [ ] **Step 6: Commit**

```bash
git add packages/marketplace/src/github-publish.ts packages/marketplace/src/github-publish.test.ts packages/marketplace/src/index.ts
git commit -m "feat(marketplace): github-publish (openBundlePr base64 + fetchRepoIndexJson + repoPathExists)"
```

---

## Task 3: Server — `POST /publish` + `GET /publish/status` (TDD)

**Files:**
- Modify: `apps/server/src/marketplace-routes.ts`
- Modify: `apps/server/src/marketplace-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/marketplace-routes.test.ts`, add a mock for the github layer and tests. The publish route must use the injectable `fetch`; we test by pointing `MARKETPLACE_PUBLISH_*` at a fake and stubbing global `fetch`. To keep it deterministic, the route reads the staged bundle from `MARKETPLACE_REGISTRY_DIR` (the `demo-1` bundle the suite already builds) and calls the github layer. Add:

```ts
  it('publish/status reports configured=false when unset', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime);
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/publish/status' });
    expect(res.json()).toEqual({ configured: false, repo: null });
  });

  it('publish/status reports configured=true when token+repo set', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir, MARKETPLACE_PUBLISH_TOKEN: 't', MARKETPLACE_PUBLISH_REPO: 'o/r' }, runtime);
    const res = await app.inject({ method: 'GET', url: '/api/marketplace/publish/status' });
    expect(res.json()).toEqual({ configured: true, repo: 'o/r' });
  });

  it('publish returns 412 when not configured', async () => {
    const { runtime } = fakePlugins();
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir }, runtime);
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/publish', payload: { ref: 'demo-1' } });
    expect(res.statusCode).toBe(412);
  });

  it('publish opens a PR for a staged bundle', async () => {
    const { runtime } = fakePlugins();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const ok = (j: unknown) => ({ ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) }) as unknown as Response;
      if (u.includes('/contents/index.json')) return { ok: false, status: 404, text: async () => 'x' } as unknown as Response; // seed
      if (u.includes('/contents/bundles/')) return { ok: false, status: 404 } as unknown as Response; // no conflict
      if (u.endsWith('/git/ref/heads/main')) return ok({ object: { sha: 'base' } });
      if (u.includes('/git/commits/base')) return ok({ tree: { sha: 'bt' } });
      if (u.endsWith('/git/blobs')) return ok({ sha: 'b' });
      if (u.endsWith('/git/trees')) return ok({ sha: 't' });
      if (u.endsWith('/git/commits')) return ok({ sha: 'c' });
      if (u.endsWith('/git/refs')) return ok({ ref: 'r' });
      if (u.endsWith('/pulls')) return ok({ html_url: 'https://gh/pr/3', number: 3 });
      return { ok: false, status: 500, json: async () => ({ message: 'x' }) } as unknown as Response;
    });
    const app = appWith({ MARKETPLACE_REGISTRY_DIR: registryDir, MARKETPLACE_PUBLISH_TOKEN: 't', MARKETPLACE_PUBLISH_REPO: 'o/r', MARKETPLACE_PUBLISH_BRANCH: 'main' }, runtime, ['lab_admin'], fetchMock as unknown as typeof fetch);
    const res = await app.inject({ method: 'POST', url: '/api/marketplace/publish', payload: { ref: 'demo-1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ prUrl: 'https://gh/pr/3', prNumber: 3 });
  });
```

Update the `appWith` helper to accept and thread an optional `fetchImpl` to the route registration (see Step 3). Add at the top of the test file: `import { vi } from 'vitest';` (already imported alongside others — ensure `vi` is in the import list).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C apps/server test -- marketplace-routes`
Expected: FAIL — `/publish` + `/publish/status` 404.

- [ ] **Step 3: Implement — `apps/server/src/marketplace-routes.ts`**

1. Add imports:

```ts
import { readFile } from 'node:fs/promises';
import {
  verifyBundle, readGrant, isCompatible, readBundle,
  LocalRegistrySource, HttpRegistrySource, type RegistrySource, type Capability,
  openBundlePr, fetchRepoIndexJson, repoPathExists, mergeIndexEntry, parseIndex,
  payloadFileName, type RepoCoords, PublishError,
} from '@openldr/marketplace';
```

(Keep the existing `join`, `basename`, `CE_VERSION`, fastify, rbac imports. `readBundle` returns and `payloadFileName` were exported by A1.)

2. Allow an injectable `fetchImpl` for testability. Change the function signature:

```ts
export function registerMarketplaceRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext, fetchImpl: typeof fetch = fetch): void {
```

3. After the `source` resolution, add publish config resolution:

```ts
  const stagingDir = ctx.cfg.MARKETPLACE_REGISTRY_DIR ?? null;
  const publishRepoCfg = ctx.cfg.MARKETPLACE_PUBLISH_REPO ?? null;
  const publishToken = ctx.cfg.MARKETPLACE_PUBLISH_TOKEN ?? null;
  const publishBranch = ctx.cfg.MARKETPLACE_PUBLISH_BRANCH ?? 'main';
  const publishConfigured = Boolean(publishToken && publishRepoCfg && stagingDir);
```

4. Add the status route (after `/refresh`):

```ts
  app.get('/api/marketplace/publish/status', { preHandler: requireRole('lab_admin') }, async () => {
    return { configured: publishConfigured, repo: publishConfigured ? publishRepoCfg : null };
  });
```

5. Add the publish route:

```ts
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

      // Read the exact staged file bytes so the published signature stays intact.
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
        return { error: err.message };
      }
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
```

6. Update `apps/server/src/index.ts` (the call site) — find `registerMarketplaceRoutes(app, ctx)` and leave it unchanged (the new `fetchImpl` param defaults to global `fetch`). No change needed there.

7. In the test file, thread `fetchImpl` through `appWith`:

```ts
function appWith(cfg: Record<string, unknown>, plugins: unknown, roles: string[] = ['lab_admin'], fetchImpl?: typeof fetch) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'admin', username: 'admin', displayName: null, roles } as never;
  });
  registerMarketplaceRoutes(app, fakeCtx(plugins, cfg), fetchImpl);
  return app;
}
```

And `fakeCtx` must expose an `audit` stub — update it:

```ts
function fakeCtx(plugins: unknown, cfg: Record<string, unknown>): AppContext {
  return { cfg, plugins, audit: { record: async () => ({}) } } as unknown as AppContext;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm -C apps/server test -- marketplace-routes`
Expected: PASS (existing + 4 new). Run `pnpm -C apps/server typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/marketplace-routes.ts apps/server/src/marketplace-routes.test.ts
git commit -m "feat(server): POST /marketplace/publish (staged bundle -> GitHub PR) + /publish/status"
```

---

## Task 4: Web — Publish action + PR-link toast

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/pages/settings/marketplace/PackageDetail.tsx`
- Modify: `apps/web/src/pages/settings/marketplace/MarketplaceTabs.tsx`
- Modify: `apps/web/src/pages/settings/Marketplace.tsx`
- Modify: `apps/web/src/pages/settings/Marketplace.test.tsx`
- Modify: `apps/web/src/i18n/{en,fr,pt}.ts`

- [ ] **Step 1: api.ts — publish helpers**

Add after the marketplace section helpers:

```ts
export const getPublishStatus = (): Promise<{ configured: boolean; repo: string | null }> =>
  apiGet('/api/marketplace/publish/status', 'get publish status');

export const publishArtifact = (ref: string): Promise<{ prUrl: string; prNumber: number }> =>
  authFetch('/api/marketplace/publish', jbody({ ref }, 'POST')).then((r) => okJson<{ prUrl: string; prNumber: number }>(r, 'publish artifact'));
```

(`jbody` and `okJson` are the existing helpers used by `installArtifact` in the same file — match its style exactly.)

- [ ] **Step 2: i18n — add keys to en/fr/pt `settings.marketplace`**

en.ts:
```ts
      publish: 'Publish to GitHub',
      publishConfirmTitle: 'Publish {{id}} to the marketplace?',
      publishConfirmBody: 'Opens a pull request adding this signed bundle to the configured GitHub repository.',
      publishedToast: 'Published — pull request #{{number}} opened.',
      viewPr: 'View PR',
```
fr.ts:
```ts
      publish: 'Publier sur GitHub',
      publishConfirmTitle: 'Publier {{id}} sur la marketplace ?',
      publishConfirmBody: 'Ouvre une pull request ajoutant ce bundle signé au dépôt GitHub configuré.',
      publishedToast: 'Publié — pull request #{{number}} ouverte.',
      viewPr: 'Voir la PR',
```
pt.ts:
```ts
      publish: 'Publicar no GitHub',
      publishConfirmTitle: 'Publicar {{id}} no marketplace?',
      publishConfirmBody: 'Abre um pull request adicionando este bundle assinado ao repositório GitHub configurado.',
      publishedToast: 'Publicado — pull request #{{number}} aberto.',
      viewPr: 'Ver PR',
```

- [ ] **Step 3: PackageDetail.tsx — add a Publish action**

Add an optional prop `onPublish?: (entry: CardEntry) => void` and `canPublish?: boolean` to `PackageDetailProps`. In the header action area, when `canPublish` and the item is a local/staged registry bundle (`entry.ref` present), add a Publish button next to Install:

```tsx
            {props.canPublish && entry.ref ? (
              <Button variant="outline" data-testid="detail-publish" onClick={() => props.onPublish?.(entry)}>
                {t('settings.marketplace.publish')}
              </Button>
            ) : null}
```

(Adjust the component to receive `props` — if it currently destructures named props, add `onPublish`/`canPublish` to the destructure and reference them directly instead of `props.`.)

- [ ] **Step 4: MarketplaceTabs.tsx — thread publish props**

Add `canPublish?: boolean;` and `onPublish?: (entry: CardEntry) => void;` to `MarketplaceTabsProps`, and pass them into `<PackageDetail … canPublish={props.canPublish} onPublish={props.onPublish} />`.

- [ ] **Step 5: Marketplace.tsx — publish status + handler + PR toast**

- Import `getPublishStatus, publishArtifact` from `@/api`.
- Add `const [canPublish, setCanPublish] = useState(false);`
- In a `useEffect` on mount: `void getPublishStatus().then((s) => setCanPublish(s.configured)).catch(() => setCanPublish(false));`
- Add a handler:
```tsx
  const onPublish = useCallback(async (entry: CardEntry) => {
    if (!entry.ref) return;
    try {
      const { prUrl, prNumber } = await publishArtifact(entry.ref);
      toast.success(t('settings.marketplace.publishedToast', { number: prNumber }), {
        action: { label: t('settings.marketplace.viewPr'), onClick: () => window.open(prUrl, '_blank', 'noopener') },
      });
    } catch (e) {
      toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [t]);
```
- Pass `canPublish={canPublish} onPublish={onPublish}` to `<MarketplaceTabs>`.

- [ ] **Step 6: Update `Marketplace.test.tsx`**

- Add `getPublishStatus: vi.fn(), publishArtifact: vi.fn()` to the `@/api` mock.
- In `beforeEach` or per-test, default `(api.getPublishStatus as any).mockResolvedValue({ configured: false, repo: null });` so existing tests don't show the publish button.
- Add a publish test:
```ts
it('publishes a staged bundle and shows the PR toast', async () => {
  (api.listAvailableArtifacts as any).mockResolvedValue({ ...oneBundle });
  (api.listInstalledArtifacts as any).mockResolvedValue([]);
  (api.getPublishStatus as any).mockResolvedValue({ configured: true, repo: 'o/r' });
  (api.getAvailableArtifact as any).mockResolvedValue({
    ref: 'whonet-narrow', id: 'whonet-sqlite', version: '1.0.0', type: 'plugin', description: 'd', license: 'L',
    publisher: { id: 'p', name: 'P' }, capabilities: [], compatibility: { ceVersion: '*' }, compatible: true, ceVersion: '0.1.0',
    payload: { kind: 'plugin', entrypoint: 'convert', wasmSha256: 'a'.repeat(64), wasi: true, limits: { memoryMb: 256, timeoutMs: 30000 } }, valid: true,
  });
  (api.publishArtifact as any).mockResolvedValue({ prUrl: 'https://gh/pr/9', prNumber: 9 });
  render(<MemoryRouter><Marketplace /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId('card-whonet-narrow'));
  fireEvent.click(await screen.findByTestId('detail-publish'));
  await waitFor(() => expect(api.publishArtifact).toHaveBeenCalledWith('whonet-narrow'));
});
```

- [ ] **Step 7: Verify**

Run: `pnpm -C apps/web test` → PASS (if known parallel flake, re-run once isolated).
Run: `pnpm -C apps/web typecheck` → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/pages/settings/marketplace/PackageDetail.tsx apps/web/src/pages/settings/marketplace/MarketplaceTabs.tsx apps/web/src/pages/settings/Marketplace.tsx apps/web/src/pages/settings/Marketplace.test.tsx apps/web/src/i18n/en.ts apps/web/src/i18n/fr.ts apps/web/src/i18n/pt.ts
git commit -m "feat(web): Publish to GitHub action + PR-link toast (gated on publish status)"
```

---

## Task 5: Full verification gate

- [ ] **Step 1: Run the gate**

Run: `pnpm turbo typecheck lint test build --filter=@openldr/web --filter=@openldr/server --filter=@openldr/marketplace --filter=@openldr/config`
Expected: all green. If `@openldr/web#test` flakes in parallel, re-run `pnpm -C apps/web test` in isolation.

- [ ] **Step 2: Commit any lint autofixes**

```bash
git add -A && git commit -m "chore(marketplace): A2 publish gate green" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage (publish half):** `github-publish.ts` w/ base64 blobs + version guard + index merge (Task 2) ✓; `MARKETPLACE_PUBLISH_TOKEN/_REPO/_BRANCH` (Task 1) ✓; `POST /publish` reads staged bundle, verifies, conflict-guards, merges index, opens PR, audits (Task 3) ✓; `GET /publish/status` (Task 3) ✓; web Publish action + PR-link toast gated on status (Task 4) ✓; typed `PublishError` → status mapping (Task 3) ✓.
- **Signing stays off the server:** the route only reads + verifies a PRE-signed staged bundle and commits its exact bytes; it never signs. ✓
- **Secret handling:** `MARKETPLACE_PUBLISH_TOKEN` is config-only; ensure it's covered by the secrets-redaction boundary (it's never logged or returned — `/publish/status` returns only `configured` + `repo`). If a redaction allowlist enumerates secret keys, add `MARKETPLACE_PUBLISH_TOKEN` there.
- **Type consistency:** `RepoCoords`, `PublishError`, `openBundlePr`, `fetchRepoIndexJson`, `repoPathExists` (github-publish) used by the route; `mergeIndexEntry`/`parseIndex`/`MarketplaceIndexEntry` (A1) reused; `payloadFileName`/`readBundle`/`verifyBundle` (A1) reused; `getPublishStatus`/`publishArtifact` (api.ts) → `Marketplace.tsx` → `MarketplaceTabs` → `PackageDetail`.
- **`fetchImpl` injection:** `registerMarketplaceRoutes` gains a 3rd param defaulting to global `fetch`; the real call site in `apps/server/src/index.ts` is unchanged; tests pass a mock.
- **Staging vs install source:** publish always reads from `MARKETPLACE_REGISTRY_DIR` (staging) regardless of whether install reads from http — so you can run a remote install deployment and still publish from a local staging dir.
