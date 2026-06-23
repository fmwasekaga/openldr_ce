# Marketplace Sub-project A — Remote Registry — Design

**Date:** 2026-06-23
**Status:** Approved
**Parent roadmap:** `docs/superpowers/specs/2026-06-23-marketplace-roadmap-design.md`
**Depends on:** Sub-project B (details page) — merged to `main` (`2667b45`).
**Topic:** Make the GitHub marketplace repo real in both directions — install artifacts over
HTTPS from a published `index.json`, and publish locally-staged, pre-signed bundles to the repo
via an in-app GitHub PR.

---

## 1. Motivation

The marketplace is local-folder only today: `/api/marketplace/available` scans
`MARKETPLACE_REGISTRY_DIR`, and the signed WHONET bundles built by `make:marketplace-bundle` were
never pushed to `github.com/fmwasekaga/openldr-ce-marketplace` (hence the "empty repo" confusion).
Sub-project A makes the repo the actual source of truth: the server **reads** an `index.json` +
bundles over HTTPS, and an admin can **publish** a pre-signed bundle to the repo from the UI.

We keep the existing signed-bundle + capability + TOFU trust model unchanged. Verification stays
**fail-closed at install** (and again in the plugin runtime). corlix's distribution + PR-publish
patterns are adopted; corlix's optional-signature model is not.

---

## 2. Decisions locked during brainstorming

- **Publish scope:** install side + in-app PR of **pre-signed** bundles. Signing keys never live on
  the server — the maintainer signs via the existing `artifact`/`make:marketplace-bundle` CLI; the
  server only opens the PR. (In-app authoring/publishing of *in-app-created* artifacts is C.)
- **Publish input:** publish from a **local staging dir** by `ref` (reuse
  `MARKETPLACE_REGISTRY_DIR`). No browser upload pipeline. The server reads the staged bundle via
  the existing `readBundle`, verifies it, and opens the PR.
- **PAT storage:** a server config/env secret `MARKETPLACE_PUBLISH_TOKEN`, covered by the existing
  secrets-redaction infra. One token per deployment; publish UI disabled when unset.
- **Transport (from roadmap):** HTTP raw fetch of `index.json` + per-bundle files. No git binary on
  the server.
- **Roles:** publish is `lab_admin`-gated, same as the rest of the marketplace routes.

---

## 3. Architecture

### 3.1 Install side — `RegistrySource` abstraction (`packages/marketplace`)

Extract the registry read path (currently inlined as `readdir` in `marketplace-routes.ts`) behind:

```ts
export interface RegistryListing {
  ref: string;          // path segment used to fetch the bundle
  id: string;
  version: string;
  type: string;         // plugin | form | report | test-definition
  publisher: { id: string; name: string } | null;
  description?: string;
  summary?: string;
  signatureFingerprint?: string;
}

export interface RegistrySource {
  /** Cheap listing for the Browse grid. Does NOT download payloads. */
  list(): Promise<RegistryListing[]>;
  /** Assemble a verifiable Bundle for detail/install. */
  getBundle(ref: string): Promise<Bundle>;
}
```

- **`LocalRegistrySource(dir)`** — current behavior: scan the directory, `readBundle` each. `list()`
  maps each bundle's manifest; `getBundle(ref)` = `readBundle(join(dir, ref))`.
- **`HttpRegistrySource(baseUrl)`**:
  - `list()` fetches `<baseUrl>/index.json`, parses it (`parseIndex`), and maps `packages[]` to
    `RegistryListing[]`. No payload downloads — listing is index-only.
  - `getBundle(ref)` fetches `<baseUrl>/<path>/manifest.json`, the payload file (by `payload.kind`
    → `plugin.wasm` etc.), and `publisher.pub`, then assembles a `Bundle` (same shape `readBundle`
    returns) so `verifyBundle` and `ctx.plugins.install` work unchanged.

**`ref` vs `path` (safeRef compatibility):** the route layer guards every `ref` with the existing
`safeRef` (rejects `/`, `\`, `..`). But `index.json` `path` values contain a slash
(`bundles/whonet-sqlite-1.1.0`). So **`ref` is the single-segment basename** of the entry's path
(`whonet-sqlite-1.1.0`), and `HttpRegistrySource` keeps a `Map<ref, IndexEntry>` (built in `list()`,
backing `getBundle`) to resolve `ref` → full `path` internally. `RegistryListing.ref` is therefore
always a safe single segment for both sources (local = dir name; http = path basename), and the
existing `safeRef` guard and `data-testid={card-<ref>}` conventions from B keep working unchanged.

**Source resolution** (in the route layer): `MARKETPLACE_REGISTRY_URL` set → `HttpRegistrySource`;
else `MARKETPLACE_REGISTRY_DIR` set → `LocalRegistrySource`; else unconfigured
(`{ configured: false }`).

**Caching / refresh:** the http source caches the parsed `index.json` in memory; a manual **Refresh**
re-fetches it. Bundle bytes are fetched on demand (detail + install), not cached eagerly.

**Verification timing (http):** the Browse list shows `index.json` metadata only; full signature
verification happens when a single bundle is fetched (detail `:ref`) and again, fail-closed, at
install. The list does not download every WASM just to compute `valid`.

### 3.2 `index.json` (`packages/marketplace/src/index-json.ts`)

zod schema + helpers, ported/adapted from corlix `schema.ts` + `index-merge.ts`:

```jsonc
{
  "schemaVersion": 1,
  "name": "OpenLDR CE Marketplace",
  "updatedAt": "<ISO-8601>",
  "packages": [
    { "id": "whonet-sqlite", "kind": "plugin", "latestVersion": "1.1.0",
      "publisher": "OpenLDR Reference Publisher", "summary": "WHONET SQLite -> FHIR R4 AMR",
      "path": "bundles/whonet-sqlite-1.1.0", "signatureFingerprint": "<hex>" }
  ]
}
```

- `parseIndex(raw): MarketplaceIndex` — validate; tolerate a missing/empty file (seed case).
- `mergeIndexEntry(index, entry, nowIso): MarketplaceIndex` — update-or-append by `id`, set
  `updatedAt`. (`nowIso` is passed in — scripts/tests stay deterministic.)

### 3.3 Publish side — GitHub PR (`packages/marketplace/src/github-publish.ts`)

Ported from corlix `github-pr.ts`, adapted for **binary payloads**:

```ts
export class PublishError extends Error { kind: 'no-token'|'repo-unreachable'|'version-exists'|'network'; }

export async function openBundlePr(args: {
  owner: string; repo: string; baseBranch: string; token: string;
  bundlePath: string;                       // e.g. bundles/whonet-sqlite-1.1.0
  files: { path: string; content: Uint8Array | string }[]; // manifest.json, publisher.pub (utf-8), plugin.wasm (bytes)
  indexJson: string;                        // merged index.json (utf-8)
  branchName: string; prTitle: string; prBody: string;
}): Promise<{ prUrl: string; prNumber: number }>;
```

- Blob creation chooses encoding by content type: `string` → `encoding: 'utf-8'`; `Uint8Array` →
  base64 (`encoding: 'base64'`). **This is the key divergence from corlix** (which only wrote UTF-8
  JSON). The plugin WASM is committed as a base64 blob.
- `fetchRepoIndexJson(owner, repo, branch, token)` — GET the contents API for `index.json`; return
  `null` if 404 (first publish seeds it).
- `repoPathExists(owner, repo, branch, token, path)` — GET contents for the bundle dir/path; used
  for the version-conflict guard.
- Sequence: get base ref SHA → base commit tree SHA → create blobs (bundle files + index.json) →
  create tree (`base_tree`) → create commit → create branch ref → create PR. Returns PR url +
  number.

### 3.4 Routes — `apps/server/src/marketplace-routes.ts`

- Replace the inline `readdir`/`readBundle` with a `resolveSource(ctx.cfg)` returning a
  `RegistrySource | null`. `available`, `available/:ref`, and `install` all go through it. The
  install path calls `source.getBundle(ref)` then the existing `ctx.plugins.install(...)` with the
  same consent contract (unchanged).
- **`POST /api/marketplace/refresh`** (`lab_admin`) — clears the http source's in-memory index cache
  (no-op for local). Returns `{ ok: true }`.
- **`GET /api/marketplace/publish/status`** (`lab_admin`) — `{ configured: boolean, repo?: string }`
  (true when `MARKETPLACE_PUBLISH_TOKEN` + `MARKETPLACE_PUBLISH_REPO` are set).
- **`POST /api/marketplace/publish`** (`lab_admin`) — body `{ ref }`. Reads the staged bundle from
  `MARKETPLACE_REGISTRY_DIR` via `readBundle` (the staging dir is always local, independent of the
  install source), `verifyBundle` (refuse invalid → 400), builds the bundle file list + merged
  `index.json`, calls `openBundlePr`. Version-conflict via `repoPathExists` → 409/`version-exists`.
  Returns `{ prUrl, prNumber }`. Maps `PublishError.kind` → status + message. Audit a
  `marketplace.publish` event with actor + ref + prUrl.

### 3.5 Config — `packages/config/src/schema.ts`

```ts
MARKETPLACE_REGISTRY_URL: z.string().optional(),     // raw base, e.g. https://raw.githubusercontent.com/fmwasekaga/openldr-ce-marketplace/main
MARKETPLACE_PUBLISH_TOKEN: z.string().optional(),    // GitHub PAT (repo write); redacted
MARKETPLACE_PUBLISH_REPO: z.string().optional(),     // owner/repo, e.g. fmwasekaga/openldr-ce-marketplace
MARKETPLACE_PUBLISH_BRANCH: z.string().default('main'),
// existing: MARKETPLACE_REGISTRY_DIR (now also the publish staging dir), MARKETPLACE_DEV_ALLOW_UNSIGNED
```

`MARKETPLACE_PUBLISH_TOKEN` must be added to the secrets-redaction allowlist/boundary.

### 3.6 Web — `apps/web/src/pages/settings/marketplace/`

Small additions layered onto B's components:

- **Source indicator** near the Browse header: "Local" or "Remote · `<host>`" (from a small field on
  the `available` response, e.g. `source: 'local' | 'http'` + `host`).
- **Refresh** button (Browse) → `POST /refresh` then reload; toast on completion.
- **"Publish to GitHub"** action — shown only when `GET /publish/status` is `configured` AND the
  selected card is a local/staged bundle (`entry.ref` present and source is local OR a dedicated
  staged list). On click → confirm → `POST /publish` → success toast with a **clickable PR link**;
  typed errors → error toast (e.g. "v1.1.0 already published — bump the version").
- `api.ts`: `refreshRegistry()`, `getPublishStatus()`, `publishArtifact(ref)`, and `source`/`host`
  fields on the available response type.

---

## 4. Data flow

**Install (http):** mount → `list()` reads `index.json` → Browse grid. Open card → `getBundle(ref)`
fetches+verifies → detail. Install → consent → `getBundle(ref)` → `ctx.plugins.install` (fail-closed
verify + runtime enforcement, unchanged).

**Publish:** admin opens a staged local bundle → "Publish to GitHub" → `POST /publish { ref }` →
server `readBundle` + `verifyBundle` → `repoPathExists` guard → `fetchRepoIndexJson` +
`mergeIndexEntry` → `openBundlePr` (base64 wasm blob) → PR link in toast.

---

## 5. Error handling

- **Install (http):** fetch/parse failure → `{ configured: true, error: 'registry unreachable' }`
  (mirrors the existing local "directory not readable" branch). A bundle that fails verification is
  marked invalid (detail) / refused (install).
- **Publish:** `PublishError` kinds → HTTP status + message → toast: `no-token` (412/"publishing not
  configured"), `repo-unreachable` (502), `version-exists` (409), `network` (502). Invalid/tampered
  staged bundle → 400.

---

## 6. Testing

- **`HttpRegistrySource`** against a mocked `fetch`: `list()` parses index.json; `getBundle()`
  assembles a Bundle and `verifyBundle` passes for a good fixture and fails for a tampered one;
  network error → throws a typed/handled error.
- **`index-json`**: `mergeIndexEntry` append, update-existing, and empty/seed; `parseIndex` rejects
  malformed input.
- **`github-publish`**: `openBundlePr` with a mocked `fetch` asserts the request sequence and that
  the **WASM blob uses `encoding: 'base64'`** while JSON uses `utf-8`; `repoPathExists` true/false;
  `fetchRepoIndexJson` returns null on 404.
- **Routes**: `/available` + `/available/:ref` via a stubbed http source; `/publish` success (mock
  the github layer → returns prUrl), `version-exists`, `no-token`, invalid-bundle; `/refresh`;
  `/publish/status`. All `lab_admin`-gated.
- **Web**: source indicator renders Local/Remote; Refresh calls the endpoint + reloads; Publish
  action visible only when configured, calls `publishArtifact`, shows the PR link; version-exists
  error toast.

---

## 7. Non-goals (deferred)

- Browser upload of bundles (staging-dir chosen) — possible follow-on.
- Per-user OAuth PATs (single deployment token chosen).
- Multi-source federation, update-scanning/drift detection.
- Non-plugin publish/install lifecycles (forms/reports/test-definitions) → sub-project **C**.
- On-disk caching of downloaded bundles (in-memory index cache only for now).

---

## 8. Implementation note (plan sub-phasing)

The plan should sub-phase: **A-install** (RegistrySource + HttpRegistrySource + index-json read +
source resolution + Refresh + source indicator) first — independently shippable and immediately
fixes "consume from GitHub"; then **A-publish** (github-publish + `/publish` route + publish UI).
