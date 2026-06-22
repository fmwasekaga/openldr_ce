# Phase 3 SP-1 — Artifact Model + Manifest + Signing/Verification + Capability Model (Design)

**Date:** 2026-06-22
**Status:** Approved for planning
**Phase 3 context:** Second sub-project of Phase 3 (Ecosystem & Extensibility). SP-1 builds the **security spine** — the artifact model, manifest, signing/verification, publisher trust, capability declaration, and compatibility gate that everything else in the marketplace depends on. SP-0 (Settings shell + DHIS2 relocation) is merged. The marketplace UI (SP-4) and registry lifecycle (SP-2) build on this.

## 1. Goal

Generalize the existing plugin manifest into a signed, versioned, capability-declaring **artifact** model, and prove the spine end-to-end by wiring signature verification + compatibility gating + capability/publisher recording into the existing plugin install path. Backend/crypto/schema only — no UI.

PRD requirements covered: **P3-ART-1/2/3** (artifact model, manifest, self-contained bundles), **P3-SEC-1** (signing & verification), **P3-SEC-2** (capability *declaration* — runtime enforcement deferred to SP-2), **P3-SEC-4** (compatibility gate), **P3-SEC-5** (lifecycle audit for install).

## 2. Resolved open decisions (from the PRD §6)

- **Signing/trust:** publisher self-signed (Ed25519) + **trust-on-first-use (TOFU)**. Admin pins the publisher key fingerprint on first install; subsequent artifacts verify against the pinned key. Dev-override config flag allows unsigned artifacts for local development. No central CA.
- **Federation:** local-first only in SP-1, but **design hooks now** — the manifest carries a `source` field (`'local-file' | 'registry'`, extensible to `'federated'`) and the trust model is source-agnostic. Federation transport is SP-6.
- **Artifact types:** the model supports `plugin | form-template | report-template` from the start (extensible to terminology/dhis2-mapping bundles later), but SP-1 only wires the concrete install pipeline for **plugins**. Capabilities are plugin-specific; forms/reports are passive data artifacts.
- **Capabilities:** **fine-grained** typed/parameterized set (see §6).
- **Monetization:** none. The manifest carries a `license` string; any-license artifacts are permitted. No payment/licensing-key machinery in Phase 3.

## 3. Current state (what SP-1 extends)

- `packages/plugins/src/manifest.ts` — `pluginManifestSchema` (zod): `id`, `version`, `entrypoint` (default `'convert'`), `wasmSha256`, `description`, `license` (default `'UNLICENSED'`), `wasi` (bool), `limits { memoryMb=256, timeoutMs=30000 }`. No signature, capabilities, publisher, compatibility, or dependencies.
- `packages/plugins/src/runtime.ts` — `PluginRuntime.install(wasm, rawManifest)`: parses the manifest, computes `sha256Hex(wasm)`, verifies it equals `manifest.wasmSha256`, upserts to the store (`status: 'installed'`), logs. `loadAndRun` re-verifies sha256 on load.
- `packages/plugins/src/store.ts` — `PluginStore` over internal PG (`plugins` table: id, version, sha256, manifest JSON, status). Migration `004_plugins`.
- Internal migrations run to `022_*`; **next is `023`**.
- Audit foundation: `packages/audit` (`record`/`safeRecord`), wired through `apps/server`. CE version = `0.1.0` (root + `apps/server` `package.json`).
- Node `crypto` supports Ed25519 (`generateKeyPairSync('ed25519')`, `sign`/`verify` with `null` algorithm for Ed25519). No external crypto dependency needed.

## 4. New package: `packages/marketplace`

Owns the Phase-3 backend domain (artifact model + security now; registry lifecycle in SP-2). Dependencies: `zod`, Node `crypto`, and `@openldr/db` (for the trust-store Kysely types) only. `packages/plugins` gains a dependency on `@openldr/marketplace`. `depcruise` rules updated to allow `plugins → marketplace` and keep `marketplace` from importing app/server code.

File structure (each file one responsibility):
- `src/artifact-manifest.ts` — the `artifactManifestSchema` (zod) + `ArtifactManifest` type + `parseArtifactManifest`.
- `src/capabilities.ts` — the capability discriminated-union schema + `Capability` types + `parseCapabilities`.
- `src/bundle.ts` — bundle type + `canonicalSigningBytes(manifestWithoutSignature, payloadSha256)` (deterministic).
- `src/signing.ts` — `generatePublisherKeypair()`, `signManifest()`, `verifyArtifact()` (Ed25519), `keyFingerprint(publicKey)`.
- `src/trust.ts` — `TrustStore` interface + `evaluateTrust()` (pure TOFU decision).
- `src/trust-store.ts` — Kysely-backed `TrustStore` over the new `marketplace_publishers` table.
- `src/compatibility.ts` — `isCompatible(ceVersionRange, runningCeVersion)` (semver).
- `src/index.ts` — barrel.
- co-located `*.test.ts` per file.

## 5. Artifact manifest schema (P3-ART)

```ts
const artifactManifestSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.enum(['plugin', 'form-template', 'report-template']),
  id: z.string().min(1),
  version: z.string().regex(SEMVER),                 // artifact's own semver
  description: z.string().default(''),
  license: z.string().default('UNLICENSED'),
  publisher: z.object({
    id: z.string().min(1),
    name: z.string().default(''),
    keyFingerprint: z.string().regex(/^[0-9a-f]{64}$/), // sha256 of the public key (DER)
  }),
  compatibility: z.object({ ceVersion: z.string().min(1) }), // semver range, e.g. ">=0.1.0 <0.2.0"
  dependencies: z.array(z.object({ id: z.string().min(1), versionRange: z.string().min(1) })).default([]),
  capabilities: z.array(capabilitySchema).default([]),
  source: z.enum(['local-file', 'registry']).default('local-file'), // 'federated' reserved
  payload: payloadSchema,        // discriminated by `type` — see below
  signature: z.string().regex(/^[0-9a-f]+$/).optional(), // hex Ed25519 sig; absent only with dev-override
});
```

`payload` is a discriminated union on `type`:
- `plugin` → `{ wasmSha256, entrypoint='convert', wasi=false, limits{ memoryMb=256, timeoutMs=30000 } }` (carries today's `pluginManifestSchema` fields, so existing plugins map via a thin adapter).
- `form-template` → `{ questionnaireSha256 }` (the FHIR Questionnaire JSON hash). Modeled now; wiring deferred.
- `report-template` → `{ templateSha256 }`. Modeled now; wiring deferred.

`parseArtifactManifest(raw)` validates and returns `ArtifactManifest`. A `pluginManifestToArtifact()` adapter converts a legacy `PluginManifest` to a `type:'plugin'` artifact manifest (publisher/signature optional under dev-override) so the existing install path and fixtures keep working.

## 6. Capability model (P3-SEC-2 declaration — fine-grained)

A discriminated union on `kind`; declaration only (enforcement is SP-2). Each member carries fine-grained params:

```ts
const capabilitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('read-input'),  formats: z.array(z.string().min(1)).default([]) }),
  z.object({ kind: z.literal('emit-fhir'),   resourceTypes: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal('net-egress'),  allowedHosts: z.array(z.string().min(1)).default([]) }), // host[:port], scheme-qualified; default deny-all
  z.object({ kind: z.literal('data-scope'),  resourceTypes: z.array(z.string().min(1)).default([]), fields: z.array(z.string().min(1)).default([]) }),
]);
```

**Where each is enforced (documented now, wired in SP-2):**
- `net-egress.allowedHosts` → Extism `allowed_hosts` at runner-config time (host-enforceable).
- `emit-fhir.resourceTypes` → host-side check at persist: reject emitted resources whose `resourceType` is not in the allowlist.
- `data-scope.resourceTypes/fields` → host-side filtering when a plugin reads store data (no current plugin reads the store; reserved + validated).
- `read-input.formats` → advisory/declarative for SP-1.

`parseCapabilities(raw)` validates. The set is bounded (a structured schema, not an open policy language); new kinds are added as new union members.

## 7. Bundle + canonical serialization (P3-ART-3)

An artifact bundle = a manifest + its payload bytes (e.g. the wasm). Signing/verification operate over deterministic **canonical signing bytes**:

```
canonicalSigningBytes = utf8( canonicalJSON(manifest without `signature`) ) || ":" || payloadSha256
```

`canonicalJSON` sorts object keys recursively and uses no insignificant whitespace, so the bytes are stable across serializations. `payloadSha256` is the lowercase-hex SHA-256 of the payload bytes (for plugins, the wasm — identical to today's `wasmSha256`). This binds the signature to both the manifest and the exact payload.

## 8. Signing & verification (P3-SEC-1)

Node `crypto`, Ed25519:
- `generatePublisherKeypair() → { publicKeyDer, privateKeyDer, fingerprint }` — `fingerprint = sha256hex(publicKeyDer)`.
- `signManifest(manifest, payloadSha256, privateKeyDer) → signatureHex` — signs `canonicalSigningBytes`.
- `verifyArtifact(manifest, payloadSha256, publicKeyDer) → boolean` — verifies `manifest.signature` over `canonicalSigningBytes`.
- The publisher's public key travels with the artifact at install (out-of-band for SP-1: provided alongside the bundle); `keyFingerprint(publicKeyDer)` must equal `manifest.publisher.keyFingerprint` or verification fails.

Tampering with manifest or payload changes the canonical bytes → signature fails. Unsigned (`signature` absent / no public key) → rejected unless the dev-override config flag is set.

## 9. Publisher trust store + TOFU (P3-SEC-1/3 data model)

New internal migration `023_marketplace_publishers.ts`:

```
marketplace_publishers (
  publisher_id text not null primary key,
  key_fingerprint text not null,
  publisher_name text not null default '',
  pinned_at timestamptz not null default now(),
  approved_by text                       -- actor id; null when pinned non-interactively
)
```

`TrustStore` interface: `get(publisherId)`, `pin({ publisherId, keyFingerprint, publisherName, approvedBy })`. Kysely impl in `trust-store.ts`.

Pure decision function:
```ts
evaluateTrust(publisherId, fingerprint, pinned?: { keyFingerprint }) =>
  | { decision: 'first-use' }                       // no pinned record — caller may pin after consent
  | { decision: 'trusted' }                         // pinned fingerprint matches
  | { decision: 'key-mismatch', pinned: string }    // pinned fingerprint differs — reject
```

The interactive **consent** step and the act of pinning during install lifecycle are SP-2 (registry) / SP-4 (UI); SP-1 provides the store, the decision function, and uses them in the plugin-install integration (§11) with non-interactive auto-pin-on-first-use guarded by config (so tests and the existing install path work).

## 10. Compatibility gate (P3-SEC-4)

`isCompatible(range: string, running: string): boolean` — semver range satisfaction (e.g. `">=0.1.0 <0.2.0"` against `0.1.0`). Use a tiny internal semver-range check (no new dep if a satisfies-helper already exists in the repo; otherwise a minimal comparator covering `>=`, `<`, `||`, exact, and `*`). The running CE version is sourced once from `apps/server` `package.json` `version` and threaded through config/bootstrap as `ceVersion`. Incompatible → install rejected with a clear error.

## 11. Integration: augment `PluginRuntime.install` (P3-SEC-1/4/5)

`createPluginRuntime` gains deps: `trustStore`, `ceVersion`, `verifyConfig { devAllowUnsigned: boolean, autoPinFirstUse: boolean }`, and an optional `audit` recorder. New install signature accepts an artifact manifest (the legacy `(wasm, rawManifest)` path adapts via `pluginManifestToArtifact`). Install sequence:

1. Parse artifact manifest (`parseArtifactManifest`).
2. Compute `payloadSha256 = sha256Hex(wasm)`; verify it equals `payload.wasmSha256` (existing check).
3. **Signature:** if signed, `verifyArtifact(...)` against the provided public key (whose fingerprint must match `publisher.keyFingerprint`); if unsigned, require `devAllowUnsigned` or reject.
4. **Trust:** `evaluateTrust(publisher.id, fingerprint, await trustStore.get(...))`. `key-mismatch` → reject. `first-use` → pin (when `autoPinFirstUse`) recording `approvedBy`. `trusted` → proceed.
5. **Compatibility:** `isCompatible(compatibility.ceVersion, ceVersion)` or reject.
6. Upsert plugin (existing store; persist the declared `capabilities` + `publisher` alongside the manifest JSON — no schema change needed since `manifest` is JSON).
7. **Audit:** `safeRecord` a `marketplace.install` event (artifact id/version/type, publisher id/fingerprint, granted capabilities) tied to the actor.

`loadAndRun` is unchanged in SP-1 (still re-verifies sha256). Runtime capability *enforcement* (allowed_hosts wiring, emit-fhir allowlist at persist) is SP-2.

## 12. Config additions

`packages/config` schema: `MARKETPLACE_DEV_ALLOW_UNSIGNED` (bool, default `false`), `MARKETPLACE_AUTO_PIN_FIRST_USE` (bool, default `true` for SP-1 non-interactive installs; SP-2 replaces auto-pin with consent). Surface `ceVersion` to bootstrap.

## 13. Testing

- `artifact-manifest.test.ts` — valid manifests per type parse; bad semver/fingerprint/missing publisher rejected; `pluginManifestToArtifact` adapter round-trips a legacy manifest.
- `capabilities.test.ts` — each capability kind validates with its params; unknown kind rejected; `emit-fhir` requires ≥1 resourceType.
- `bundle.test.ts` — `canonicalJSON` is key-order-stable; `canonicalSigningBytes` deterministic; differs when manifest or payloadSha256 changes.
- `signing.test.ts` — keypair gen; sign→verify round-trip succeeds; tampered manifest fails; tampered payloadSha256 fails; wrong key fails; fingerprint mismatch fails.
- `trust.test.ts` — `evaluateTrust` returns first-use / trusted / key-mismatch correctly.
- `trust-store.test.ts` — pin + get via pg-mem (repo migration-test pattern).
- `compatibility.test.ts` — ranges satisfied/violated incl. `||`, exact, `*`.
- `023_marketplace_publishers` migration test (pg-mem).
- `runtime.test.ts` (extended) — install: valid-signed succeeds + pins + audits; unsigned rejected unless dev-override; key-mismatch rejected; incompatible rejected; capabilities+publisher persisted; `marketplace.install` audit emitted. Existing plugin tests/fixtures keep passing via the adapter.

## 14. Verification

Full gate: `pnpm turbo typecheck lint test build && pnpm depcruise` (depcruise rules updated for the new package edge). All green.

## 15. Out of scope (SP-1)

Registry lifecycle (install/update/rollback/enable-disable/remove as user operations), consent **UI**, runtime capability **enforcement** (allowed_hosts wiring, emit-fhir allowlist at persist, data-scope filtering), CLI `artifact build/test/sign/publish` and `market *` UX, concrete form-template/report-template install wiring, federation transport, Marketplace UI.

## 16. Risks / notes

- **Legacy compatibility:** existing plugins (`wasm/*`) and their fixtures use the old `pluginManifestSchema`. The `pluginManifestToArtifact` adapter + `devAllowUnsigned`/`autoPinFirstUse` defaults keep them installable without re-signing; a follow-up (SP-3 publish flow) signs them properly.
- **Canonical JSON** must be genuinely deterministic (recursive key sort, stable number/string encoding) or signatures break across environments — covered by tests.
- **`depcruise`**: add the `plugins → marketplace` allowed edge and forbid `marketplace → apps/*`.
- **Enforcement gap is intentional:** SP-1 records and gates at install; it does not yet stop a running plugin from exceeding its grant. That is SP-2 and must land before untrusted third-party plugins run in production — call this out in the SP-2 spec.
