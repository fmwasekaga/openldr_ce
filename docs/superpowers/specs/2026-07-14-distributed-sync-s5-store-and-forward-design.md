# Distributed Sync — S5: Signed Store-and-Forward Bundles

**Date:** 2026-07-14
**Slice:** S5 — offline file transport for sync (`openldr sync export` / `import`)
**Branch:** `feat/sync-s5-store-and-forward` (to cut)
**Parent architecture:** `docs/superpowers/specs/2026-07-02-distributed-sync-architecture-design.md` (north-star, `6fc9bb75`; §3 "file/store-and-forward fallback", §4 line 51 "signed bundles", §Decomposition "S4 — Store-and-forward bundles")
**Predecessors (all DONE + on `main`):** S1 push (`c5131a31`), S2 pull config (`fd7fee91`), S3 terminology pull (`84304da7`), S4a-c reconcile+UI (`98c7b0e9`), S4d enrollment (`f7f3ffad`).

## Context & what this closes

S1–S4d give labs an online, Keycloak-authenticated HTTPS sync path (push operational FHIR up, pull reference config + terminology down) plus central-side enrollment that mints each lab's machine client. The north-star architecture always paired that online path with a **file/store-and-forward fallback** for sites on bandwidth-constrained or fully intermittent links: "the identical delta batches serialize to signed bundles — `openldr sync export` writes a bundle file … `openldr sync import` ingests it at central through the same idempotent apply path; the bundle signature (the lab's key) is verified before apply" (architecture §4 line 51).

S5 builds that fallback as a **first-class peer to HTTP** (decided: symmetric — a lab can operate purely on bundles indefinitely, and mix HTTP + bundles freely). The core problem HTTP solves with a live token — proving a transfer's authenticity — must now be solved **offline**, so each side verifies a bundle's signature against a pre-shared public key before applying anything.

**Key substrate facts (verify against code during implementation):**
- The wire record types already exist: `@openldr/sync` `batch.ts` `SyncRecord`/`PushBatch` (push) and `PullRecord`/`PullResponse` (pull, incl. the S3 `terminology_system`/`concept_map` signal records). A bundle serializes exactly these — no new record shapes.
- The apply paths already exist and are idempotent: `applyRemote(record)` (`@openldr/db` fhir-store, monotonic-version, order-independent) for push; `applyReferenceChange` + the S3 `syncSystem`/`syncConceptMap` bulk reconcile for pull. S5 adds **no new apply logic**.
- Cursors are `fhir.change_cursors` rows keyed by consumer name: `'sync-push'` (lab: how far it has sent up), `'sync-pull'` (lab: how far it has consumed reference/terminology). Central serves pull from `reference_change_log`/terminology generation by `fromSeq`.
- Enrollment (S4d) `enrollSite`/`sync_sites`/`ctx.auth.clients` is the extension point for key exchange. `sync_sites` currently has no key column; `EnrollResult` returns `{clientId, clientSecret, siteId, centralUrl, oidcIssuer}` once.
- **Reusable signing infra exists:** `packages/marketplace/src/signing.ts` (ed25519 sign/verify), trust-store patterns, and `@openldr/core` `canonicalJson`/`canonicalHash` (deterministic serialization). S5 reuses these rather than inventing crypto.
- Secrets-at-rest: `ctx.encryptSecret`/`decryptSecret` (AES via `SECRETS_ENCRYPTION_KEY`) already on `AppContext` (S4b); the sync config secret is stored encrypted in `app_settings`. S5 stores signing keys the same way.

## Scope (decided)

**In:** bidirectional signed bundles — lab push-export → central import, and central pull-export (per site) → lab import — over an ed25519 trust model exchanged at enrollment; CLI (`openldr sync export`/`import`); shared cursors with the HTTP path; contiguity-guarded pull import; a live acceptance harness.

**Out (deferred):** UI export/import buttons on the Sync card / Sites page (CLI-first this slice; a later slice adds them); bundle chunking / resumability for very large terminology (rely on gzip + S3 whole-system replace; chunk in S7); a signing-key rotation ceremony beyond "re-enroll re-mints"; multi-hop / relay topologies; compression tuning beyond gzip.

## Design

### 1. Trust & key exchange (extends S4d enrollment)

Offline verification needs a public key on each side *before* any transfer. S5 extends enrollment to distribute ed25519 keys:

- **Central keypair (one, lazily created):** `enrollSite` ensures — idempotently, on the first enroll — that a single central ed25519 keypair exists: private key stored **encrypted** in `app_settings` (`sync.central_signing_private_key`, via `ctx.encryptSecret`), public key stored plaintext (`sync.central_signing_public_key`). Created once, reused for every site (later enrolls read the existing pair).
- **Per-site keypair:** `enrollSite` mints an ed25519 keypair for the site. The **public** key is persisted in a new `sync_sites.signing_public_key` column. The **private** key is NOT persisted on central — it is returned once.
- **`EnrollResult` gains two fields** (returned once, like the client secret, never re-fetchable): `signingPrivateKey` (the site's private key — the lab signs push bundles with it) and `centralPublicKey` (the lab pins it to verify pull bundles).
- **Lab side:** the operator stores the signing private key + central public key into the lab's config (new write-only `sync.signing_private_key` [encrypted] and `sync.central_public_key` [pinned] keys, entered via the existing Sync card / `openldr settings sync set`). Lost signing key ⇒ `sync rotate` (see below).
- **Verification directions:** lab→central push bundle is signed with the **site private key**, verified by central against `sync_sites.signing_public_key`. Central→lab pull bundle is signed with the **central private key**, verified by the lab against the pinned `sync.central_public_key`.
- **Rotation:** `sync rotate <siteId>` (S4d) additionally re-mints the site signing keypair (new `sync_sites.signing_public_key`, new returned private key) alongside the client secret. Central key rotation is out of scope (documented).

New keys/columns summary: migration adds `sync_sites.signing_public_key text`. New `app_settings` keys: `sync.central_signing_private_key` (encrypted), `sync.central_signing_public_key`; lab-side `sync.signing_private_key` (encrypted), `sync.central_public_key`.

### 2. Bundle format (`@openldr/sync/bundle.ts`)

A bundle is a single file with three parts, gzipped as a whole:

```
manifest  : JSON  { formatVersion:1, kind:'push'|'pull', siteId, fromCursor, toCursor,
                    recordCount, pullCursor?, signerKeyId, producedAt }
payload   : the serialized records — a JSON array (SyncRecord[] for push, PullRecord[] for pull); the plan may switch to NDJSON only if a very large payload demands streaming
signature : ed25519 over  canonicalJson(manifest) ‖ sha256(payload)
```

- `pullCursor` is present only on **push** bundles (the piggybacked lab pull position — §4).
- `signerKeyId` identifies which public key verifies it (e.g. the siteId for push, a fixed `'central'` for pull) so the verifier selects the right key.
- New module exports: `writeBundle(opts): Buffer`, `readBundle(buf): { manifest, records }` (throws on malformed), `verifyBundle(buf, publicKey): { manifest, records }` (throws `BundleSignatureError` on bad signature / tamper). Signing/verifying delegates to the marketplace ed25519 primitives; manifest hashing uses `canonicalJson`. `@openldr/sync` stays crypto-key-agnostic where possible — keys are passed in by the bootstrap orchestrator (which owns decrypt), mirroring the S1 `injected decrypt` pattern.

### 3. Export / import orchestrations (`@openldr/bootstrap`)

Shared logic (the S4d orchestrator pattern — take `ctx`, read stores/config, injectable pieces for tests), consumed by both CLI verbs:

- **`exportPushBundle(ctx, { from?, out? }): { path, manifest }`** (lab side): read `change_log` from `from ?? cursor('sync-push')` → head using the **existing S1 safe-frontier** read (reuse `fetchSafeChangeRows`/the push runner's row builder so a bundle carries exactly what an HTTP push would). Build `SyncRecord[]`, sign with the lab's `sync.signing_private_key`, stamp the manifest's `pullCursor` = the lab's current `'sync-pull'` cursor, write the file, and advance `'sync-push'` to `toCursor` (optimistic — the operator uses `--from` to re-export if a file is lost). `siteId` from `sync.site_id`.
- **`importPushBundle(ctx, buf): { applied, ackSeq, siteId }`** (central side): `verifyBundle` against `sync_sites.signing_public_key` for the manifest's `siteId` (reject unknown/revoked site, bad signature, or cross-site records exactly as `/api/sync/push` does) → apply each record via `applyRemote` with per-record isolation → persist the manifest `pullCursor` into `sync_sites.reported_pull_cursor` (new column). Idempotent: re-import is a no-op (monotonic apply).
- **`exportPullBundle(ctx, { siteId, out? }): { path, manifest }`** (central side): from `sync_sites.reported_pull_cursor` for that site (full-snapshot fallback: `fromSeq = 0` when never reported) build the reference + terminology `PullRecord[]` using the **same `/api/sync/pull` serving logic** (reference_change_log dedup-to-latest + the S3 bulk drain), sign with the central private key, `toCursor` = the head served. No central-side cursor advance (serving is stateless).
- **`importPullBundle(ctx, buf): { applied, toCursor }`** (lab side): `verifyBundle` against the pinned `sync.central_public_key` → **contiguity guard**: refuse (typed `BundleGapError`) when `manifest.fromCursor > cursor('sync-pull')` (a skipped bundle) so reference/terminology never applies out of order (mirrors the S3 cursor-hold) → apply via the S2/S3 apply paths (`applyReferenceChange` / `syncSystem` / `syncConceptMap`, bulk records hold-on-failure as in S3) → advance `'sync-pull'` to `toCursor`.

New `sync_sites.reported_pull_cursor bigint` column (nullable; the piggybacked position). Typed errors: `BundleSignatureError`, `BundleGapError`, `BundleFormatError`, plus reuse S4d's `SiteNotFoundError` for unknown-site import.

### 4. Cursors & the mix-freely invariant

Bundles share the **same** `'sync-push'`/`'sync-pull'` cursors as HTTP, which is what lets a lab alternate transports without gaps or double-apply:
- **Push:** whichever transport runs advances the shared `'sync-push'`; central's `applyRemote` idempotency makes any overlap a safe no-op. A lost push bundle is recovered with `sync export --from <seq>` (re-export a range).
- **Pull:** central learns each lab's pull position **only** via the piggybacked `pullCursor` on imported push bundles (persisted to `sync_sites.reported_pull_cursor`); its pull-export starts there, or from 0 (full snapshot) if never heard. The lab advances `'sync-pull'` on pull-import. The contiguity guard prevents an out-of-order pull bundle from regressing reference state.
- Because central's pull serving already dedups to latest-per-entity and terminology does whole-system replace, a **full-snapshot** pull bundle (the never-heard fallback) is correct, just larger.

### 5. CLI surface (`@openldr/cli`)

Mirror the S4d/S4c `sync` command idiom (`createAppContext(loadConfig())` → `finally ctx.close()`, `emit`, `redactError`, `process.exitCode`):
- `openldr sync export [--kind push|pull] [--site <id>] [--from <seq>] [--out <file>] [--json]` — `--kind` defaults by role of the instance (a lab exports `push`, central exports `pull`); `--site` required for a central pull export; `--out` defaults to a timestamped filename in cwd. Prints the manifest summary (kind, siteId, cursor range, record count, output path); `--json` emits it.
- `openldr sync import <file> [--json]` — detects `kind` from the manifest, verifies, applies, prints `{applied, cursorRange}`. Maps `BundleSignatureError`/`BundleGapError`/`BundleFormatError`/`SiteNotFoundError` to exit 1 with a clear message.

No secret is ever printed by export/import (the signing private key lives in config, not in bundle output).

### 6. Testing

- **Unit:** `bundle.ts` round-trip (`writeBundle`→`readBundle` equality; `verifyBundle` accepts a good signature, throws on a flipped byte / wrong key / truncated payload); the four orchestrations with fake stores + real pg-mem cursors (push export delta + cursor advance + piggyback; push import idempotent + cross-site reject + unknown-site reject; pull export from reported cursor + full-snapshot fallback; pull import contiguity guard + apply + advance); enrollment key-exchange (public key stored, private + central-public returned once, never persisted; rotate re-mints).
- **Live acceptance `pnpm sync:bundle:accept`** (extends the S5-style two-instance harness `sync:e2e`, needs the dev Keycloak + two PG DBs, skips clean otherwise): enroll-with-keys → lab `exportPushBundle` → file on disk → central `importPushBundle` (assert mirrored at origin version + `site_id` stamped + **tampered bundle rejected** + **wrong-key rejected** + **replay idempotent**) → central `exportPullBundle` from the piggybacked cursor → file → lab `importPullBundle` (assert reference form/dashboard + a terminology system applied, `managed_origin='central'`) → **gap bundle refused** (skip a range) → cleanup.
- **Regression:** the S1–S4d acceptance harnesses (`sync:accept`, `sync:pull:accept`, `sync:terminology:accept`, `sync:enroll:accept`, `sync:e2e`) must still pass — S5 touches shared `@openldr/sync`, `@openldr/bootstrap`, the enrollment orchestrator, and `sync_sites`.

## Deliberate shortcuts / deferrals

- Push export advances the shared `'sync-push'` cursor optimistically (no ack); a lost bundle is recovered via `--from`. Documented; no automatic retransmit.
- Central→lab pull is a **per-site** bundle whose content is drawn from the global reference stream; a never-heard site gets a full snapshot (larger file). No delta compaction beyond gzip this slice.
- Central signing keypair is single and unrotated in v1; site keys rotate via `sync rotate`. Central-key rotation → later.
- No UI; CLI-first. Bundle transport medium (USB, email, object storage) is out of band — S5 only reads/writes a local file path.
- Bundles are signed but NOT encrypted (integrity + authenticity, not confidentiality); operational data at rest on the courier medium is the operator's responsibility (documented — encryption-at-transport is a possible S7 add).

## Build order (implementation plan will detail)

1. Bundle module (`@openldr/sync/bundle.ts`) + unit tests (format + sign/verify), reusing marketplace ed25519 + `canonicalJson`.
2. Enrollment key-exchange extension: migration (`sync_sites.signing_public_key` + `reported_pull_cursor`), central keypair ensure, `enrollSite`/`rotateSite` mint + return keys, `EnrollResult` fields, lab-side config keys + Sync-card/CLI settings inputs.
3. Export/import orchestrations in `@openldr/bootstrap` (reuse S1 safe-frontier + S2/S3 serve+apply), typed errors.
4. CLI `sync export|import`.
5. Live acceptance `sync:bundle:accept` + regression sweep + whole-slice review + merge (+ push on user go).

## Relates to

[[distributed-sync-central-workstream]] (parent; S5 = the store-and-forward slice), S4d enrollment (extended here for key exchange), [[marketplace-crlf-signature]] / the marketplace signing + trust-store infra (ed25519 reuse), [[cli-operator-parity]] (`sync export|import` CLI parity), [[fhir-storage-restructure-workstream]] (`change_log` + `applyRemote` the bundles carry/apply).
