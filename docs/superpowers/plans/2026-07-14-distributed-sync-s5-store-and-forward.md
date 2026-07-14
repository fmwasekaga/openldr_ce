# Distributed Sync S5 — Signed Store-and-Forward Bundles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an offline file transport for distributed sync — `openldr sync export` writes a signed, gzipped bundle of the same delta records the HTTP path carries; `openldr sync import` verifies its ed25519 signature and applies it through the identical idempotent apply path — bidirectional (lab push-export → central import; central pull-export → lab import), sharing the HTTP cursors so the two transports mix freely.

**Architecture:** A pure serialization module (`@openldr/sync/bundle.ts`, no crypto) plus a bootstrap layer that owns keys and composes it with the existing S1 safe-frontier read, the S2/S3 serve+apply paths, and the marketplace ed25519 primitives — the "inject the crypto/cursors, keep `@openldr/sync` key-agnostic" pattern S1 established. Enrollment (S4d) is extended to exchange the ed25519 keys. CLI-only surface this slice.

**Tech Stack:** TypeScript, Kysely, Node `zlib` gzip, Node `crypto` ed25519 (via `@openldr/marketplace` `signManifest`/`verifyArtifact`), `@openldr/core` `canonicalJson`, commander (CLI), Vitest + pg-mem, a real Keycloak + two Postgres DBs for the live smoke.

**Spec:** `docs/superpowers/specs/2026-07-14-distributed-sync-s5-store-and-forward-design.md`

**Key substrate to read first (all exist):**
- `packages/sync/src/batch.ts` — the wire types a bundle carries VERBATIM: `SyncRecord` (+`{seq}`), `PushBatch`, `PushResponse`, `PullRecord`, `PullResponse`. No new record shapes.
- `packages/marketplace/src/signing.ts` — `generatePublisherKeypair(): {publicKeyDer, privateKeyDer, fingerprint}` (ed25519, SPKI/PKCS8 DER), `signManifest(manifest, payloadSha256, privDer): string` (hex sig), `verifyArtifact(manifest, payloadSha256, pubDer): boolean` (reads `manifest.signature`). `packages/marketplace/src/bundle.ts` `canonicalSigningBytes(manifest, payloadSha256)` (the exact bytes signed — EXCLUDES `manifest.signature`). Reuse these verbatim; do NOT reimplement ed25519.
- `packages/core/src/canonical-json.ts` — `canonicalJson` (deterministic stringify) for manifest bytes.
- `packages/sync/src/push-worker.ts` — `createSyncPushRunner(deps)`: `deps.fetchSafeRows(db,cursor,limit)`, `deps.readCursor()`/`advanceCursor(n)` (`'sync-push'`), `planProjection` safe-frontier. `packages/sync/src/pull-worker.ts` — the pull runner + `readCursor`/`advanceCursor` (`'sync-pull'`) + the per-record apply + the S3 bulk hold policy.
- `apps/server/src/sync-routes.ts` — `POST /api/sync/pull` serve logic (reference_change_log dedup-to-latest + live-body fetch) + the S3 terminology bulk drain; `sitePrincipal`. **The pull-serve logic likely lives inline in the route handler — T4 extracts it into a reusable function.**
- `packages/bootstrap/src/enrollment.ts` — `enrollSite`/`rotateSite`/`EnrollResult`/`sync_sites` writes + `ctx.auth.clients`; `packages/bootstrap/src/index.ts` — `AppContext` (`cfg`, `syncSites`, `encryptSecret`/`decryptSecret`, the push/pull worker wiring, `close()`), the `danger*`/`enrollment` barrel exports.
- `packages/db/src/sync-site-store.ts` + `migrations/internal/051_sync_sites.ts` + `schema/internal.ts` (latest migration is `051`; add `052`) + `migrations/migrations.test.ts` (snapshot).
- `packages/config/src/sync.ts` — the reconciled sync config (`SyncConfigInputSchema`/`SyncConfigView`, the discrete `sync.*` keys, write-only-secret handling); `apps/server/src/settings-routes.ts` (`GET/PUT /api/settings/sync`); `packages/cli/src/sync.ts` (the `sync`/`settings sync` command idiom, `emit`/`redactError`/`createAppContext`→`finally ctx.close()`).
- `scripts/sync-two-instance-harness.ts` (`pnpm sync:e2e`, the S5 real-HTTP harness) — extend it for the bundle round-trip; `scripts/sync-enroll-live-acceptance.ts` (the Keycloak skip-guard).

**Global rules:** `pnpm --filter`/`pnpm exec tsx`, never raw `node_modules/.bin`. NEVER a `Co-Authored-By` trailer. Windows: run per-package `tsc --noEmit`/`vitest run` directly (turbo `--force` flakes on the install-race; never pipe turbo through `tail`; `@openldr/cli#build` fails on Windows for a pre-existing esbuild reason — use `tsc --noEmit`). New strings (if any CLI/UI) — none expected this slice (CLI-only). Announce the live-Keycloak/two-DB shortcut up front.

---

## Task 0: Cut the branch
- [ ] `git checkout main && git checkout -b feat/sync-s5-store-and-forward && git branch --show-current` → `feat/sync-s5-store-and-forward`, clean tree.

---

## Task 1: Bundle serialization module (`@openldr/sync/bundle.ts`)

**Files:** Create `packages/sync/src/bundle.ts` + `packages/sync/src/bundle.test.ts`; export from the `@openldr/sync` barrel (`packages/sync/src/index.ts`).

This module is PURE structure + gzip + sha256 — NO crypto keys, NO signing (the bootstrap layer signs/verifies the returned manifest). It defines the on-disk format and the manifest type.

- [ ] **Step 1: types + pack/unpack (`bundle.ts`)**
```ts
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { canonicalJson } from '@openldr/core';
import type { SyncRecord, PullRecord } from './batch';

export const BUNDLE_FORMAT_VERSION = 1;

export type BundleKind = 'push' | 'pull';

// The signed manifest. `signature` is filled in by the bootstrap signer AFTER pack computes
// payloadSha256 (marketplace signManifest signs over canonicalSigningBytes(manifest, payloadSha256),
// which excludes `signature`). `pullCursor` is present only on push bundles (the piggybacked lab
// 'sync-pull' position). `producedAt` is an ISO string stamped by the caller (runtime, not a workflow
// script — Date is fine).
export interface BundleManifest {
  formatVersion: number;
  kind: BundleKind;
  siteId: string;
  fromCursor: number;
  toCursor: number;
  recordCount: number;
  signerKeyId: string;      // siteId for push, 'central' for pull — selects the verify key
  producedAt: string;
  pullCursor?: number;      // push bundles only
  signature?: string;       // hex ed25519 sig, set by the signer
}

export type BundleRecords =
  | { kind: 'push'; records: (SyncRecord & { seq: number })[] }
  | { kind: 'pull'; records: PullRecord[] };

export class BundleFormatError extends Error {
  constructor(msg: string) { super(msg); this.name = 'BundleFormatError'; }
}

// Deterministic payload bytes + their sha256 hex. The signature covers (manifest, payloadSha256),
// so any tamper with the records changes payloadSha256 and fails verification.
function payloadOf(records: unknown): { payload: string; sha256: string } {
  const payload = canonicalJson(records as Record<string, unknown>);
  const sha256 = createHash('sha256').update(payload).digest('hex');
  return { payload, sha256 };
}

/** Serialize a bundle to gzipped bytes and return the payloadSha256 the caller signs over.
 * The stored file is gzip(JSON.stringify({ manifest, payload })), where payload is the deterministic
 * records string that sha256 covers. The bootstrap signer calls this once WITHOUT a signature to get
 * the sha256, signs (manifest-without-signature + sha256), embeds the signature into the manifest, and
 * calls this AGAIN to write the signed bytes — the payload string is identical both times, so the
 * sha256 unpackBundle recomputes matches what was signed. */
export function packBundle(manifest: BundleManifest, records: BundleRecords): {
  bytes: Buffer; payloadSha256: string;
} {
  if (records.kind !== manifest.kind) throw new BundleFormatError('records.kind != manifest.kind');
  const { payload, sha256 } = payloadOf(records.records);
  const file = JSON.stringify({ manifest, payload });
  return { bytes: gzipSync(Buffer.from(file, 'utf8')), payloadSha256: sha256 };
}

/** Parse gzipped bytes → manifest + records + the recomputed payloadSha256 (for the caller to verify
 * against the signature). Throws BundleFormatError on malformed input. Does NOT verify the signature. */
export function unpackBundle(bytes: Buffer): {
  manifest: BundleManifest; records: BundleRecords; payloadSha256: string;
} {
  let file: { manifest?: BundleManifest; payload?: string };
  try { file = JSON.parse(gunzipSync(bytes).toString('utf8')); }
  catch (e) { throw new BundleFormatError(`unreadable bundle: ${(e as Error).message}`); }
  const manifest = file.manifest;
  if (!manifest || manifest.formatVersion !== BUNDLE_FORMAT_VERSION) throw new BundleFormatError('bad or missing manifest/formatVersion');
  if (typeof file.payload !== 'string') throw new BundleFormatError('missing payload');
  const sha256 = createHash('sha256').update(file.payload).digest('hex');
  let parsed: unknown;
  try { parsed = JSON.parse(file.payload); } catch (e) { throw new BundleFormatError(`bad payload json: ${(e as Error).message}`); }
  if (!Array.isArray(parsed)) throw new BundleFormatError('payload is not an array');
  const records: BundleRecords = manifest.kind === 'push'
    ? { kind: 'push', records: parsed as (SyncRecord & { seq: number })[] }
    : { kind: 'pull', records: parsed as PullRecord[] };
  return { manifest, records, payloadSha256: sha256 };
}
```
NOTE: the payload is `canonicalJson(records.records)` on pack but `JSON.parse(file.payload)` on unpack — `packBundle` must store the SAME `payload` string it hashed. It does (`file` embeds `payload`). Confirm `canonicalJson` accepts an array (read `packages/core/src/canonical-json.ts`; if it only accepts objects, use `canonicalJson({ records: records.records })` symmetrically on both sides, or `JSON.stringify` with sorted keys — pick one and use it identically in pack + the sha256 recompute path). The sha256 is over the exact stored `payload` string, so pack/unpack agree by construction.

- [ ] **Step 2: tests (`bundle.test.ts`)** — pure, no crypto:
  - `packBundle`→`unpackBundle` round-trip for a push bundle (records + manifest fields equal; `payloadSha256` equal on both sides).
  - same for a pull bundle.
  - `unpackBundle` throws `BundleFormatError` on: non-gzip bytes, gzip-of-non-JSON, missing `payload`, wrong `formatVersion`, payload-not-an-array.
  - flipping one byte of the stored payload string (simulate by packing, ungzipping, mutating a record, re-gzipping) yields a DIFFERENT `payloadSha256` on unpack (this is what makes signature verification catch tampering — assert the two hashes differ).
  - `records.kind !== manifest.kind` → `packBundle` throws.

- [ ] **Step 3:** export `packBundle`/`unpackBundle`/`BundleManifest`/`BundleKind`/`BundleRecords`/`BundleFormatError`/`BUNDLE_FORMAT_VERSION` from the `@openldr/sync` barrel. Run `pnpm --filter @openldr/sync exec tsc --noEmit && pnpm --filter @openldr/sync exec vitest run src/bundle.test.ts`. Commit `feat(sync): signed-bundle serialization format (pack/unpack) (sync S5)`.

**Gotcha:** `@openldr/sync` must NOT gain a dependency on `@openldr/marketplace` or on any key material — signing/verifying happens in bootstrap (Task 4). Keep this module crypto-free; it only structures bytes + computes the sha256 the signer covers.

---

## Task 2: Enrollment key exchange (central side) — migration + keys in `enrollSite`/`rotateSite`

**Files:** Create `packages/db/src/migrations/internal/052_sync_site_keys.ts` + register; Modify `packages/db/src/schema/internal.ts`, `packages/db/src/sync-site-store.ts` (+ test), `packages/db/src/migrations/migrations.test.ts` (snapshot); Modify `packages/bootstrap/src/enrollment.ts` (+ `enrollment.test.ts`); the barrel if `EnrollResult` shape changes.

- [ ] **Step 1: migration `052_sync_site_keys`** (register `'052_sync_site_keys'`, mirror `051`'s structure):
```ts
import { type Kysely, sql } from 'kysely';
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('sync_sites').addColumn('signing_public_key', 'text').execute();       // SPKI DER, hex
  await db.schema.alterTable('sync_sites').addColumn('reported_pull_cursor', 'bigint').execute();    // piggybacked lab 'sync-pull' pos
}
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('sync_sites').dropColumn('reported_pull_cursor').execute();
  await db.schema.alterTable('sync_sites').dropColumn('signing_public_key').execute();
}
```
Add both columns to `SyncSitesTable` in `schema/internal.ts` (`signing_public_key: string | null`, `reported_pull_cursor: string | null` — bigint reads as string in this codebase; coerce with `Number()` when read). Append `'052_sync_site_keys'` to the `migrations.test.ts` snapshot.

- [ ] **Step 2: store (`sync-site-store.ts`)** — extend `SyncSiteRow` with `signingPublicKey: string | null` (map from `signing_public_key`) and add methods: `setSigningPublicKey(siteId, hexDer: string): Promise<void>`; `getReportedPullCursor(siteId): Promise<number>` (`Number(reported_pull_cursor ?? 0)`); `setReportedPullCursor(siteId, seq: number): Promise<void>`. Keep the no-secret invariant — the PRIVATE key is never stored. `insert` gains no key (keys set immediately after by the orchestrator, or extend `insert` to accept `signingPublicKey` — pick one; the orchestrator calls `setSigningPublicKey` right after mint is simplest). Update the store test: round-trip the new column + the reported-cursor get/set.

- [ ] **Step 3: central signing keypair helper (`packages/bootstrap/src/enrollment.ts`)** — add:
```ts
import { generatePublisherKeypair } from '@openldr/marketplace';
// app_settings keys
const CENTRAL_PRIV = 'sync.central_signing_private_key'; // encrypted
const CENTRAL_PUB  = 'sync.central_signing_public_key';  // plaintext hex

/** Idempotently ensure the single central signing keypair exists; return {privDerHex, pubDerHex}.
 * Reads app_settings via ctx's settings store; creates once, reuses thereafter. */
async function ensureCentralKeypair(ctx: AppContext): Promise<{ privHex: string; pubHex: string }> {
  const existingPub = await ctx.settings.get(CENTRAL_PUB);      // confirm the actual settings-store getter name
  const existingPriv = await ctx.settings.get(CENTRAL_PRIV);
  if (existingPub && existingPriv) {
    return { privHex: ctx.decryptSecret(existingPriv), pubHex: existingPub };
  }
  const kp = generatePublisherKeypair();
  const privHex = Buffer.from(kp.privateKeyDer).toString('hex');
  const pubHex = Buffer.from(kp.publicKeyDer).toString('hex');
  await ctx.settings.set(CENTRAL_PUB, pubHex);
  await ctx.settings.set(CENTRAL_PRIV, ctx.encryptSecret(privHex));
  return { privHex, pubHex };
}
```
CONFIRM the actual settings-store API on `AppContext` (read how `sync-settings.ts` reads/writes the `sync.*` keys — it may be `ctx.settings.get/set`, an `appSettings` store, or the sync-settings helpers; use whatever exists) and how `encryptSecret`/`decryptSecret` are exposed (S4b added them to `AppContext`). Report what you used.

- [ ] **Step 4: extend `EnrollResult` + `enrollSite`/`rotateSite`** — add to `EnrollResult`: `signingPrivateKey: string` (site priv DER hex) and `centralPublicKey: string` (central pub DER hex). In `enrollSite`, after the client is minted: `const { pubHex: centralPublicKey } = await ensureCentralKeypair(ctx); const kp = generatePublisherKeypair(); const signingPublicKey = Buffer.from(kp.publicKeyDer).toString('hex'); const signingPrivateKey = Buffer.from(kp.privateKeyDer).toString('hex');` → `await ctx.syncSites.setSigningPublicKey(siteId, signingPublicKey)` (only the PUBLIC key persisted) → return `{ ...existing, signingPrivateKey, centralPublicKey }`. In `rotateSite`, additionally re-mint the site keypair (new `setSigningPublicKey`) and return `{ clientId, clientSecret, signingPrivateKey, centralPublicKey }`. NEVER persist the private key.

- [ ] **Step 5: tests (`enrollment.test.ts`)** — extend the existing fakes: enroll returns a `signingPrivateKey` + `centralPublicKey`; the `sync_sites` row gets `signing_public_key` set and NO private key anywhere; the central keypair is created once and REUSED on a second enroll (assert `ctx.settings.set(CENTRAL_PRIV,...)` called once across two enrolls); rotate re-mints (new public key stored, new private returned). Add a bootstrap dep on `@openldr/marketplace` if not present.

- [ ] **Step 6:** `pnpm --filter @openldr/db exec tsc --noEmit && pnpm --filter @openldr/db exec vitest run` + `pnpm --filter @openldr/bootstrap exec tsc --noEmit && pnpm --filter @openldr/bootstrap exec vitest run`. Commit `feat(sync): exchange ed25519 signing keys at enrollment (sync S5)`.

**Gotcha:** `@openldr/marketplace` may pull a heavier dep graph into bootstrap — that's acceptable (bootstrap is the top composition layer). If a dependency CYCLE appears (marketplace→bootstrap), STOP and report; the fix is to move `generatePublisherKeypair`/`signManifest`/`verifyArtifact` into `@openldr/core` and re-export from marketplace, but only do that if a cycle actually forces it.

---

## Task 3: Lab-side config for the received keys

**Files:** Modify `packages/config/src/sync.ts` (add two keys to the reconciled config), `packages/bootstrap/src/sync-settings.ts` (read/write them), `apps/server/src/settings-routes.ts` (the `GET/PUT /api/settings/sync` view/input), and the `openldr settings sync set` field list in `packages/cli/src/*` if it enumerates fields. + tests.

- [ ] **Step 1:** add two discrete lab-side keys mirroring how `sync.client_secret` is handled (write-only + encrypted): `sync.signing_private_key` (encrypted at rest, write-only in the view — expose only `signingKeySet: boolean`) and `sync.central_public_key` (plaintext, readable — it's a public key). Extend `SyncConfigInputSchema` (both optional; secret preserved-when-blank like `clientSecret`) and `SyncConfigView` (`signingKeySet: boolean`, `centralPublicKey: string`). Follow the EXACT S4a pattern for `clientSecret` (only written when non-empty, encrypted via the injected `encrypt`).
- [ ] **Step 2:** `sync-settings.ts` `getSyncConfig`/`setSyncConfig` read/write the two keys (private key through `encrypt`/`decrypt`, only written when non-empty). Expose a helper the orchestrator uses: `readSigningKeys(ctx): { signingPrivateKey: string | null; centralPublicKey: string | null; siteId: string | null }` (decrypts the private key). Mirror the existing `readSyncConfig` decrypt-injection so the package stays crypto-free where that pattern is used.
- [ ] **Step 3:** endpoint view/input in `settings-routes.ts` (write-only private key, readable central public key + `signingKeySet`); the CLI `settings sync set` field enum gains `signingPrivateKey`/`centralPublicKey` if it validates field names.
- [ ] **Step 4: tests** — config round-trip: setting `signingPrivateKey` encrypts + preserves-when-blank + never appears in the view (only `signingKeySet:true`); `centralPublicKey` round-trips readable. Endpoint test: PUT then GET shows `signingKeySet:true`, no private key in the body.
- [ ] **Step 5:** typecheck (`@openldr/config` + `@openldr/bootstrap` + `@openldr/server`) + the touched tests. Commit `feat(sync): lab-side signing key + central public key config (sync S5)`.

---

## Task 4: Export/import orchestrations (`@openldr/bootstrap`)

**Files:** Create `packages/bootstrap/src/sync-bundle.ts` + `sync-bundle.test.ts`; export from the barrel. Possibly Modify `apps/server/src/sync-routes.ts` to EXTRACT the pull-serve logic into a reusable function (see Step 0).

- [ ] **Step 0: make the pull-serve logic reusable.** Read `apps/server/src/sync-routes.ts` `POST /api/sync/pull` (+ the terminology bulk drain). If the "given `fromSeq`, produce the ordered `PullRecord[]` + `nextSeq` (reference_change_log dedup-to-latest + live-body fetch) and the terminology bulk pages" logic is INLINE in the handler, extract it into an exported function (e.g. `servePull(ctx, fromSeq): Promise<PullResponse>` in a shared module — `@openldr/sync` or a `bootstrap`/server module both the route and the exporter call) so `exportPullBundle` and the HTTP route share ONE serve implementation. If it's already a callable function, reuse it. Report which. Likewise confirm `fetchSafeChangeRows` (push safe-frontier) is exported from `@openldr/db` and reusable for the exporter (it is — the push worker uses it).

- [ ] **Step 1: signer/verifier wiring + typed errors (`sync-bundle.ts`)**
```ts
import { signManifest, verifyArtifact } from '@openldr/marketplace';
import { packBundle, unpackBundle, type BundleManifest } from '@openldr/sync';

export class BundleSignatureError extends Error { constructor(m='bundle signature invalid'){ super(m); this.name='BundleSignatureError'; } }
export class BundleGapError extends Error { constructor(public fromCursor:number, public cursor:number){ super(`bundle starts at ${fromCursor} but cursor is ${cursor} (gap)`); this.name='BundleGapError'; } }

function signBundle(manifest: BundleManifest, records: BundleRecords, privHex: string): Buffer {
  const withoutSig = { ...manifest }; delete withoutSig.signature;
  const { payloadSha256 } = packBundle(withoutSig as BundleManifest, records);
  const signature = signManifest(withoutSig as Record<string, unknown>, payloadSha256, Buffer.from(privHex, 'hex'));
  const signed = { ...withoutSig, signature } as BundleManifest;
  return packBundle(signed, records).bytes;   // re-pack with signature embedded (payload identical)
}
function verifyBundle(bytes: Buffer, pubHex: string): { manifest: BundleManifest; records: BundleRecords } {
  const { manifest, records, payloadSha256 } = unpackBundle(bytes);
  const ok = verifyArtifact(manifest as Record<string, unknown>, payloadSha256, Buffer.from(pubHex, 'hex'));
  if (!ok) throw new BundleSignatureError();
  return { manifest, records };
}
```
NOTE: `packBundle` is called twice in `signBundle` (once to get the sha256 to sign, once to embed the signature). Both produce the SAME payload string (records unchanged) so the sha256 the signer covers matches what `unpackBundle` recomputes. If double-pack is a concern, refactor `packBundle` to accept a pre-set signature — but the simple double-pack is correct and cheap.

- [ ] **Step 2: the four orchestrations** (take `ctx`, read the injectable pieces; write/read a file via `node:fs`):
```ts
export async function exportPushBundle(ctx: AppContext, opts: { from?: number; out?: string }): Promise<{ path: string; manifest: BundleManifest }>;
export async function importPushBundle(ctx: AppContext, bytes: Buffer): Promise<{ applied: number; ackSeq: number; siteId: string }>;
export async function exportPullBundle(ctx: AppContext, opts: { siteId: string; out?: string }): Promise<{ path: string; manifest: BundleManifest }>;
export async function importPullBundle(ctx: AppContext, bytes: Buffer): Promise<{ applied: number; toCursor: number }>;
```
- **exportPushBundle:** `const { signingPrivateKey, siteId } = readSigningKeys(ctx)` (throw a clear error if missing). `const from = opts.from ?? await readPushCursor(ctx)` (the `'sync-push'` cursor — reuse the push worker's cursor read). `const { rows } = await fetchSafeChangeRows(ctx.internalDb, from, BIG_LIMIT)` → map to `(SyncRecord & {seq})[]` using the SAME row→record mapping the push worker uses (extract/reuse it so a bundle == an HTTP push payload). `toCursor = max seq (or from if empty)`. Build the manifest `{ kind:'push', siteId, fromCursor:from, toCursor, recordCount, signerKeyId:siteId, producedAt:new Date().toISOString(), pullCursor: await readPullCursor(ctx) }`. `bytes = signBundle(manifest, {kind:'push',records}, signingPrivateKey)`. Write to `opts.out ?? \`sync-push-${siteId}-${from}-${toCursor}.bundle\`` in cwd. Advance `'sync-push'` to `toCursor` (optimistic). Return `{path, manifest: signed}`.
- **importPushBundle:** `const { manifest, records } = verifyBundle(bytes, <lookup>)` where the verify key = `ctx.syncSites.get(manifest.siteId).signingPublicKey` (throw `SiteNotFoundError` if unknown/no key; reject a revoked site as `/api/sync/push` does). Cross-site guard: every `record.siteId === manifest.siteId`. Apply each via `ctx.applyRemote`/the same per-record path `/api/sync/push` uses (per-record error isolation). `if (manifest.pullCursor != null) await ctx.syncSites.setReportedPullCursor(manifest.siteId, manifest.pullCursor)`. Return `{ applied, ackSeq: max seq, siteId }`. Idempotent (monotonic apply).
- **exportPullBundle:** `const { pubHex: _c, privHex } = await ensureCentralKeypair(ctx)` (need the central PRIVATE key to sign — expose it from the enrollment helper or read app_settings directly). `const from = await ctx.syncSites.getReportedPullCursor(siteId)` (0 → full snapshot). `const resp = await servePull(ctx, from)` (Step 0). Build manifest `{ kind:'pull', siteId, fromCursor:from, toCursor:resp.nextSeq, recordCount:resp.records.length, signerKeyId:'central', producedAt }`. Sign with the central private key. Write to `opts.out ?? \`sync-pull-${siteId}-${from}-${resp.nextSeq}.bundle\``. No cursor advance on central. Return `{path, manifest}`.
- **importPullBundle:** `const { centralPublicKey } = readSigningKeys(ctx)` (throw if not pinned). `const { manifest, records } = verifyBundle(bytes, centralPublicKey)`. **Contiguity guard:** `const cursor = await readPullCursor(ctx); if (manifest.fromCursor > cursor) throw new BundleGapError(manifest.fromCursor, cursor);`. Apply each `PullRecord` via the SAME lab-side pull apply the pull worker uses (`applyReferenceChange`/`syncSystem`/`syncConceptMap`, bulk hold-on-failure). Advance `'sync-pull'` to `manifest.toCursor`. Return `{ applied, toCursor: manifest.toCursor }`.

CONFIRM the cursor read/advance helpers for `'sync-push'`/`'sync-pull'` on `ctx` (the workers use injected `readCursor`/`advanceCursor` bound to `fhir.change_cursors`; reuse the same db-level helper the bootstrap wiring builds — read `packages/bootstrap/src/index.ts` where it wires `readCursor`/`advanceCursor` for the two workers). Report the helper you used.

- [ ] **Step 3: tests (`sync-bundle.test.ts`)** — pg-mem cursors + fake `syncSites` + a fake/real `servePull` + real `packBundle`/marketplace sign-verify (generate a throwaway keypair in-test):
  - push export → the bytes verify with the site public key; manifest has the right cursor range + piggybacked `pullCursor`; `'sync-push'` advanced.
  - push import of that bundle → records applied; `reported_pull_cursor` set to the piggybacked value; re-import idempotent; a bundle signed with the WRONG key → `BundleSignatureError`; a tampered payload → `BundleSignatureError`; unknown/revoked site → `SiteNotFoundError`; a record with a mismatched `siteId` → rejected.
  - pull export from a reported cursor of 0 → full snapshot; from N → delta from N.
  - pull import → applies + advances `'sync-pull'`; a bundle whose `fromCursor` > current cursor → `BundleGapError`; a contiguous bundle → applies.
- [ ] **Step 4:** typecheck (`@openldr/bootstrap` [+ `@openldr/server` if Step 0 changed the route]) + tests. Commit `feat(sync): store-and-forward export/import orchestrations (sync S5)`.

**Gotcha:** push apply is order-independent (monotonic version) so push import needs NO gap guard; pull apply CAN regress (reference dedup-to-latest / whole-system replace) so pull import MUST enforce the contiguity guard. Do not add a gap guard to push (it would break the `--from` re-export of an overlapping range).

---

## Task 5: CLI `openldr sync export|import`

**Files:** Modify `packages/cli/src/sync.ts` + `packages/cli/src/index.ts`; `packages/cli/src/sync.test.ts`.

- [ ] **Step 1:** add handlers mirroring `runSyncEnroll`/`runSyncStatus` (`createAppContext(loadConfig())` → `finally ctx.close()`, `emit(json,data,text)`, `redactError`, `process.exitCode`):
  - `runSyncExport(opts: { kind?: 'push'|'pull'; site?: string; from?: string; out?: string; json?: boolean })` → if `kind === 'pull'` require `--site` (error+exit 1 otherwise) → call `exportPullBundle`/`exportPushBundle` → print the manifest summary (kind, siteId, `fromCursor→toCursor`, recordCount, written path); `--json` emits the manifest. Default `kind`: if `--site` given → `pull`, else `push` (a lab exports push; document it).
  - `runSyncImport(file: string, opts: { json?: boolean })` → read the file → `unpackBundle` to read `manifest.kind` → dispatch to `importPushBundle`/`importPullBundle` → print `{applied, cursorRange}`. Map `BundleSignatureError`/`BundleGapError`/`BundleFormatError`/`SiteNotFoundError` → exit 1 with a clear message each.
- [ ] **Step 2:** register on `syncGroup` in `index.ts` (mirror `sync enroll`/`sync status`): `sync.command('export').option('--kind <kind>').option('--site <id>').option('--from <seq>').option('--out <file>').option('--json').action(runSyncExport)`; `sync.command('import <file>').option('--json').action(runSyncImport)`.
- [ ] **Step 3: tests** (mirror the existing `sync.test.ts`): export writes a file + prints the summary; import of that file applies + reports; a signature/gap error maps to exit 1; `pull` export without `--site` → exit 1. Use a temp dir for the file (`node:os` tmpdir).
- [ ] **Step 4:** `pnpm --filter @openldr/cli exec tsc --noEmit && pnpm --filter @openldr/cli exec vitest run` (NOT build — Windows esbuild flake). Commit `feat(cli): openldr sync export|import (sync S5)`.

**Gotcha:** no secret is ever printed — export writes signed bundles (no private key in the output) and import reads the pinned/decrypted keys from config. `sync list`/`status` are unchanged.

---

## Task 6: Live acceptance, gate, whole-slice review, merge, push

- [ ] **Live acceptance `scripts/sync-bundle-live-acceptance.ts` + `pnpm sync:bundle:accept`** — extend the two-instance pattern in `scripts/sync-two-instance-harness.ts` (reuse its four-DB provisioning + central Fastify app + the Keycloak skip guard; FLAG that it needs a real Keycloak + two Postgres DBs, skip cleanly otherwise). Flow: enroll-with-keys (assert `signingPrivateKey`+`centralPublicKey` returned, `sync_sites.signing_public_key` set, private key nowhere persisted) → configure the lab ctx with the returned keys → `exportPushBundle` on the lab → read the file bytes → `importPushBundle` on central (assert mirrored at origin version + `site_id` stamped + `reported_pull_cursor` set from the piggyback) → **tamper a byte → `importPushBundle` throws `BundleSignatureError`** → **sign with a throwaway key → rejected** → **re-import the good bundle → idempotent** → `exportPullBundle` for the site (from the piggybacked cursor) → `importPullBundle` on the lab (assert a form/dashboard + a terminology system applied, `managed_origin='central'`) → **skip a range to force a gap → `BundleGapError`** → cleanup (revoke, drop DBs). Print `✅ sync:bundle:accept PASSED`, exit 0. Paste output. (On this box a real Keycloak + PG :5433 ARE available; the harness provisions the lab DBs itself.)
- [ ] **Gate:** run each directly (never pipe turbo through `tail`; re-run any known Windows/parallel flake in isolation): `pnpm --filter @openldr/sync --filter @openldr/db --filter @openldr/bootstrap --filter @openldr/config --filter @openldr/server --filter @openldr/cli --filter @openldr/marketplace exec tsc --noEmit` and each package's `vitest run`. Re-run the S1–S4d + harness acceptance scripts (`sync:accept`, `sync:pull:accept`, `sync:terminology:accept`, `sync:enroll:accept`, `sync:e2e`) — shared `@openldr/sync`/`@openldr/bootstrap`/enrollment/`sync_sites` touched; must not regress. Paste PASS/FAIL.
- [ ] **Whole-slice review** (fresh reviewer over `git diff main...HEAD`): the bundle is signed + verified before ANY apply (both directions); the site PRIVATE key is never persisted on central (only `signing_public_key`); the lab's `signing_private_key` is encrypted at rest + write-only in the view; push import is idempotent + cross-site-guarded + needs no gap guard; pull import enforces the contiguity guard; bundles share the HTTP `'sync-push'`/`'sync-pull'` cursors; export prints/writes no secret; `EnrollResult` returns the two new keys ONCE; the pull-serve logic is shared with the HTTP route (one implementation); no `Co-Authored-By`.
- [ ] **Merge:** `git checkout main && git merge --no-ff feat/sync-s5-store-and-forward -m "Merge branch 'feat/sync-s5-store-and-forward': distributed sync S5 — signed store-and-forward bundles"`.
- [ ] **Push:** ask the user before `git push origin main`.
- [ ] **Update memory:** `distributed-sync-central-workstream.md` + `MEMORY.md` — S5 DONE (signed ed25519 bundles, bidirectional export/import, key exchange at enrollment, shared cursors + contiguity guard, `sync:bundle:accept` proven); NEXT = S6 co-edit/conflict → S7 hardening (bundle encryption-at-rest, chunking, central-key rotation, per-concept origin, gzip pages).

---

## Self-review notes

- **Spec coverage:** §1 key exchange → T2 (central) + T3 (lab config); §2 bundle format → T1; §3 export/import orchestrations → T4 (+ Step 0 shared serve); §4 cursors (shared, piggyback, contiguity) → T4; §5 CLI → T5; §6 testing → each task's tests + T6 live smoke. All covered.
- **Ordering safety:** bundle format (T1) before the orchestrations (T4) that pack/unpack; key exchange (T2) + lab config (T3) before the orchestrations that read keys; orchestrations before the CLI (T5) that calls them; everything before the live smoke (T6).
- **Type consistency:** `BundleManifest`/`BundleRecords`/`packBundle`/`unpackBundle` (sync) used by `signBundle`/`verifyBundle` (bootstrap); `SyncRecord`/`PullRecord` carried verbatim; `EnrollResult`+`signingPrivateKey`/`centralPublicKey` shared enrollment→CLI→harness; typed errors `BundleSignatureError`/`BundleGapError`/`BundleFormatError`/`SiteNotFoundError` map CLI→exit / import→throw consistently.
- **Security invariants (call out in review):** signature verified before any apply; site private key never persisted centrally (only public); lab private key encrypted + write-only; push cross-site-guarded; pull contiguity-guarded; no secret in CLI output; keys exchanged once at enroll.
- **Deliberate shortcuts (flagged):** optimistic push-cursor advance (lost file → `--from`); per-site full-snapshot pull when never-heard; single unrotated central key; bundles signed not encrypted; CLI-only (no UI); live smoke needs a real Keycloak + two DBs (skips cleanly).
- **Plan-time unknowns to resolve during T2/T4:** the exact `AppContext` settings-store getter/setter for the `sync.*` app_settings keys + `encryptSecret`/`decryptSecret` exposure; whether the pull-serve logic is already a callable function or must be extracted from the route (Step 0); the exact `readCursor`/`advanceCursor` helper the bootstrap wiring builds for the two workers. Report what you used.
```
