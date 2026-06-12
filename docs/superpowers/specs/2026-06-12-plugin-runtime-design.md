# Plugin Runtime + SDK + WHONET Reference Plugin — Design Spec

**PRD mapping:** §8 build-sequence step 5 — P1-PLUG-1/2/3/4, completing P1-INGEST-3 (resolve + execute the plugin in the WASM sandbox), and the `plugin install|list|run|test` + `ingest --plugin` CLI surface (P1-CLI-1/2).

**Status:** Approved design (2026-06-12). One combined sub-project (runtime + SDK + WHONET reference plugin).

---

## 1. Goal

Replace the `@openldr/plugins` placeholder with a real **Extism/WASM plugin runtime**: sandboxed, any-language format adapters that take an arbitrary input payload, read + validate + convert it to FHIR R4, and slot into the existing ingest pipeline through the `Converter` seam. Ship a permissively-licensed Rust **plugin SDK** and a **WHONET SQLite reference plugin** that proves the model end to end (WHONET SQLite → FHIR R4 AMR data).

## 2. Key decisions (locked during brainstorming)

1. **One combined sub-project** — runtime + SDK + WHONET plugin in a single spec→plan→build cycle.
2. **Rust + LLVM, real SQLite** — the reference plugin is authored in Rust and reads SQLite in-sandbox via `rusqlite` (`bundled` feature; SQLite compiled to wasm via clang). PRD-faithful to P1-PLUG-4's "SQLite reader".
3. **Simple NDJSON ABI** — host calls one `convert` export with the raw input bytes; the plugin returns NDJSON (one FHIR resource per line). Host functions limited to `log` and `progress`. No streaming-emit callback ABI (YAGNI).
4. **Lazy resolver + internal `plugins` table** — `plugin install` uploads the wasm to blob and records a table row; at ingest, a `ConverterResolver` tries built-in TS converters first, then lazily loads the installed plugin on demand. The plugin's `version` flows into provenance via the existing `Converter.version` field.

## 3. Architecture & package topology

```
ingest event ──▶ handleIngestEvent ──▶ ConverterResolver.resolve(id)
                                          │  built-in? ── defaultConverters (TS)
                                          └  installed plugin? ── PluginRuntime.load(id)
                                                                     │ fetch wasm from blob (BlobStoragePort)
                                                                     │ verify sha256
                                                                     │ instantiate Extism plugin (WASI, limits)
                                                                     └ WasmPluginConverter (implements Converter)
                                                                          convert(raw) → NDJSON → validate each → FhirResource[]
```

- **`@openldr/plugins`** (fill in the placeholder) — the WASM runtime. Dependencies: `@openldr/ingest` (the `Converter`/`ConverterResolver` types — the seam), `@openldr/fhir` (`validateResource` on emitted resources), `@openldr/ports` (`BlobStoragePort`, injected), `@openldr/core` (`Logger`, `errorMessage`, `redact`), `@openldr/db` (`InternalSchema` type for the plugin store), and `@extism/extism` (host SDK). **Imports no `adapter-*`** — blob access is the injected port — so **DP-1 holds** and `@openldr/bootstrap` stays the only adapter importer.
- **`@openldr/db`** — adds the `plugins` internal table (type on `InternalSchema`) + migration `004_plugins`.
- **`@openldr/ingest`** — adds the `ConverterResolver` interface + `registryResolver` helper; `handle.ts` switches the converter lookup from sync `ConverterRegistry.get` to async `ConverterResolver.resolve`.
- **`@openldr/bootstrap`** — `createIngestContext` builds the plugin runtime + a combined resolver, and exposes plugin admin (`install`/`list`/`test`/`remove`) for the CLI.
- **`@openldr/cli`** — `plugin install|list|run|test|remove` + `ingest --plugin <id>`.
- **`wasm/`** — a top-level Cargo workspace (separate from the pnpm graph): the Rust SDK crate + the WHONET plugin. Build output is a `.wasm` artifact, not a pnpm package.

**Tooling notes:** `@extism/extism` is native-ish → add to `pnpm-workspace.yaml` `allowBuilds`; keep it external in the tsup app bundles (it is not `@openldr/*`, so `noExternal` does not catch it — default-external is correct).

## 4. The plugin contract

### 4.1 Manifest (`manifest.json`, zod-validated on install)
| field | type | notes |
|-------|------|-------|
| `id` | string | converter id, e.g. `whonet-sqlite` |
| `version` | string | semver; ties provenance to the exact build |
| `entrypoint` | string | export name, default `convert` |
| `wasmSha256` | string | hex digest of the artifact; verified on load |
| `description` | string | |
| `license` | string | SPDX id |
| `wasi` | boolean | enable WASI (the WHONET plugin needs it for a temp file); default `false` |
| `limits` | `{ memoryMb?: number; timeoutMs?: number }` | sandbox bounds; defaults `memoryMb=256`, `timeoutMs=30000` |

### 4.2 ABI
- Host calls the `convert` export with the raw input bytes (Extism input).
- Plugin returns **NDJSON**: one FHIR resource JSON object per line. Empty output = zero resources.
- Imported host functions (the only sandbox escape — no fs/net): `log(level: string, msg: string)`, `progress(done: u64, total: u64)`. Wired to the injected `Logger`.

### 4.3 Storage & lifecycle (P1-PLUG-2)
- Blob (artifact store): `plugins/<id>/<version>/plugin.wasm` + `plugins/<id>/<version>/manifest.json`.
- Internal `plugins` table (source of truth for `list`/audit/resolution): `id`, `version`, `sha256`, `manifest` jsonb, `status`, `installed_at`.
- **install**: validate manifest → compute sha256 → cross-check against `wasmSha256` → upload wasm + manifest to blob → upsert table row.
- **load**: read row → fetch wasm from blob → **verify sha256** → instantiate Extism plugin (apply WASI + limits) → wrap as `WasmPluginConverter` (`.id`, `.version` from the row). Cache instantiated plugins by `id@version`.
- **Version resolution:** `store.get(id, version?)` and `runtime.load(id, version?)` resolve the **latest installed version** (highest semver among `status='installed'` rows) when `version` is omitted — so `ingest --plugin whonet-sqlite` always runs the newest installed build while provenance still records the exact resolved version.

## 5. Runtime surface (`@openldr/plugins`)

- `pluginManifestSchema` (zod) + `PluginManifest` type.
- `createPluginStore(db: Kysely<InternalSchema>)` → `{ upsert, get(id, version?), list, remove }` (mirrors `@openldr/ingest`'s `BatchStore`; the *table* lives in `@openldr/db`, the store logic here).
- `createPluginRuntime({ blob, store, logger })` → `{ install(wasm, manifest), list(), test(id), remove(id, version), load(id, version?): Promise<Converter> }`. `load` caches by `id@version`.
- `WasmPluginConverter` (internal) implements `Converter`: `convert(raw, ctx)` → call the Extism `convert` export → read NDJSON → `validateResource` each line (strict: throw on first invalid, like the `questionnaire-response` built-in) → return `FhirResource[]`. Wires `log`/`progress` host functions to `logger`.

## 6. The ingest seam change (`@openldr/ingest`)

- New interface `ConverterResolver { resolve(id: string): Promise<Converter | undefined> }`.
- `handle.ts` `HandleDeps` swaps `converters: ConverterRegistry` → `resolver: ConverterResolver`; lookup becomes `const c = await deps.resolver.resolve(converter)`. Provenance (`c.id`, `c.version`), persist, mark-done/failed are unchanged.
- `registryResolver(registry: ConverterRegistry): ConverterResolver` ships in ingest so the built-in-only path (and existing `pipeline.test.ts`) keep working with a one-line wrap.
- Bootstrap composes a **combined resolver**: built-in `ConverterRegistry` first, else `pluginRuntime.load(id)` (not installed → `undefined`).

## 7. Rust workspace (`wasm/`)

- **`wasm/openldr-plugin-sdk/`** — permissively-licensed SDK (P1-PLUG-3, **Apache-2.0**, vs the AGPL TS core). Wraps the Extism PDK: declares the `log`/`progress` host imports; provides a `convert!`-style entry helper taking a `Fn(&[u8]) -> Result<Vec<serde_json::Value>>` that wires Extism input → NDJSON output; ships thin FHIR builders (Patient, Specimen, Observation with the AST shape) so authors emit valid resources without hand-writing JSON.
- **`wasm/whonet-sqlite/`** — the reference plugin (Apache-2.0 example). Enables WASI; writes the input bytes to a WASI temp file; opens it with `rusqlite` (`bundled`). Maps a **documented subset** of the WHONET isolate schema → FHIR AMR: Patient (demographics), Specimen (type + collection), Observation(s) for organism ID + a handful of antibiotic results with S/I/R interpretation. YAGNI: a representative subset that proves the model, not every WHONET column.

**Toolchain & build:**
- One-time setup (first plan task, run once): install `rustup` + `wasm32-wasip1` target + LLVM/clang (Windows `winget`).
- `pnpm build:plugins` → `cargo build --release --target wasm32-wasip1`, then copy `whonet_sqlite.wasm` + a generated `manifest.json` into `reference-plugins/whonet-sqlite/`. **Not** in the default `pnpm build` (toolchain-gated); standalone.
- A dev-only Node script generates a synthetic `samples/whonet-sample.sqlite` (a few isolate rows) for acceptance.

## 8. Error handling (all roll into DP-7 — batch fails, app never crashes)

- Invalid manifest → install rejected (zod).
- sha256 mismatch on load → throw → batch failed.
- Plugin trap / Extism timeout / memory-limit hit → caught in `WasmPluginConverter.convert` → normal converter error → `handle.ts` marks batch failed + outbox retry/backoff. Sandbox limits from the manifest (defaults 256 MB / 30 s).
- Plugin emits invalid FHIR → `validateResource` throws → batch failed (strict).
- Unknown plugin id → resolver returns `undefined` → "unknown converter" → batch failed.

## 9. CLI surface (`packages/cli/src/plugin.ts` + register in `index.ts`)

- `plugin install <wasm> [--manifest <json>]` — defaults to a `manifest.json` next to the wasm.
- `plugin list [--json]`.
- `plugin test <id> [--json]` — smoke-run the plugin.
- `plugin run <input> --plugin <id> [--json]` — convert a local file and print the FHIR resources, no queue (dev/debug, per PRD).
- `plugin remove <id> [--version <v>]`.
- `ingest <file> --plugin <id>` — `--plugin` sets the converter id (alias of `--converter`), matching the PRD's `ingest <file> [--plugin <id>]`.

All commands emit `--json` (P1-CLI-2).

## 10. Testing & acceptance

**TS unit (hermetic, no toolchain):**
- manifest zod validation; sha256 verify; resolver fallthrough order (built-in beats plugin; unknown → undefined); `WasmPluginConverter` NDJSON-parse + per-resource validation via a fake runner; `registryResolver`.

**Integration (toolchain-gated, docker + cargo-built wasm):**
- `build:plugins` → `plugin install` (blob has wasm + `plugins` row) → `plugin test` → `ingest whonet-sample.sqlite --plugin whonet-sqlite` → Patient/Specimen/Observation persisted with provenance `pluginId=whonet-sqlite` + exact `pluginVersion`; `provenance audit` 0 gaps; corrupt sqlite → batch `failed`, no crash (DP-7).

**Final gate:**
- TS: `pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build` (confirms `@openldr/plugins` imports no `adapter-*`).
- Rust: `cargo build --target wasm32-wasip1` + `cargo test` (separate, toolchain-gated).

## 11. Done criteria (maps to PRD §5.5)

- [ ] Extism/WASM runtime with the defined host-function interface — read input (Extism input), emit FHIR (NDJSON return), `log`, `progress` (P1-PLUG-1).
- [ ] Plugins fetched from blob by id + version; sha256 verified; provenance ties output to the exact plugin version (P1-PLUG-2).
- [ ] Permissively-licensed (Apache-2.0) Rust plugin SDK as a separate crate (P1-PLUG-3).
- [ ] WHONET SQLite reference plugin: read WHONET SQLite → validate → FHIR R4 AMR; proven end-to-end through the live pipeline (P1-PLUG-4).
- [ ] Sandbox isolation enforced (no fs/net host funcs; memory + timeout limits); failures degrade to a failed batch, never an app crash (P1-NFR-2, DP-7).
- [ ] `plugin install|list|run|test|remove` + `ingest --plugin` CLI with `--json` (P1-CLI-1/2).
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build` green; `cargo build --target wasm32-wasip1` succeeds.
