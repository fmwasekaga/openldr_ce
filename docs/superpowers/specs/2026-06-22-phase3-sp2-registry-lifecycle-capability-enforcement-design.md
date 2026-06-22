# Phase 3 SP-2 — Registry Lifecycle + Consent + Runtime Capability Enforcement (Design)

**Date:** 2026-06-22
**Status:** Approved for planning
**Phase 3 context:** Third sub-project of Phase 3. SP-1 (merged, `41609cf`) built the artifact model, Ed25519 signing, TOFU publisher trust, and capability *declarations*, and gates them at install — but it does **not** persist the granted capabilities, run lifecycle operations, take explicit consent, or enforce capabilities at runtime. SP-2 closes all four gaps. The Marketplace UI + HTTP API remain SP-4.

## 1. Goal

Make installed marketplace artifacts (plugins) **governable and contained**: persist the approved capability grant, support the full install/update/rollback/enable-disable/remove lifecycle, require explicit admin consent on install, and **enforce** granted capabilities while a plugin runs. Prove it end-to-end with a live-acceptance run against the `openldr-ce-marketplace` repo. Backend + CLI only.

PRD requirements covered: **P3-REG-1/2/3** (offline registry lifecycle, live registration, version management/rollback), **P3-SEC-2** (runtime capability enforcement — the Extism sandbox enforces only granted capabilities), **P3-SEC-3** (consent on install, grants recorded), **P3-SEC-5** (lifecycle audit for update/enable/disable/remove/rollback).

## 2. Resolved decisions

- **Decomposition:** one combined SP-2 spec (lifecycle + persistence + consent + enforcement + live acceptance).
- **Consent:** explicit approve — `install` takes an approval (approver + acknowledged capabilities); the granted set + approver + timestamp are persisted. No interactive preview in SP-2 (that's SP-4).
- **Enforcement failure mode:** **fail closed** — a plugin emitting outside its `emit-fhir` grant rejects the whole conversion batch with a clear error + audit event.
- **Live testing:** full live acceptance now, against `../openldr-ce-marketplace` (local sibling + private GitHub repo `fmwasekaga/openldr-ce-marketplace`).

## 3. Current state (what SP-2 changes)

- `packages/plugins/src/store.ts` — `PluginStore` over the `plugins` table (id, version, sha256, manifest JSON, status, installed_at). `get(id)` returns the **highest** version with `status='installed'`. `upsert` writes `status:'installed'`.
- `packages/plugins/src/runtime.ts` — SP-1 `install(wasm, rawManifest, opts)` verifies signature + TOFU + compat and persists `artifactToPluginManifest(artifact)` (the **stripped legacy** manifest — capabilities dropped). `load(id)` → `createWasmConverter(row.manifest, wasm, runner, logger)`. `verifyConfig.autoPinFirstUse` auto-pins non-interactively.
- `packages/plugins/src/wasm-converter.ts` — `createWasmConverter(manifest, wasm, runner, logger)`; `parseNdjson` validates each emitted resource via `@openldr/fhir` `validateResource` and throws on invalid. This is where `emit-fhir` enforcement hooks.
- `packages/plugins/src/extism-runner.ts` — `createExtismRunner`; leaves Extism `allowedHosts` unset (default-deny). `RunOptions` (in `runner.ts`) = `{ entrypoint, wasi, memoryMb, timeoutMs, config, host }` — no `allowedHosts`.
- `packages/marketplace` — exports `parseArtifactManifest`, `verifyArtifact`, `keyFingerprint`, `evaluateTrust`, `isCompatible`, `createTrustStore`, capability types, `canonicalSigningBytes`, etc. SP-2 adds registry + signing helpers for bundles here.
- Internal migrations run to `023`; **next is `024`**.
- CLI (`packages/cli`) has command groups (e.g. `dhis2 …`). SP-2 adds a `market …` group.
- `scripts/mssql-live-acceptance.ts` + `package.json` `mssql:accept` script are the pattern for the new `marketplace:accept` harness.

## 4. Capability persistence

The `plugins.manifest` JSON column will store the **full artifact manifest** (with `capabilities` + `publisher`) rather than the stripped legacy manifest. Migration **`024_plugin_registry`** adds to `plugins`:
- `enabled` boolean not null default true
- `active` boolean not null default true (exactly one true per `id`)
- `approved_by` text (null for system/first-party installs)
- `granted_at` timestamptz null

`PluginsTable` (in `packages/db/src/schema/internal.ts`) gains these columns. The store's `manifest` type widens to `ArtifactManifest | LegacyPluginManifest` (both are `Record<string, unknown>` at the column level). A helper `readGrant(manifest)` returns `{ capabilities: Capability[] } | { legacy: true }` — capabilities present ⇒ a marketplace artifact (enforced); absent ⇒ legacy (unrestricted).

## 5. Consent on install (P3-SEC-3)

`install(wasm, rawManifest, opts)` `opts` gains `approval?: { approvedBy: string; acknowledgedCapabilities: Capability[] }`. Rules:
- **Publisher-bearing artifact:** `approval` is **required**; the acknowledged set must equal the manifest's requested capabilities (mismatch ⇒ reject — admin must approve exactly what's requested). Persist `approved_by = approval.approvedBy`, `granted_at = now()`, and the full artifact manifest. Replaces `autoPinFirstUse` (TOFU pinning now happens as part of an approved install, recording the approver).
- **Legacy / no-publisher (first-party bundled) artifact:** no `approval` needed; installs with `approved_by = null` (system), unrestricted at runtime. Back-compat for the bundled `wasm/*` plugins and existing CLI `plugin install`.
- `verifyConfig.autoPinFirstUse` is removed; `devAllowUnsigned` stays (dev escape hatch for unsigned publisher-bearing artifacts; such installs persist `signatureVerified:false`, already in the SP-1 audit metadata, and still require `approval`).

## 6. Runtime enforcement (P3-SEC-2)

Granted capabilities flow `load()` → `createWasmConverter` → `runner.run`. `createWasmConverter` gains a `grant: Capability[] | undefined` param (undefined ⇒ legacy/unrestricted):

- **`emit-fhir`** — in `parseNdjson` (or a wrapping check), if the grant declares capabilities: collect the allowed `resourceTypes` from the `emit-fhir` capability (none ⇒ empty allowlist). Any emitted resource whose `resourceType` is not allowed ⇒ **throw** `PluginCapabilityError` (fail closed: the batch fails via existing ingest error handling). The runtime records a `marketplace.capability.violation` audit event (artifact id/version, offending resourceType).
- **`net-egress`** — `RunOptions` gains `allowedHosts: string[]`; `extism-runner` passes it to `createPlugin`'s `allowedHosts`. The converter derives `allowedHosts` from the grant's `net-egress` capability (absent ⇒ `[]` ⇒ no egress). Extism enforces; the plugin's outbound calls to non-allowlisted hosts fail inside the sandbox.
- **`data-scope`** — validated, reserved; no store-reading plugin exists, so no read-path filtering is built (documented; YAGNI).
- **Back-compat seam:** enforcement is active only when `readGrant(manifest)` reports capabilities (a marketplace artifact). Legacy manifests (no `capabilities`) run unrestricted, exactly as today. An artifact that declares `capabilities: []` can emit nothing and egress nowhere.

## 7. Registry lifecycle (P3-REG)

Registry operations on the `plugins` table, each emitting a lifecycle audit event:
- **install / update** — `update` is install of a newer version. The newly installed version becomes `active`; all other versions of that `id` are set `active=false`. (`update` audited as `marketplace.update` when a prior version existed, else `marketplace.install`.)
- **rollback(id, version)** — set that version `active=true`, others for the id `active=false`. Rejects if the version isn't installed. Audited `marketplace.rollback`.
- **enable/disable(id)** — toggle `enabled` for the id's active row. Disabled ⇒ `load(id)` returns undefined (runtime won't run it). Audited `marketplace.enable`/`marketplace.disable`.
- **remove(id, version?)** — delete row(s); if the active version is removed, no version is active until a reinstall/rollback. Audited `marketplace.remove`.
- **`load(id)`** changes semantics: returns the row where `active=true AND enabled=true` for the id (was: highest version). The ingest plugin resolver (`plugins.load(id)`) inherits this.

## 8. CLI (`market` group, agent-operable, all `--json`)

In `packages/cli`: `market verify <bundleDir>` (parse manifest + verify signature against the bundled publisher key; report capabilities + compatibility, no install), `market install <bundleDir> --approve --approved-by <actor>` (verify + consent + install), `market list`, `market update <bundleDir> --approve --approved-by <actor>`, `market rollback <id> <version>`, `market enable <id>`, `market disable <id>`, `market remove <id> [version]`. A **bundle** is a directory containing `manifest.json`, the payload (`plugin.wasm`), and `publisher.pub` (the publisher SPKI DER public key, hex or base64). The CLI reads the public key from the bundle for verification. `--approve` without `--approved-by` defaults the approver to the CLI actor identity (`cli`).

## 9. Live acceptance (full) — `openldr-ce-marketplace`

A `scripts/marketplace-live-acceptance.ts` + `package.json` `marketplace:accept` script (pattern: `mssql:accept`). Setup (committed to the `openldr-ce-marketplace` repo): a **signed bundle** built from an existing wasm plugin (`wasm/whonet-sqlite` or `tabular`) — `manifest.json` (publisher set, `emit-fhir` grant deliberately narrow, e.g. `["Patient"]`), `plugin.wasm`, `publisher.pub`; the matching private key kept in the harness/test fixtures (not the public repo). The harness, against internal PG (:5433):
1. `market verify` the bundle — asserts valid signature + reports the narrow grant.
2. `market install --approve` — asserts publisher pinned, grant persisted (`approved_by`, capabilities in the row).
3. Tamper the bundle (flip a manifest byte / wasm byte) — `market install` asserts **rejection**.
4. Run an ingest through the installed plugin that emits a resource type **outside** the `["Patient"]` grant (whonet emits Specimen/Observation) — asserts the batch **fails closed** and a `marketplace.capability.violation` audit event is recorded.
5. Reinstall with a **widened** grant (`["Patient","Specimen","Observation","DiagnosticReport"]`, as an `update`) — asserts the same ingest now **succeeds**.
6. `market rollback` to the narrow version — asserts the narrow grant is active again; `market disable` — asserts `load` returns nothing; `market enable` — restored.

The harness is documented as a manual/CI acceptance run (needs internal PG + the built wasm), not part of the default unit gate.

## 10. Testing

- `024_plugin_registry` migration test (pg-mem): columns exist, defaults applied.
- store tests: `active`/`enabled` transitions, `load` returns active+enabled, rollback flips active, multi-version retention.
- runtime tests: consent required for publisher artifacts / recorded / legacy bypass; install sets active + deactivates prior; update/rollback/enable/disable/remove audit events; capability grant persisted + round-tripped.
- enforcement tests: `createWasmConverter` with an `emit-fhir` grant rejects a disallowed `resourceType` (fail closed) and allows in-grant types; legacy (no grant) unrestricted; `capabilities:[]` denies all; `net-egress` allowedHosts threaded into `runner.run` (assert via a fake runner capturing `RunOptions.allowedHosts`).
- CLI tests for the `market` commands (`--json` output, error paths) following the existing CLI test pattern.
- Live acceptance (§9) — separate harness, not in the unit gate.

## 11. Verification

Full gate: `pnpm turbo typecheck lint test build && pnpm depcruise` — all green. Plus the `marketplace:accept` live run against internal PG + the signed bundle in `openldr-ce-marketplace`.

## 12. Out of scope (SP-4+)

Marketplace **UI + HTTP API** routes, interactive consent/preview screen, forms/reports artifact registration & lifecycle, federation transport (P3-FED), hard memory-limit enforcement (Extism 1.0.3 SDK limitation — documented in `extism-runner.ts`), and signing/scaffolding **authoring** CLI (`artifact build/sign/publish`, `plugin/form/report new` — P3-PUB, SP-3).

## 13. Risks / notes

- **`load()` semantic change** (highest-version → active+enabled) affects the ingest plugin-resolution path. Existing tests that install one version and load it are unaffected (a single installed version is active). New tests cover multi-version/rollback.
- **Manifest column now holds the artifact manifest.** Existing rows (pre-SP-2) hold legacy manifests; `readGrant` treats them as unrestricted. The `whonet`/`tabular`/`hl7v2` bundled plugins (installed via legacy `plugin install`) keep working.
- **Live acceptance needs a real signed bundle.** Signing an existing wasm with a generated keypair + a narrow grant is the lowest-effort way to exercise fail-closed enforcement without authoring a malicious plugin.
- **Secret hygiene:** the publisher private key used to sign the acceptance bundle must NOT be committed to the public `openldr-ce-marketplace` repo — only `publisher.pub` is published; the private key lives in the harness fixture under the main repo (or is generated at harness runtime).
- **`autoPinFirstUse` removal** changes SP-1's bootstrap wiring; update `packages/bootstrap` to pass an approval path / drop the flag.
