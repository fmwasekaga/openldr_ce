# Phase 3 SP-3 — Publishing & Developer Experience (Design)

**Date:** 2026-06-22
**Status:** Approved for planning
**Phase 3 context:** Fourth sub-project. SP-1 built the signed artifact model + Ed25519 + TOFU trust; SP-2 built the registry lifecycle + consent + runtime capability enforcement + the `market` operator CLI. SP-3 builds the **author side** — scaffold → build → sign → test → publish — so anyone (incl. Claude Code, DP-4) can produce a signed artifact. SP-4 (Marketplace UI) follows.

## 1. Goal

A complete artifact authoring pipeline as a new CLI `artifact` group, reusing the existing crypto/bundle primitives. It must produce signed bundles identical to (and replacing) the throwaway `scripts/make-marketplace-bundle.ts`, give authors a fast pre-publish feedback loop, and demonstrate the full loop live against the `openldr-ce-marketplace` repo. Backend + CLI only.

PRD requirements covered: **P3-PUB-1** (publish flow: package + manifest + sign + publish to local registry), **P3-PUB-2** (scaffolding CLI: `plugin/form/report new`), **P3-PUB-3** (local test harness; agent-operable).

## 2. Resolved decisions

- **Scaffold scope:** plugin authoring end-to-end (new→build→sign→test→publish→install→run); `form`/`report` get lightweight JSON scaffold + sign/pack now, but their *install lifecycle* is a later SP (a scaffolded form/report can be signed/packed but not yet installed).
- **`artifact build`:** a real thin `cargo` wrapper (wasm32-wasip1, reusing `build:plugins`' toolchain env). Toolchain-dependent → integration-tested, not in the unit gate. `pack`/`sign`/`test` also accept a prebuilt wasm, so the unit-testable core never depends on cargo.
- **`artifact test`:** in-process dry-run (run the wasm through the runner with its declared grant, report emitted types + fail-closed violations) — no DB/install.
- **Replace `make-marketplace-bundle.ts`:** reimplement the SP-2 live harness's bundle step on `artifact keygen` + `artifact pack`.

## 3. Current state (what SP-3 builds on)

- `packages/marketplace`: `generatePublisherKeypair`/`signManifest`/`verifyArtifact`/`keyFingerprint` (signing.ts), `parseArtifactManifest`/`artifactManifestSchema`/`pluginManifestToArtifact` (artifact-manifest.ts), `canonicalSigningBytes`/`canonicalJSON` (bundle.ts), `readBundle`/`verifyBundle`/`Bundle` (bundle-fs.ts), `capabilitySchema`/`parseCapabilities`/`readGrant`/`allowedResourceTypes`/`allowedHosts`. No author-side `pack`/scaffold yet.
- `packages/cli`: commander; groups registered in `index.ts` via `program.command('<group>')`; commands get `ctx` from `createIngestContext(loadConfig())`; `--json` via `emit`; errors via `redactError`. Existing groups include `plugin` (install/list/test/run/remove), `market` (verify/install/update/list/rollback/enable/disable/remove).
- `packages/plugins`: `createWasmConverter(manifest, wasm, runner, logger, grant?)` runs a wasm via `PluginRunner` and enforces the grant; `createExtismRunner()` is the real runner.
- Build toolchain: `scripts/build-wasm-plugins.mjs` shells `cargo build -p <crate> --release --target wasm32-wasip1` (env: `CLANG_BIN`/`WASI_SYSROOT`/`CC_wasm32_wasip1`/`AR_wasm32_wasip1`), stages the `.wasm` + a `manifest.json` into `reference-plugins/<id>/`.
- Plugin SDK `wasm/openldr-plugin-sdk` is **path-referenced, unpublished** (`crate-type=["rlib"]`, deps `serde_json`, `extism-pdk` for wasm). A scaffolded external plugin must reference it by git or relative path.
- `scripts/make-marketplace-bundle.ts` (SP-2) hand-builds signed narrow/wide bundles — SP-3 supersedes its bundle logic.

## 4. New CLI: the `artifact` group

Registered in `packages/cli/src/index.ts` as `program.command('artifact')`, implemented in a new `packages/cli/src/artifact.ts` (`runArtifact*` functions) following the existing `market.ts`/`plugin.ts` pattern. All commands support `--json`.

### 4.1 `artifact keygen --out <dir>`
Generate a publisher Ed25519 keypair (`generatePublisherKeypair`); write `<dir>/publisher.priv` (hex PKCS8 DER) and `<dir>/publisher.pub` (hex SPKI DER); print the fingerprint + publisher-id guidance. Refuse to overwrite an existing `publisher.priv` unless `--force` (don't silently clobber a key).

### 4.2 `artifact new <type> <name> [--out <dir>] [--publisher-id <id>]`
`<type>` ∈ `plugin | form | report`. Scaffolds into `<dir>/<name>/` (default `./<name>`):
- **plugin** — a Cargo project: `Cargo.toml` (crate `name`, `crate-type=["cdylib"]`, deps `openldr-plugin-sdk` (git or relative path, configurable via `--sdk-path`/`--sdk-git`), `extism-pdk`, `serde_json`), `src/lib.rs` (a minimal `#[plugin_fn] pub fn convert(input) -> ndjson` emitting one Patient via the SDK), `manifest.json` (artifact manifest: `type:'plugin'`, `id`=name, `version:'0.1.0'`, `compatibility.ceVersion` defaulted, `capabilities:[{kind:'emit-fhir',resourceTypes:['Patient']}]` stub, `payload.kind:'plugin'` with `wasmSha256:''` placeholder), and a `README.md` with the build/sign/publish commands.
- **form** — `manifest.json` (`type:'form-template'`) + `questionnaire.json` (minimal FHIR Questionnaire skeleton).
- **report** — `manifest.json` (`type:'report-template'`) + `report.json` (minimal report-template skeleton).
Scaffold templates live in `packages/cli/src/templates/` (or generated inline); generation is pure + unit-tested (assert the files written + their key contents).

### 4.3 `artifact build <dir>`
- **plugin** — shell `cargo build --release --target wasm32-wasip1` in `<dir>` (env passthrough like `build-wasm-plugins.mjs`), locate `target/wasm32-wasip1/release/<crate>.wasm`, stage it to `<dir>/plugin.wasm`. Toolchain-dependent (integration only).
- **form/report** — validate the JSON payload parses (and, for form, is a Questionnaire) — no compile step.
Reuses the toolchain-env conventions; clear error if `cargo`/target is missing.

### 4.4 `artifact pack <dir> --key <priv> [--out <bundleDir>]`
The core (replaces `make-marketplace-bundle.ts`): read `<dir>/manifest.json` (+ the payload `plugin.wasm`/`questionnaire.json`/`report.json`), compute the payload sha256, fill `payload.<...>Sha256`, set `publisher` from the key's fingerprint (read `publisher.pub` next to `--key`, or derive from the private key), validate via `parseArtifactManifest`, sign the canonical bytes (`signManifest`), and write a complete signed bundle (`manifest.json` + payload + `publisher.pub`) to `<bundleDir>` (default `<dir>/dist/`). Pure (no toolchain) → unit-tested with a fixture wasm/json + a generated key, asserting `verifyBundle` passes and a tamper fails.

### 4.5 `artifact sign <dir> --key <priv>`
Convenience alias of `pack` that signs in place (writes the signature back into `<dir>/manifest.json` + ensures `publisher.pub` is present). Same core as `pack`.

### 4.6 `artifact test <dir> --sample <file>`
Author feedback loop, in-process, no DB: read the (built) `plugin.wasm` + manifest grant; run it through `createWasmConverter(manifest, wasm, createExtismRunner(), logger, grant)` against `<sample>`; report — emitted resource types, whether each is within the `emit-fhir` grant, the `net-egress` allowlist applied, and any fail-closed violation (the exact enforcement error). Exit non-zero on a violation (so authors catch grant mismatches pre-publish). The grant-evaluation/report shaping is unit-tested with a fake runner; the real-wasm path is integration.

### 4.7 `artifact publish <bundleDir> --to <registryDir> [--install] [--approved-by <actor>]`
`readBundle(bundleDir)` + `verifyBundle` (refuse to publish an invalid/tampered bundle); copy the bundle into `<registryDir>/<id>/<version>/` (default the configured marketplace dir). With `--install`, additionally install into the running CE via the SP-2 path (`ctx.plugins.install(wasm, raw, { publicKeyDer, approval })`) — i.e. publish (author) and install (operator) are distinct but chainable. Federation/central catalog is SP-6.

## 5. Author-side helpers in `packages/marketplace`

To keep the CLI thin and the logic unit-testable:
- `packBundle({ dir, payloadFile, privateKeyDer, publicKeyDer })` → writes the signed bundle; returns `{ bundleDir, fingerprint }`. (Wraps sha + manifest fill + `signManifest` + `verifyBundle` self-check + file writes.)
- `scaffold(type, name, opts)` → returns a `{ path: content }` map of files to write (pure; the CLI does the fs writes). Templates as string builders.
These live in new files (`pack.ts`, `scaffold.ts`) + barrel exports. Boundary: `packBundle` writes bundle files using `node:fs` — consistent with the existing `bundle-fs.ts` in this package (depcruise already permits Node builtins here); `scaffold` is pure and returns a `{ path: content }` map (the CLI writes the directory tree). The `cargo` invocation (`artifact build`) lives in the CLI, NOT in `marketplace` — the package never shells out.

## 6. Replace `make-marketplace-bundle.ts`

Reimplement `scripts/make-marketplace-bundle.ts` to call `artifact keygen` (once) + `artifact pack` (narrow + wide) — or invoke `packBundle` directly — so the SP-2 live harness keeps producing the same narrow/wide bundles via the real pipeline. The harness (`marketplace:accept`) is unchanged in behavior.

## 7. Testing

- `pack.test.ts` (marketplace): `packBundle` over a fixture payload + generated key → `verifyBundle` true; tampering the written manifest → `verifyBundle` false; payload sha filled correctly.
- `scaffold.test.ts` (marketplace): `scaffold('plugin'|'form'|'report', name)` returns the expected file set with valid `manifest.json` (parses via `parseArtifactManifest` after a sha placeholder is filled) and, for plugin, a `Cargo.toml` referencing the SDK + a `src/lib.rs` with a `convert` entrypoint.
- `artifact.test.ts` (cli): each `runArtifact*` (keygen/new/pack/sign/test/publish) with mocked ctx/fs where needed — assert `--json` shape, key-overwrite guard, `test` exits non-zero on a grant violation (fake runner emitting an out-of-grant type), `publish` refuses an invalid bundle.
- Integration (not in unit gate): `artifact build` cargo wrapper + `artifact test` real-wasm, exercised by the live demo.

## 8. Live demo (author, run by the user)

`pnpm openldr artifact keygen --out scripts/.marketplace-keys` → `artifact new plugin demo --out tmp` → `artifact build tmp/demo` → `artifact pack tmp/demo --key scripts/.marketplace-keys/publisher.priv` → `artifact test tmp/demo --sample samples/whonet-sample.sqlite` (see grant enforcement) → `artifact publish tmp/demo/dist --to ../openldr-ce-marketplace/bundles/demo --install` → the plugin runs in CE. Documented in the spec; the existing `marketplace:accept` (now backed by `artifact pack`) remains the regression harness.

## 9. Verification

Full gate: `pnpm turbo typecheck lint test build && pnpm depcruise` — all green. Plus the author live demo (§8) and the unchanged `marketplace:accept` harness.

## 10. Out of scope (SP-4+)

Marketplace UI (SP-4), form/report **install lifecycle** (a later SP — SP-3 only scaffolds/signs them), federation/central-catalog publish (SP-6), publishing the SDK to crates.io, and a hosted build service (authors build locally with the toolchain).

## 11. Risks / notes

- **Toolchain dependence:** `artifact build` (plugin) needs the wasm32-wasip1 toolchain + clang/wasi-sysroot, exactly like `build:plugins`. Documented; integration-only. `pack`/`test` accept a prebuilt wasm so most of SP-3 is toolchain-free + unit-tested.
- **SDK reference in scaffolds:** the scaffolded plugin's `Cargo.toml` references `openldr-plugin-sdk` by path/git (configurable). Outside this repo the path won't resolve; document the `--sdk-git`/`--sdk-path` option. A crates.io-published SDK is out of scope.
- **Key hygiene:** private keys never go into a published bundle (only `publisher.pub`); `artifact keygen` refuses to overwrite without `--force`; `scripts/.marketplace-keys/` stays gitignored.
- **`marketplace` stays fs-light:** `packBundle`/`scaffold` operate on buffers/return content; the CLI owns fs + `cargo`. Keeps `depcruise` clean and the package testable without a filesystem. (If `packBundle` needs to write files, it may use `node:fs` like `bundle-fs.ts` already does — acceptable; the `cargo` invocation stays in the CLI only.)
