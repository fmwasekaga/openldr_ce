# Ingestion Plugins — HL7 v2 + CSV/Excel (P2-PLUG) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two Rust/WASM ingestion plugins — `hl7v2` (ORU^R01 + ORM^O01 → FHIR R4) and `tabular` (CSV + Excel `.xlsx`, configurable column→FHIR mapping) — plus a persisted plugin-config channel so the tabular mapping reaches the plugin and survives retries.

**Architecture:** A plugin-config map is threaded through the Extism runner → `WasmConverter` → `ConvertContext` → ingest pipeline, and persisted on `ingest_batches.config`. Two new Rust cdylibs reuse `openldr-plugin-sdk` builders (gaining ServiceRequest + DiagnosticReport). HL7 uses a hand-rolled parser with deterministic OBX classification; tabular uses `csv` + `calamine` driven by a JSON mapping read from Extism config.

**Tech Stack:** TypeScript ESM, Kysely (internal PG), Extism (`@extism/extism` 1.0.3), Rust/wasm32-wasip1 (`extism-pdk`, `serde_json`, `csv`, `calamine`), vitest, cargo test, Docker.

**Spec:** `docs/superpowers/specs/2026-06-14-ingestion-plugins-design.md`.

---

## Key facts (verified in the codebase)

- **Plugin runner** (`packages/plugins/src/runner.ts`): `RunOptions { entrypoint, wasi, memoryMb, timeoutMs, host }`; `PluginRunner.run(wasm, input, opts)`. `extism-runner.ts` calls `createPlugin({ wasm: [{ data }] }, { useWasi, runInWorker:false, functions })` — **no `config` passed today**. `wasm-converter.ts` `createWasmConverter(manifest, wasm, runner, logger)` returns a `Converter` whose `convert(raw, _ctx)` calls `runner.run(...)` and `parseNdjson` (validates each line via `validateResource`).
- **Ingest** (`packages/ingest/src/`): `ConvertContext { source?, batchId }` (`converter.ts`); `Converter.convert(raw, ctx)`. `AcceptInput { data, source, converter, contentType?, filename? }`; `acceptPayload` creates the batch + publishes `{ type:'ingest.received', payload:{ batchId, blobKey, source, converter } }` (`accept.ts`). `handleIngestEvent` (`handle.ts`) reads `{ batchId, blobKey, source, converter }` from the payload, resolves the converter, calls `c.convert(raw, { source, batchId })`, persists, `markDone`, then `deps.audit?.(...)` + `deps.onBatchDone?.(...)`. `BatchStore` (`batch-store.ts`): `IngestBatch { batch_id, source, blob_key, content_type, converter, status, resource_count, attempts, last_error }`; `COLUMNS` array; `create({ batchId, source, blobKey, contentType?, converter })` inserts `status:'received'`; `get`/`list` select `COLUMNS`.
- **Ingest context** (`packages/bootstrap/src/ingest-context.ts`): `republish(batch)` publishes `{ type:'ingest.received', payload:{ batchId: batch.batch_id, blobKey: batch.blob_key, source: batch.source ?? 'cli', converter: batch.converter } }`. Subscribes `ingest.received` → `handleIngestEvent({ blob, persist, resolver, batches, logger, audit, onBatchDone })`.
- **CLI** (`packages/cli/src/ingest.ts`): `runIngest(file, { json, source, converter })` → `ctx.accept({ data, source, converter, filename })`. `runPipelineRetry` → `ctx.republish({ batch_id, blob_key, source, converter })`. Registered in `packages/cli/src/index.ts`.
- **Internal migrations** (`packages/db/src/migrations/internal/`): keyed factory; latest is `009_dhis2_schedules`. `migrations.test.ts` asserts the ordered keys. `IngestBatchesTable` in `schema/internal.ts:31`; table created in `003_ingest_batches.ts`. jsonb inserts use `JSON.stringify(x) as any` (+ eslint-disable), per `dhis2-store.ts`/`audit/store.ts`.
- **WASM build** (`scripts/build-wasm-plugins.mjs`): builds ONLY `whonet-sqlite` (`cargo build -p whonet-sqlite --release --target wasm32-wasip1`) with the clang/wasi-sysroot env (needed for bundled SQLite C), stages `plugin.wasm` + writes `manifest.json` (sha256). `wasm/Cargo.toml` is a workspace; `wasm/whonet-sqlite/Cargo.toml` = `crate-type=["cdylib"]`, deps `openldr-plugin-sdk` (path), `extism-pdk="1"`, `serde_json="1"`. The SDK (`wasm/openldr-plugin-sdk/src/fhir.rs`) has `patient`/`specimen(id, subject_ref, type_code, collected, origin)`/`observation_organism`/`observation_ast` + `to_ndjson`. The `specimen` builder takes an `origin: Option<&str>` (from §7 step 4).
- **Extism config**: `@extism/extism` 1.0.3 `createPlugin(manifestlike, { config })` accepts a `Record<string,string>`; in-plugin `extism_pdk::config::get("key") -> Result<Option<String>>`.
- **HL7/tabular plugins are pure Rust** (no bundled C): they build to `wasm32-wasip1` WITHOUT the clang/wasi-sysroot env. Set `wasi:false` in the manifest; if the runtime errors on missing `wasi_snapshot_preview1` imports, set `wasi:true` (Task 10 verifies).

---

## Task 1: Plugin-config channel in `@openldr/plugins`

**Files:**
- Modify: `packages/plugins/src/runner.ts`
- Modify: `packages/plugins/src/extism-runner.ts`
- Modify: `packages/plugins/src/wasm-converter.ts`
- Modify: `packages/plugins/src/wasm-converter.test.ts`

- [ ] **Step 1: Extend `RunOptions`** — in `packages/plugins/src/runner.ts`, add to `RunOptions`:
```ts
  config?: Record<string, string>;
```

- [ ] **Step 2: Pass config to Extism** — in `packages/plugins/src/extism-runner.ts`, add `config` to the `createPlugin` options object (alongside `useWasi`/`runInWorker`/`functions`):
```ts
          useWasi: opts.wasi,
          runInWorker: false,
          config: opts.config ?? {},
```

- [ ] **Step 3: Forward `ctx.config`** — in `packages/plugins/src/wasm-converter.ts`, change `convert` to pass config into `runner.run` (rename the unused `_ctx` param to `ctx`):
```ts
    async convert(raw: Uint8Array, ctx: ConvertContext): Promise<FhirResource[]> {
      const out = await runner.run(wasm, raw, {
        entrypoint: manifest.entrypoint,
        wasi: manifest.wasi,
        memoryMb: manifest.limits.memoryMb,
        timeoutMs: manifest.limits.timeoutMs,
        config: ctx.config,
        host,
      });
      return parseNdjson(out);
    },
```

- [ ] **Step 4: Write a failing test** — append to `packages/plugins/src/wasm-converter.test.ts` (it uses a fake `PluginRunner`; mirror its setup):
```ts
  it('passes ctx.config through to the runner', async () => {
    let seen: Record<string, string> | undefined;
    const runner: PluginRunner = {
      async run(_wasm, _input, opts) { seen = opts.config; return new TextEncoder().encode(''); },
    };
    const conv = createWasmConverter(manifest, new Uint8Array(), runner, logger);
    await conv.convert(new Uint8Array(), { batchId: 'b1', config: { mapping: '{"x":1}' } });
    expect(seen).toEqual({ mapping: '{"x":1}' });
  });
```
(Reuse the file's existing `manifest`/`logger` fixtures + the `PluginRunner` import; if the file lacks a logger fixture, build one with `createLogger({ level: 'silent' })` from `@openldr/core`.)

- [ ] **Step 5: Run** — `pnpm --filter @openldr/plugins test && pnpm --filter @openldr/plugins typecheck`. Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add packages/plugins/src/runner.ts packages/plugins/src/extism-runner.ts packages/plugins/src/wasm-converter.ts packages/plugins/src/wasm-converter.test.ts
git commit -m "feat(plugins): thread plugin config to the Extism runner (P2-PLUG-2)"
```

---

## Task 2: Ingest config threading

**Files:**
- Modify: `packages/ingest/src/converter.ts`
- Modify: `packages/ingest/src/accept.ts`
- Modify: `packages/ingest/src/handle.ts`
- Modify: `packages/ingest/src/pipeline.test.ts`

- [ ] **Step 1: Extend `ConvertContext`** — in `packages/ingest/src/converter.ts`:
```ts
export interface ConvertContext {
  source?: string;
  batchId: string;
  config?: Record<string, string>;
}
```

- [ ] **Step 2: Extend `AcceptInput` + publish config** — in `packages/ingest/src/accept.ts`, add `config?` to `AcceptInput`:
```ts
export interface AcceptInput {
  data: Uint8Array;
  source: string;
  converter: string;
  contentType?: string;
  filename?: string;
  config?: Record<string, string>;
}
```
and in `acceptPayload`, pass config to `batches.create` + the published payload:
```ts
  await deps.batches.create({ batchId, source: input.source, blobKey, contentType: input.contentType, converter: input.converter, config: input.config });
  await deps.eventing.publish({ type: 'ingest.received', payload: { batchId, blobKey, source: input.source, converter: input.converter, config: input.config ?? null } });
```

- [ ] **Step 3: Read config in the handler + pass to convert** — in `packages/ingest/src/handle.ts`, update `IngestPayload`:
```ts
interface IngestPayload {
  batchId: string;
  blobKey: string;
  source: string;
  converter: string;
  config?: Record<string, string> | null;
}
```
destructure `config`:
```ts
  const { batchId, blobKey, source, converter, config } = event.payload as IngestPayload;
```
and pass it to convert:
```ts
    const resources = await c.convert(raw, { source, batchId, config: config ?? undefined });
```

- [ ] **Step 4: Write a failing test** — in `packages/ingest/src/pipeline.test.ts` (it drives `acceptPayload`→drain→`handleIngestEvent`). READ the file first to reuse its harness (registry/resolver + fake blob/eventing + accept + drain), then add a test that registers a recording converter, accepts with config, drains, and asserts the converter saw `ctx.config`:
```ts
  it('threads config from acceptPayload through to the converter ctx', async () => {
    let seenConfig: Record<string, string> | undefined;
    const recording = {
      id: 'rec', version: '1',
      async convert(_raw: Uint8Array, ctx: { config?: Record<string, string> }) { seenConfig = ctx.config; return []; },
    };
    // register `recording` via the file's existing registry/resolver harness, then:
    //   await acceptPayload(deps, { data, source: 's', converter: 'rec', config: { mapping: '{"k":"v"}' } });
    //   await drain();   // (the file's drain/handle wiring)
    expect(seenConfig).toEqual({ mapping: '{"k":"v"}' });
  });
```
Implement it concretely against the file's actual harness; the binding assertion is `seenConfig === { mapping: '{"k":"v"}' }`.

- [ ] **Step 5: Run** — `pnpm --filter @openldr/ingest test && pnpm --filter @openldr/ingest typecheck`. Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add packages/ingest/src/converter.ts packages/ingest/src/accept.ts packages/ingest/src/handle.ts packages/ingest/src/pipeline.test.ts
git commit -m "feat(ingest): thread plugin config through accept -> event -> convert (P2-PLUG-2)"
```

---

## Task 3: Persist config on `ingest_batches`

**Files:**
- Create: `packages/db/src/migrations/internal/010_ingest_batch_config.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/schema/internal.ts`
- Modify: `packages/db/src/migrations/migrations.test.ts`
- Modify: `packages/ingest/src/batch-store.ts`

- [ ] **Step 1: Create `packages/db/src/migrations/internal/010_ingest_batch_config.ts`:**
```ts
import { type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('ingest_batches').addColumn('config', 'jsonb').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('ingest_batches').dropColumn('config').execute();
}
```

- [ ] **Step 2: Register** in `packages/db/src/migrations/internal/index.ts` — add `import * as m010 from './010_ingest_batch_config';` and `'010_ingest_batch_config': { up: m010.up, down: m010.down },` after `'009_dhis2_schedules'`.

- [ ] **Step 3: Schema** — in `packages/db/src/schema/internal.ts`, add to `IngestBatchesTable`:
```ts
  config: JSONColumnType<Record<string, string>> | null;
```
(confirm `JSONColumnType` is imported there — used by other jsonb columns; if not, add it to the kysely import.)

- [ ] **Step 4: Update** `packages/db/src/migrations/migrations.test.ts` — append `'010_ingest_batch_config'` to the internal-keys array (after `'009_dhis2_schedules'`).

- [ ] **Step 5: Persist + return config in `BatchStore`** — in `packages/ingest/src/batch-store.ts`:
  (a) add `config: Record<string, string> | null;` to `IngestBatch`;
  (b) add `'config'` to `COLUMNS`;
  (c) add `config?: Record<string, string>` to the `create` param in the `BatchStore` interface;
  (d) write it (jsonb needs stringify):
```ts
    async create(b) {
      await db
        .insertInto('ingest_batches')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values({ batch_id: b.batchId, source: b.source, blob_key: b.blobKey, content_type: b.contentType ?? null, converter: b.converter, status: 'received', config: (b.config ? JSON.stringify(b.config) : null) as any })
        .execute();
    },
```

- [ ] **Step 6: Run** — `pnpm --filter @openldr/db test && pnpm --filter @openldr/db typecheck && pnpm --filter @openldr/ingest typecheck`. Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add packages/db/src/migrations/internal/010_ingest_batch_config.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts packages/db/src/migrations/migrations.test.ts packages/ingest/src/batch-store.ts
git commit -m "feat(db,ingest): persist plugin config on ingest_batches (P2-PLUG-2)"
```

---

## Task 4: CLI `ingest --config` + republish config

**Files:**
- Modify: `packages/cli/src/ingest.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/bootstrap/src/ingest-context.ts`

- [ ] **Step 1: Read `--config` in `runIngest`** — in `packages/cli/src/ingest.ts`, add a helper (after the imports):
```ts
function loadPluginConfig(path?: string): Record<string, string> | undefined {
  if (!path) return undefined;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  return out;
}
```
and change `runIngest`:
```ts
export async function runIngest(file: string, opts: JsonOpt & { source: string; converter: string; config?: string }): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const data = readFileSync(file);
    const config = loadPluginConfig(opts.config);
    const { batchId } = await ctx.accept({ data: new Uint8Array(data), source: opts.source, converter: opts.converter, filename: basename(file), config });
    await ctx.drain();
    const batch = await ctx.batches.get(batchId);
    emit(
      opts.json,
      { batchId, status: batch?.status, resourceCount: batch?.resource_count, error: batch?.last_error },
      `batch ${batchId}: ${batch?.status} (${batch?.resource_count ?? 0} resources)${batch?.last_error ? ' — ' + batch.last_error : ''}`,
    );
    return batch?.status === 'done' ? 0 : 1;
  } finally {
    await ctx.close();
  }
}
```

- [ ] **Step 2: Thread config on retry** — in `runPipelineRetry`, pass the persisted config to `republish`:
```ts
    await ctx.republish({ batch_id: batch.batch_id, blob_key: batch.blob_key, source: batch.source, converter: batch.converter, config: batch.config });
```

- [ ] **Step 3: Register the `--config` option** — in `packages/cli/src/index.ts`, find the `ingest <file>` command and add `.option('--config <file>', 'plugin config JSON (e.g. tabular column mapping)')`; ensure its action passes `config` through in the opts object to `runIngest(file, o)`. Match the existing registration style.

- [ ] **Step 4: republish includes config** — in `packages/bootstrap/src/ingest-context.ts`, update the `IngestContext.republish` type + impl:
```ts
  republish(batch: { batch_id: string; blob_key: string; source: string | null; converter: string; config?: Record<string, string> | null }): Promise<void>;
```
```ts
    async republish(batch) {
      await eventing.publish({ type: 'ingest.received', payload: { batchId: batch.batch_id, blobKey: batch.blob_key, source: batch.source ?? 'cli', converter: batch.converter, config: batch.config ?? null } });
    },
```

- [ ] **Step 5: Typecheck + build:check** — `pnpm --filter @openldr/cli typecheck && pnpm --filter @openldr/bootstrap typecheck && pnpm --filter @openldr/cli build:check`. Expected: PASS; `--config` in `node dist/index.js ingest --help`.

- [ ] **Step 6: Commit**
```bash
git add packages/cli/src/ingest.ts packages/cli/src/index.ts packages/bootstrap/src/ingest-context.ts
git commit -m "feat(cli): ingest --config + retry preserves plugin config (P2-PLUG-2)"
```

---

## Task 5: SDK `service_request` + `diagnostic_report` builders (Rust)

**Files:**
- Modify: `wasm/openldr-plugin-sdk/src/fhir.rs`

- [ ] **Step 1: Add the builders** — append to `wasm/openldr-plugin-sdk/src/fhir.rs`:
```rust
/// A laboratory ServiceRequest (an order) referencing a subject.
pub fn service_request(id: &str, subject_ref: &str, code: Option<&str>, code_text: Option<&str>, status: &str) -> Value {
    let mut s = json!({
        "resourceType": "ServiceRequest", "id": id, "status": status, "intent": "order",
        "subject": { "reference": subject_ref }
    });
    let mut coding = json!({});
    if let Some(c) = code { coding["code"] = json!(c); }
    let mut codeable = json!({});
    if code.is_some() { codeable["coding"] = json!([coding]); }
    if let Some(t) = code_text { codeable["text"] = json!(t); }
    if code.is_some() || code_text.is_some() { s["code"] = codeable; }
    s
}

/// A laboratory DiagnosticReport referencing a subject (and optionally a specimen).
pub fn diagnostic_report(id: &str, subject_ref: &str, specimen_ref: Option<&str>, code: Option<&str>, code_text: Option<&str>, issued: Option<&str>, conclusion: Option<&str>) -> Value {
    let mut r = json!({
        "resourceType": "DiagnosticReport", "id": id, "status": "final",
        "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/v2-0074", "code": "LAB" }] }],
        "subject": { "reference": subject_ref }
    });
    let mut coding = json!({});
    if let Some(c) = code { coding["code"] = json!(c); }
    let mut codeable = json!({});
    if code.is_some() { codeable["coding"] = json!([coding]); }
    if let Some(t) = code_text { codeable["text"] = json!(t); }
    if code.is_some() || code_text.is_some() { r["code"] = codeable; }
    if let Some(s) = specimen_ref { r["specimen"] = json!([{ "reference": s }]); }
    if let Some(i) = issued { r["issued"] = json!(i); }
    if let Some(c) = conclusion { r["conclusion"] = json!(c); }
    r
}
```

- [ ] **Step 2: Add tests** — in the `#[cfg(test)] mod tests` block of the same file (it uses `use super::*;` and calls `fhir::patient(...)`), add:
```rust
    #[test]
    fn service_request_builds_code_and_status() {
        let s = fhir::service_request("o1", "Patient/p1", Some("CULT"), Some("Culture"), "active");
        assert_eq!(s["resourceType"], "ServiceRequest");
        assert_eq!(s["status"], "active");
        assert_eq!(s["code"]["coding"][0]["code"], "CULT");
        assert_eq!(s["subject"]["reference"], "Patient/p1");
    }
    #[test]
    fn diagnostic_report_builds_specimen_and_conclusion() {
        let r = fhir::diagnostic_report("d1", "Patient/p1", Some("Specimen/s1"), Some("MICRO"), None, Some("2026-01-10"), Some("E. coli"));
        assert_eq!(r["resourceType"], "DiagnosticReport");
        assert_eq!(r["specimen"][0]["reference"], "Specimen/s1");
        assert_eq!(r["conclusion"], "E. coli");
    }
```
(If the existing tests call `patient(...)` unqualified rather than `fhir::patient`, match that and call `service_request(...)`/`diagnostic_report(...)` unqualified.)

- [ ] **Step 3: Run** — `cargo test -p openldr-plugin-sdk --manifest-path wasm/Cargo.toml` (native; no wasm). Expected: PASS. (If cargo unavailable here, read-verify the code and defer to Task 10; report it.)

- [ ] **Step 4: Commit**
```bash
git add wasm/openldr-plugin-sdk/src/fhir.rs
git commit -m "feat(plugin-sdk): service_request + diagnostic_report FHIR builders (P2-PLUG)"
```

---

## Task 6: `wasm/hl7v2` — HL7 v2 parser (Rust, TDD)

**Files:**
- Create: `wasm/hl7v2/Cargo.toml`
- Create: `wasm/hl7v2/src/parser.rs`
- Modify: `wasm/Cargo.toml` (workspace members)

- [ ] **Step 1: Create `wasm/hl7v2/Cargo.toml`:**
```toml
[package]
name = "hl7v2"
edition.workspace = true
version.workspace = true
license.workspace = true
description = "HL7 v2 (ORU/ORM) -> FHIR R4 ingestion plugin"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
openldr-plugin-sdk = { path = "../openldr-plugin-sdk" }
extism-pdk = "1"
serde_json = "1"
```
(`rlib` alongside `cdylib` so `cargo test` can unit-test the parser/mapping.)

- [ ] **Step 2: Add to the workspace** — in `wasm/Cargo.toml`, add `"hl7v2"` to the `members` array (read the file; it lists `whonet-sqlite`, `openldr-plugin-sdk`).

- [ ] **Step 3: Implement `wasm/hl7v2/src/parser.rs`** (parser + unit tests):
```rust
//! Minimal HL7 v2 parser: split a message into segments/fields/components.

#[derive(Debug, Clone)]
pub struct Encoding {
    pub field: char,
    pub component: char,
    pub repetition: char,
    pub escape: char,
    pub subcomponent: char,
}

impl Default for Encoding {
    fn default() -> Self {
        Encoding { field: '|', component: '^', repetition: '~', escape: '\\', subcomponent: '&' }
    }
}

/// Unescape the common HL7 escape sequences using the message encoding chars.
pub fn unescape(s: &str, enc: &Encoding) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == enc.escape {
            let mut seq = String::new();
            for d in chars.by_ref() {
                if d == enc.escape { break; }
                seq.push(d);
            }
            match seq.as_str() {
                "F" => out.push(enc.field),
                "S" => out.push(enc.component),
                "R" => out.push(enc.repetition),
                "T" => out.push(enc.subcomponent),
                "E" => out.push(enc.escape),
                _ => {} // unknown escape (e.g. \X..\, \H\, \N\) dropped
            }
        } else {
            out.push(c);
        }
    }
    out
}

#[derive(Debug, Clone)]
pub struct Segment {
    pub name: String,
    fields: Vec<String>, // field 0 = segment name
    enc: Encoding,
}

impl Segment {
    /// HL7 field index is 1-based; MSH is special-cased so MSH-1 = the field separator.
    pub fn field(&self, n: usize) -> &str {
        if self.name == "MSH" {
            if n == 1 { return "|"; }
            self.fields.get(n - 1).map(|s| s.as_str()).unwrap_or("")
        } else {
            self.fields.get(n).map(|s| s.as_str()).unwrap_or("")
        }
    }

    /// First repetition's component `c` (1-based) of field `n`, unescaped.
    pub fn component(&self, n: usize, c: usize) -> String {
        let f = self.field(n);
        let rep = f.split(self.enc.repetition).next().unwrap_or("");
        let comp = rep.split(self.enc.component).nth(c - 1).unwrap_or("");
        unescape(comp, &self.enc)
    }

    /// Field `n` (first repetition) unescaped as a whole string.
    pub fn value(&self, n: usize) -> String {
        let f = self.field(n);
        let rep = f.split(self.enc.repetition).next().unwrap_or("");
        unescape(rep, &self.enc)
    }
}

/// Parse one segment line. `MSH` lines carry the encoding chars in MSH-2.
fn parse_segment(line: &str) -> Option<Segment> {
    let line = line.trim_end_matches(['\r', '\n']);
    if line.len() < 3 { return None; }
    let name: String = line.chars().take(3).collect();
    if name == "MSH" {
        let field_sep = line.chars().nth(3).unwrap_or('|');
        let enc_chars: String = line.chars().skip(4).take_while(|&c| c != field_sep).collect();
        let mut ch = enc_chars.chars();
        let enc = Encoding {
            field: field_sep,
            component: ch.next().unwrap_or('^'),
            repetition: ch.next().unwrap_or('~'),
            escape: ch.next().unwrap_or('\\'),
            subcomponent: ch.next().unwrap_or('&'),
        };
        // fields[0]="MSH", fields[1]=encoding chars, fields[2..]=the rest after the 2nd field sep.
        let mut fields: Vec<String> = vec!["MSH".into(), enc_chars.clone()];
        // Everything after "MSH<sep><encchars><sep>" split on the field separator:
        let prefix_len = 3 + 1 + enc_chars.chars().count() + 1; // MSH + sep + encchars + sep
        let after: String = line.chars().skip(prefix_len).collect();
        for f in after.split(field_sep) { fields.push(f.to_string()); }
        Some(Segment { name, fields, enc })
    } else {
        let enc = Encoding::default();
        let fields: Vec<String> = line.split(enc.field).map(|s| s.to_string()).collect();
        Some(Segment { name, fields, enc })
    }
}

/// Split raw text into messages (each starting at an `MSH` segment) and parse each.
pub fn parse_messages(raw: &str) -> Vec<Vec<Segment>> {
    let normalized = raw.replace('\r', "\n");
    let mut messages: Vec<Vec<Segment>> = Vec::new();
    for line in normalized.split('\n') {
        let line = line.trim();
        if line.is_empty() { continue; }
        if line.starts_with("MSH") {
            messages.push(Vec::new());
        }
        if let Some(seg) = parse_segment(line) {
            if let Some(cur) = messages.last_mut() { cur.push(seg); }
        }
    }
    messages
}

#[cfg(test)]
mod tests {
    use super::*;

    const MSG: &str = "MSH|^~\\&|LIS|LAB|||20260110||ORU^R01|1|P|2.5.1\rPID|1||P001||Doe^Jane||19900101|F\rOBX|1|CWE|634-6^Bacteria identified||eco^Escherichia coli\rOBX|2|ST|AMP^Ampicillin||||R";

    #[test]
    fn splits_segments_and_fields() {
        let msgs = parse_messages(MSG);
        assert_eq!(msgs.len(), 1);
        let segs = &msgs[0];
        assert_eq!(segs[0].name, "MSH");
        assert_eq!(segs[0].component(9, 1), "ORU");
        assert_eq!(segs[0].component(9, 2), "R01");
        assert_eq!(segs[1].name, "PID");
        assert_eq!(segs[1].component(5, 1), "Doe");
        assert_eq!(segs[1].value(8), "F");
    }

    #[test]
    fn unescape_handles_sequences() {
        let enc = Encoding::default();
        assert_eq!(unescape("a\\F\\b\\S\\c", &enc), "a|b^c");
    }

    #[test]
    fn obx_fields_accessible() {
        let msgs = parse_messages(MSG);
        let obx1 = msgs[0].iter().find(|s| s.name == "OBX" && s.value(1) == "1").unwrap();
        assert_eq!(obx1.value(2), "CWE");
        assert_eq!(obx1.component(3, 1), "634-6");
        assert_eq!(obx1.component(5, 1), "eco");
    }
}
```

- [ ] **Step 4: Run, verify pass** — `cargo test -p hl7v2 --manifest-path wasm/Cargo.toml`. Expected: PASS. (If cargo unavailable, read-verify + defer to Task 10; report it.)

- [ ] **Step 5: Commit**
```bash
git add wasm/hl7v2/Cargo.toml wasm/hl7v2/src/parser.rs wasm/Cargo.toml
git commit -m "feat(hl7v2): minimal HL7 v2 parser (P2-PLUG-1)"
```

---

## Task 7: `wasm/hl7v2` — ORU/ORM mapping + `convert` (Rust, TDD)

**Files:**
- Create: `wasm/hl7v2/src/mapping.rs`
- Create: `wasm/hl7v2/src/lib.rs`

- [ ] **Step 1: Implement `wasm/hl7v2/src/mapping.rs`:**
```rust
use crate::parser::Segment;
use openldr_plugin_sdk::fhir;
use serde_json::Value;
use std::collections::HashSet;

const AST_INTERP: [&str; 5] = ["S", "I", "R", "SDD", "NS"];
const ORGANISM_CODES: [&str; 2] = ["634-6", "88040-1"];

pub struct Config {
    pub organism_codes: HashSet<String>,
    pub ast_interp: HashSet<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            organism_codes: ORGANISM_CODES.iter().map(|s| s.to_string()).collect(),
            ast_interp: AST_INTERP.iter().map(|s| s.to_string()).collect(),
        }
    }
}

fn sex(code: &str) -> Option<&'static str> {
    match code.to_ascii_uppercase().as_str() { "M" => Some("male"), "F" => Some("female"), "" => None, _ => Some("unknown") }
}

fn origin_from_pv1(class: &str) -> Option<&'static str> {
    match class.to_ascii_uppercase().as_str() { "I" => Some("inpatient"), "O" => Some("outpatient"), "" => None, _ => Some("unknown") }
}

/// Map one parsed message (segments) to FHIR resources.
pub fn map_message(segs: &[Segment], cfg: &Config, seq: usize) -> Vec<Value> {
    let mut out = Vec::new();
    let msh = match segs.iter().find(|s| s.name == "MSH") { Some(m) => m, None => return out };
    let msg_type = msh.component(9, 1);
    let ctrl = msh.value(10);
    let key = if ctrl.is_empty() { format!("hl7-{seq}") } else { ctrl };

    let pid = segs.iter().find(|s| s.name == "PID");
    let patient_id = pid
        .map(|p| { let v = p.component(3, 1); if v.is_empty() { format!("pat-{key}") } else { v } })
        .unwrap_or_else(|| format!("pat-{key}"));
    let pid_ref = format!("Patient/hl7-{patient_id}");

    if let Some(p) = pid {
        let family = p.component(5, 1);
        let given = p.component(5, 2);
        let birth = p.value(7);
        out.push(fhir::patient(
            &format!("hl7-{patient_id}"),
            if family.is_empty() { None } else { Some(family.as_str()) },
            if given.is_empty() { None } else { Some(given.as_str()) },
            sex(&p.value(8)),
            if birth.is_empty() { None } else { Some(birth.as_str()) },
        ));
    } else {
        out.push(fhir::patient(&format!("hl7-{patient_id}"), None, None, None, None));
    }

    let origin = segs.iter().find(|s| s.name == "PV1").and_then(|pv1| origin_from_pv1(&pv1.value(2)));

    let order_code = segs.iter().find(|s| s.name == "OBR").map(|obr| (obr.component(4, 1), obr.component(4, 2)));
    if let Some((code, text)) = &order_code {
        out.push(fhir::service_request(
            &format!("hl7-sr-{key}"), &pid_ref,
            if code.is_empty() { None } else { Some(code.as_str()) },
            if text.is_empty() { None } else { Some(text.as_str()) },
            "active",
        ));
    }

    if msg_type == "ORM" {
        return out;
    }

    let spm = segs.iter().find(|s| s.name == "SPM");
    let spec_id = format!("hl7-spec-{key}");
    let spec_ref = format!("Specimen/{spec_id}");
    let spec_type = spm.map(|s| s.component(4, 1)).unwrap_or_default();
    let spec_date = spm.map(|s| s.value(17)).unwrap_or_default();
    out.push(fhir::specimen(
        &spec_id, &pid_ref,
        if spec_type.is_empty() { None } else { Some(spec_type.as_str()) },
        if spec_date.is_empty() { None } else { Some(spec_date.as_str()) },
        origin,
    ));
    out.push(fhir::diagnostic_report(
        &format!("hl7-dr-{key}"), &pid_ref, Some(&spec_ref),
        order_code.as_ref().map(|(c, _)| c.as_str()).filter(|c| !c.is_empty()),
        order_code.as_ref().map(|(_, t)| t.as_str()).filter(|t| !t.is_empty()),
        None, None,
    ));

    let mut obx_n = 0usize;
    for obx in segs.iter().filter(|s| s.name == "OBX") {
        obx_n += 1;
        let interp = obx.value(8).to_ascii_uppercase();
        let obs3_code = obx.component(3, 1);
        let obs3_text = obx.component(3, 2);
        if cfg.ast_interp.contains(&interp) {
            let ab = if obs3_code.is_empty() { obs3_text.clone() } else { obs3_code.clone() };
            if ab.is_empty() { continue; }
            out.push(fhir::observation_ast(&format!("hl7-ast-{key}-{obx_n}"), &pid_ref, &spec_ref, &ab, &interp));
        } else if cfg.organism_codes.contains(&obs3_code) && matches!(obx.value(2).as_str(), "CE" | "CWE" | "CF") {
            let org_code = obx.component(5, 1);
            let org_text = obx.component(5, 2);
            let code = if org_code.is_empty() { org_text.clone() } else { org_code };
            let text = if org_text.is_empty() { code.clone() } else { org_text };
            if code.is_empty() { continue; }
            out.push(fhir::observation_organism(&format!("hl7-org-{key}-{obx_n}"), &pid_ref, &spec_ref, &code, &text));
        }
    }
    out
}
```

- [ ] **Step 2: Implement `wasm/hl7v2/src/lib.rs`** (convert + config + mapping tests):
```rust
mod mapping;
mod parser;

use extism_pdk::*;
use openldr_plugin_sdk::to_ndjson;

fn load_config() -> mapping::Config {
    let mut cfg = mapping::Config::default();
    if let Ok(Some(s)) = config::get("organismIdCodes") {
        if let Ok(extra) = serde_json::from_str::<Vec<String>>(&s) { cfg.organism_codes.extend(extra); }
    }
    if let Ok(Some(s)) = config::get("astInterpretationCodes") {
        if let Ok(extra) = serde_json::from_str::<Vec<String>>(&s) {
            cfg.ast_interp.extend(extra.into_iter().map(|c| c.to_ascii_uppercase()));
        }
    }
    cfg
}

#[plugin_fn]
pub fn convert(input: Vec<u8>) -> FnResult<String> {
    if input.is_empty() { return Ok(String::new()); }
    let text = String::from_utf8(input).map_err(|e| WithReturnCode::new(Error::msg(format!("utf8: {e}")), 1))?;
    let cfg = load_config();
    let mut resources = Vec::new();
    for (i, segs) in parser::parse_messages(&text).into_iter().enumerate() {
        resources.extend(mapping::map_message(&segs, &cfg, i + 1));
    }
    Ok(to_ndjson(&resources))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORU: &str = "MSH|^~\\&|LIS|LAB|||20260110||ORU^R01|1|P|2.5.1\rPID|1||P001||Doe^Jane||19900101|F\rPV1|1|I\rSPM|1|||BLOOD|||||||||||||20260110\rOBR|1||1|CULT^Culture\rOBX|1|CWE|634-6^Bacteria identified||eco^Escherichia coli\rOBX|2|ST|AMP^Ampicillin||||R";

    #[test]
    fn oru_maps_patient_specimen_organism_ast() {
        let cfg = mapping::Config::default();
        let segs = &parser::parse_messages(ORU)[0];
        let res = mapping::map_message(segs, &cfg, 1);
        let types: Vec<&str> = res.iter().map(|r| r["resourceType"].as_str().unwrap()).collect();
        assert!(types.contains(&"Patient"));
        assert!(types.contains(&"Specimen"));
        assert!(types.contains(&"ServiceRequest"));
        assert!(types.contains(&"DiagnosticReport"));
        let obs: Vec<&serde_json::Value> = res.iter().filter(|r| r["resourceType"] == "Observation").collect();
        assert!(obs.iter().any(|o| o["code"]["coding"][0]["code"] == "634-6"));
        assert!(obs.iter().any(|o| o["interpretation"][0]["coding"][0]["code"] == "R"));
        let spec = res.iter().find(|r| r["resourceType"] == "Specimen").unwrap();
        assert_eq!(spec["extension"][0]["valueCode"], "inpatient");
    }

    #[test]
    fn orm_maps_order_only() {
        let cfg = mapping::Config::default();
        let orm = "MSH|^~\\&|LIS|LAB|||20260110||ORM^O01|2|P|2.5.1\rPID|1||P002\rORC|NW\rOBR|1||2|CULT^Culture";
        let segs = &parser::parse_messages(orm)[0];
        let res = mapping::map_message(segs, &cfg, 1);
        let types: Vec<&str> = res.iter().map(|r| r["resourceType"].as_str().unwrap()).collect();
        assert!(types.contains(&"Patient"));
        assert!(types.contains(&"ServiceRequest"));
        assert!(!types.contains(&"Specimen"));
        assert!(!types.contains(&"Observation"));
    }
}
```

- [ ] **Step 3: Run, verify pass** — `cargo test -p hl7v2 --manifest-path wasm/Cargo.toml`. Expected: PASS. (Defer to Task 10 if cargo unavailable; report.)

- [ ] **Step 4: Commit**
```bash
git add wasm/hl7v2/src/mapping.rs wasm/hl7v2/src/lib.rs
git commit -m "feat(hl7v2): ORU/ORM -> FHIR mapping + deterministic OBX classification + convert (P2-PLUG-1)"
```

---

## Task 8: `wasm/tabular` — CSV/Excel reader + config-driven mapping (Rust, TDD)

**Files:**
- Create: `wasm/tabular/Cargo.toml`
- Create: `wasm/tabular/src/reader.rs`
- Create: `wasm/tabular/src/mapping.rs`
- Create: `wasm/tabular/src/lib.rs`
- Modify: `wasm/Cargo.toml` (workspace members)

- [ ] **Step 1: Create `wasm/tabular/Cargo.toml`:**
```toml
[package]
name = "tabular"
edition.workspace = true
version.workspace = true
license.workspace = true
description = "CSV/Excel -> FHIR R4 ingestion plugin (configurable mapping)"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
openldr-plugin-sdk = { path = "../openldr-plugin-sdk" }
extism-pdk = "1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
csv = "1"
calamine = "0.26"
```
Add `"tabular"` to `wasm/Cargo.toml` `members`.

- [ ] **Step 2: Implement `wasm/tabular/src/reader.rs`:**
```rust
use std::collections::HashMap;
use std::io::Cursor;

pub type Row = HashMap<String, String>;

/// Parse bytes into header-keyed rows. `.xlsx` (ZIP magic) -> calamine; else CSV.
pub fn read_rows(bytes: &[u8], sheet: Option<&str>) -> Result<Vec<Row>, String> {
    if bytes.len() >= 4 && bytes[0..4] == [0x50, 0x4B, 0x03, 0x04] {
        read_xlsx(bytes, sheet)
    } else {
        read_csv(bytes)
    }
}

fn read_csv(bytes: &[u8]) -> Result<Vec<Row>, String> {
    let first = bytes.split(|&b| b == b'\n').next().unwrap_or(&[]);
    let delim = if first.iter().filter(|&&b| b == b'\t').count() > first.iter().filter(|&&b| b == b',').count() { b'\t' } else { b',' };
    let mut rdr = csv::ReaderBuilder::new().delimiter(delim).flexible(true).from_reader(Cursor::new(bytes));
    let headers: Vec<String> = rdr.headers().map_err(|e| format!("csv headers: {e}"))?.iter().map(|s| s.trim().to_string()).collect();
    let mut rows = Vec::new();
    for rec in rdr.records() {
        let rec = rec.map_err(|e| format!("csv row: {e}"))?;
        let mut row = HashMap::new();
        for (i, h) in headers.iter().enumerate() {
            row.insert(h.clone(), rec.get(i).unwrap_or("").trim().to_string());
        }
        rows.push(row);
    }
    Ok(rows)
}

fn read_xlsx(bytes: &[u8], sheet: Option<&str>) -> Result<Vec<Row>, String> {
    use calamine::{Reader, Xlsx};
    let mut wb: Xlsx<_> = Xlsx::new(Cursor::new(bytes.to_vec())).map_err(|e| format!("xlsx: {e}"))?;
    let name = match sheet {
        Some(s) => s.to_string(),
        None => wb.sheet_names().first().cloned().ok_or_else(|| "xlsx has no sheets".to_string())?,
    };
    let range = wb.worksheet_range(&name).map_err(|e| format!("sheet '{name}': {e}"))?;
    let mut iter = range.rows();
    let headers: Vec<String> = match iter.next() {
        Some(r) => r.iter().map(cell_str).collect(),
        None => return Ok(Vec::new()),
    };
    let mut rows = Vec::new();
    for r in iter {
        let mut row = HashMap::new();
        for (i, h) in headers.iter().enumerate() {
            row.insert(h.trim().to_string(), r.get(i).map(cell_str).unwrap_or_default().trim().to_string());
        }
        rows.push(row);
    }
    Ok(rows)
}

fn cell_str(c: &calamine::Data) -> String {
    use calamine::Data;
    match c {
        Data::String(s) => s.clone(),
        Data::Float(f) => { if f.fract() == 0.0 { format!("{}", *f as i64) } else { f.to_string() } }
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => b.to_string(),
        Data::DateTime(d) => d.to_string(),
        _ => String::new(),
    }
}
```

- [ ] **Step 3: Implement `wasm/tabular/src/mapping.rs`:**
```rust
use crate::reader::Row;
use openldr_plugin_sdk::fhir;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct AntibioticCol { pub column: String, pub code: String }

#[derive(Debug, Deserialize)]
pub struct Mapping {
    pub sheet: Option<String>,
    #[serde(rename = "patientId")] pub patient_id: String,
    pub gender: Option<String>,
    #[serde(rename = "genderMap")] pub gender_map: Option<HashMap<String, String>>,
    #[serde(rename = "birthDate")] pub birth_date: Option<String>,
    #[serde(rename = "specimenId")] pub specimen_id: String,
    #[serde(rename = "specimenType")] pub specimen_type: Option<String>,
    #[serde(rename = "collectedDate")] pub collected_date: Option<String>,
    pub origin: Option<String>,
    #[serde(rename = "originMap")] pub origin_map: Option<HashMap<String, String>>,
    pub organism: Option<String>,
    #[serde(rename = "organismCode")] pub organism_code: Option<String>,
    pub antibiotics: Option<Vec<AntibioticCol>>,
}

impl Mapping {
    pub fn validate(&self) -> Result<(), String> {
        if self.patient_id.is_empty() || self.specimen_id.is_empty() {
            return Err("mapping requires patientId + specimenId".into());
        }
        if self.organism.is_none() && self.antibiotics.as_ref().map(|a| a.is_empty()).unwrap_or(true) {
            return Err("mapping requires organism or antibiotics".into());
        }
        Ok(())
    }
}

fn get<'a>(row: &'a Row, col: &Option<String>) -> Option<&'a str> {
    col.as_ref().and_then(|c| row.get(c)).map(|s| s.as_str()).filter(|s| !s.is_empty())
}

fn mapped<'a>(v: &'a str, m: &'a Option<HashMap<String, String>>) -> &'a str {
    m.as_ref().and_then(|map| map.get(v)).map(|s| s.as_str()).unwrap_or(v)
}

pub fn map_rows(rows: &[Row], m: &Mapping) -> Vec<Value> {
    let mut out = Vec::new();
    for (i, row) in rows.iter().enumerate() {
        let pid = row.get(&m.patient_id).filter(|s| !s.is_empty()).cloned().unwrap_or_else(|| format!("row-{i}"));
        let sid = row.get(&m.specimen_id).filter(|s| !s.is_empty()).cloned().unwrap_or_else(|| format!("spec-{i}"));
        let pref = format!("Patient/tab-{pid}");
        let sref = format!("Specimen/tab-{sid}");

        let gender = get(row, &m.gender).map(|g| mapped(g, &m.gender_map).to_string());
        out.push(fhir::patient(&format!("tab-{pid}"), None, None, gender.as_deref(), get(row, &m.birth_date)));

        let origin = get(row, &m.origin).map(|o| mapped(o, &m.origin_map).to_string());
        out.push(fhir::specimen(&format!("tab-{sid}"), &pref, get(row, &m.specimen_type), get(row, &m.collected_date), origin.as_deref()));

        if let Some(org) = get(row, &m.organism) {
            let code = get(row, &m.organism_code).unwrap_or(org);
            out.push(fhir::observation_organism(&format!("tab-org-{sid}"), &pref, &sref, code, org));
        }
        if let Some(abs) = &m.antibiotics {
            for ab in abs {
                if let Some(cell) = row.get(&ab.column) {
                    let v = cell.trim().to_ascii_uppercase();
                    if v == "S" || v == "I" || v == "R" {
                        out.push(fhir::observation_ast(&format!("tab-ast-{sid}-{}", ab.code), &pref, &sref, &ab.code, &v));
                    }
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(pairs: &[(&str, &str)]) -> Row { pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect() }

    #[test]
    fn maps_a_row_to_patient_specimen_organism_ast() {
        let m: Mapping = serde_json::from_str(r#"{
            "patientId":"PID","gender":"Sex","genderMap":{"F":"female"},"specimenId":"SID",
            "specimenType":"Spec","origin":"Loc","originMap":{"I":"inpatient"},
            "organism":"Org","organismCode":"OrgCode",
            "antibiotics":[{"column":"AMP","code":"AMP"},{"column":"CIP","code":"CIP"}]
        }"#).unwrap();
        m.validate().unwrap();
        let rows = vec![row(&[("PID","P1"),("Sex","F"),("SID","S1"),("Spec","BLOOD"),("Loc","I"),("Org","Escherichia coli"),("OrgCode","eco"),("AMP","R"),("CIP","")])];
        let res = map_rows(&rows, &m);
        assert_eq!(res.iter().filter(|r| r["resourceType"] == "Observation").count(), 2); // organism + 1 AST (blank CIP skipped)
        let pat = res.iter().find(|r| r["resourceType"] == "Patient").unwrap();
        assert_eq!(pat["gender"], "female");
        let spec = res.iter().find(|r| r["resourceType"] == "Specimen").unwrap();
        assert_eq!(spec["extension"][0]["valueCode"], "inpatient");
        let ast = res.iter().find(|r| r["resourceType"] == "Observation" && r["interpretation"][0]["coding"][0]["code"] == "R").unwrap();
        assert_eq!(ast["code"]["text"], "AMP");
    }

    #[test]
    fn validate_rejects_missing_keys() {
        let m: Mapping = serde_json::from_str(r#"{"patientId":"","specimenId":"S"}"#).unwrap();
        assert!(m.validate().is_err());
    }
}
```

- [ ] **Step 4: Implement `wasm/tabular/src/lib.rs`:**
```rust
mod mapping;
mod reader;

use extism_pdk::*;
use openldr_plugin_sdk::to_ndjson;

#[plugin_fn]
pub fn convert(input: Vec<u8>) -> FnResult<String> {
    if input.is_empty() { return Ok(String::new()); }
    let raw = config::get("mapping")
        .ok()
        .flatten()
        .ok_or_else(|| WithReturnCode::new(Error::msg("missing 'mapping' plugin config"), 1))?;
    let m: mapping::Mapping = serde_json::from_str(&raw).map_err(|e| WithReturnCode::new(Error::msg(format!("invalid mapping config: {e}")), 1))?;
    m.validate().map_err(|e| WithReturnCode::new(Error::msg(e), 1))?;
    let rows = reader::read_rows(&input, m.sheet.as_deref()).map_err(|e| WithReturnCode::new(Error::msg(e), 1))?;
    let resources = mapping::map_rows(&rows, &m);
    Ok(to_ndjson(&resources))
}
```

- [ ] **Step 5: Run, verify pass** — `cargo test -p tabular --manifest-path wasm/Cargo.toml`. Expected: PASS. (Defer to Task 10 if cargo unavailable; report.)

- [ ] **Step 6: Commit**
```bash
git add wasm/tabular/Cargo.toml wasm/tabular/src/reader.rs wasm/tabular/src/mapping.rs wasm/tabular/src/lib.rs wasm/Cargo.toml
git commit -m "feat(tabular): CSV/Excel reader + config-driven FHIR mapping + convert (P2-PLUG-2)"
```

---

## Task 9: Samples + `build:plugins` wiring

**Files:**
- Create: `samples/hl7-oru-sample.hl7`
- Create: `samples/lab-mapping.json`
- Create: `scripts/make-lab-sample.mjs`
- Modify: `scripts/build-wasm-plugins.mjs`
- Modify: `package.json` (root scripts)

- [ ] **Step 1: Create `samples/hl7-oru-sample.hl7`** (two ORU + one ORM; `\n`-separated segments — the parser normalizes):
```
MSH|^~\&|LIS|LAB|||20260110||ORU^R01|1|P|2.5.1
PID|1||P001||Doe^Jane||19900412|F
PV1|1|I
SPM|1|||BLOOD|||||||||||||20260110
OBR|1||1|CULT^Culture
OBX|1|CWE|634-6^Bacteria identified||eco^Escherichia coli
OBX|2|ST|AMP^Ampicillin||||R
OBX|3|ST|CIP^Ciprofloxacin||||S
OBX|4|ST|GEN^Gentamicin||||S
MSH|^~\&|LIS|LAB|||20260111||ORU^R01|2|P|2.5.1
PID|1||P002||Roe^John||19851130|M
PV1|1|O
SPM|1|||URINE|||||||||||||20260111
OBR|1||2|CULT^Culture
OBX|1|CWE|634-6^Bacteria identified||kpn^Klebsiella pneumoniae
OBX|2|ST|AMP^Ampicillin||||R
OBX|3|ST|CIP^Ciprofloxacin||||I
OBX|4|ST|GEN^Gentamicin||||S
MSH|^~\&|LIS|LAB|||20260112||ORM^O01|3|P|2.5.1
PID|1||P003||Foe^Sam||20000101|M
ORC|NW
OBR|1||3|CULT^Culture
```

- [ ] **Step 2: Create `samples/lab-mapping.json`** (the `--config` file = the Extism config map; `mapping` is one key):
```json
{
  "mapping": {
    "patientId": "PatientID",
    "gender": "Sex",
    "genderMap": { "M": "male", "F": "female" },
    "birthDate": "DOB",
    "specimenId": "SpecimenNo",
    "specimenType": "Specimen",
    "collectedDate": "CollectionDate",
    "origin": "LocationType",
    "originMap": { "I": "inpatient", "O": "outpatient" },
    "organism": "Organism",
    "organismCode": "OrganismCode",
    "antibiotics": [
      { "column": "AMP", "code": "AMP" },
      { "column": "CIP", "code": "CIP" },
      { "column": "GEN", "code": "GEN" }
    ]
  }
}
```

- [ ] **Step 3: Create `scripts/make-lab-sample.mjs`:**
```js
// Writes samples/lab-sample.csv and samples/lab-sample.xlsx for the tabular plugin.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

const dir = join(process.cwd(), 'samples');
mkdirSync(dir, { recursive: true });

const headers = ['PatientID', 'Sex', 'DOB', 'SpecimenNo', 'Specimen', 'CollectionDate', 'LocationType', 'Organism', 'OrganismCode', 'AMP', 'CIP', 'GEN'];
const rows = [
  ['T001', 'F', '1990-04-12', 'TS001', 'BLOOD', '2026-01-10', 'I', 'Escherichia coli', 'eco', 'R', 'S', 'S'],
  ['T002', 'M', '1985-11-30', 'TS002', 'URINE', '2026-01-11', 'O', 'Klebsiella pneumoniae', 'kpn', 'R', 'I', 'S'],
];

const csv = [headers, ...rows].map((r) => r.join(',')).join('\n') + '\n';
writeFileSync(join(dir, 'lab-sample.csv'), csv);

const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
XLSX.writeFile(wb, join(dir, 'lab-sample.xlsx'));
process.stdout.write('wrote samples/lab-sample.csv + lab-sample.xlsx\n');
```
Add `xlsx` (SheetJS) as a root devDependency (`pnpm add -Dw xlsx`) and a root `package.json` script `"make:lab-sample": "node scripts/make-lab-sample.mjs"`.

- [ ] **Step 4: Extend `scripts/build-wasm-plugins.mjs`** — these plugins are pure-Rust (no clang/sysroot). Refactor so the sysroot check + clang env apply only to `whonet-sqlite`, and add a generic builder; after the whonet build block add:
```js
function buildPure(crate, id, description) {
  execSync(`cargo build -p ${crate} --release --target wasm32-wasip1`, { cwd: wasmDir, stdio: 'inherit', env: process.env });
  const built = join(wasmDir, 'target', 'wasm32-wasip1', 'release', `${crate.replace(/-/g, '_')}.wasm`);
  const dir = join(root, 'reference-plugins', id);
  mkdirSync(dir, { recursive: true });
  const staged = join(dir, 'plugin.wasm');
  copyFileSync(built, staged);
  const sha = createHash('sha256').update(readFileSync(staged)).digest('hex');
  const manifest = { id, version: ver, entrypoint: 'convert', wasmSha256: sha, description, license: 'Apache-2.0', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(`staged ${staged} (sha256 ${sha}) + manifest.json\n`);
}
buildPure('hl7v2', 'hl7v2', 'HL7 v2 (ORU/ORM) -> FHIR R4 ingestion plugin');
buildPure('tabular', 'tabular', 'CSV/Excel -> FHIR R4 ingestion plugin (configurable mapping)');
```
(`ver`/`root`/`wasmDir` are already in scope. If `hl7v2`/`tabular` fail to instantiate under `wasi:false` at acceptance because they import `wasi_snapshot_preview1`, set their manifest `wasi` to `true` here and rebuild — Task 10 verifies.)

- [ ] **Step 5: Validate JS** — `node --check scripts/make-lab-sample.mjs && node --check scripts/build-wasm-plugins.mjs`. Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add samples/hl7-oru-sample.hl7 samples/lab-mapping.json scripts/make-lab-sample.mjs scripts/build-wasm-plugins.mjs package.json pnpm-lock.yaml
git commit -m "chore: HL7 + tabular samples + build:plugins wiring (P2-PLUG)"
```

---

## Task 10: Live acceptance + memory + finish

**Files:** none (verification + memory). Internal Postgres dev stack + Docker; Rust/wasi toolchain.

- [ ] **Step 1: Build + Rust tests** — `pnpm build:plugins` (builds whonet-sqlite + hl7v2 + tabular → `reference-plugins/<id>/`); `pnpm make:lab-sample`. If `hl7v2`/`tabular` instantiate-fail under `wasi:false`, flip their manifest `wasi:true` in `build-wasm-plugins.mjs` + rebuild. `cargo test --manifest-path wasm/Cargo.toml` (sdk + hl7v2 + tabular all pass).

- [ ] **Step 2: Migrate + install both plugins** —
```bash
pnpm openldr db migrate                                   # applies internal 010_ingest_batch_config
pnpm openldr plugin install reference-plugins/hl7v2/plugin.wasm reference-plugins/hl7v2/manifest.json
pnpm openldr plugin install reference-plugins/tabular/plugin.wasm reference-plugins/tabular/manifest.json
pnpm openldr plugin list --json
```

- [ ] **Step 3: Ingest HL7** — `pnpm openldr ingest samples/hl7-oru-sample.hl7 --plugin hl7v2 --json`. Expected: `done`, resources > 0. Verify: `docker exec openldr_ce-postgres-1 psql -U openldr -d openldr_target -c "select code_text, interpretation_code from observations where interpretation_code in ('S','I','R');"` shows the HL7 AST results; `select origin from specimens` shows `inpatient`/`outpatient`. `pnpm openldr report run amr-first-isolate-summary --json` → the HL7 eco/kpn isolates appear.

- [ ] **Step 4: Ingest CSV + xlsx with config** —
```bash
pnpm openldr ingest samples/lab-sample.csv --plugin tabular --config samples/lab-mapping.json --json
pnpm openldr ingest samples/lab-sample.xlsx --plugin tabular --config samples/lab-mapping.json --json
```
Expected: both `done`, resources > 0, identical isolates (T001 eco BLOOD inpatient, T002 kpn URINE outpatient). Confirm fail-loud: `pnpm openldr ingest samples/lab-sample.csv --plugin tabular --json` → `failed` with "missing 'mapping' plugin config".

- [ ] **Step 5: Retry preserves config** — take a tabular batch id from Step 4 → `pnpm openldr pipeline retry <batchId> --json` → `done` (proves `ingest_batches.config` round-trips through republish).

- [ ] **Step 6: Multi-format proof + full gates** — `provenance audit` clean for ingested data; `pnpm typecheck && pnpm test && pnpm depcruise && pnpm build:check` all PASS. **Three formats (WHONET SQLite + HL7 v2 + CSV/Excel) ingest through one plugin contract (P2-PLUG-3).**

- [ ] **Step 7: Update build-plan memory** — record Phase-2 §7 step 5 (HL7 + CSV/Excel plugins + plugin-config extension) done + acceptance + carry-forwards. File: `C:\Users\Fredrick\.claude\projects\D--Projects-Repositories-openldr-ce\memory\openldr-ce-build-plan.md` (+ `MEMORY.md` index line).

- [ ] **Step 8: Finish the branch** — use superpowers:finishing-a-development-branch (merge to `main`; strip any harness-injected `Co-Authored-By` trailers per P1-CONV-2).

---

## Self-review notes (author)

- **Spec coverage:** config channel (§1) → T1/T2/T3/T4; SDK builders (§2) → T5; HL7 plugin (§3) → T6/T7; tabular plugin (§4) → T8; wiring/samples/acceptance (§5) → T9/T10. P2-PLUG-1 → T6/T7; P2-PLUG-2 → T1-T4 + T8; P2-PLUG-3 → T10.
- **No placeholders:** every TS task has complete code; the Rust parser/mapping/reader are complete. T2 Step 4 instructs reading `pipeline.test.ts` to reuse its harness for the one config-threading assertion (explicit read, concrete assertion). The `wasi:false`→`true` fallback is an explicit, verifiable build-time branch (T9/T10).
- **Type/name consistency:** `config?: Record<string,string>` flows `RunOptions`→`ConvertContext`→`AcceptInput`→`ingest.received` payload→`IngestPayload`→`c.convert`; `BatchStore.create({...config?})` + `IngestBatch.config` + `ingest_batches.config`; CLI `--config`→`loadPluginConfig`→`ctx.accept({config})`; `republish({...config?})`. Rust: `fhir::service_request`/`diagnostic_report`/`specimen(...,origin)` used by both plugin mappings; ids `hl7v2`/`tabular` consistent across manifests + acceptance.
- **Carry-forwards (for build-plan):** HL7 organism/AST code sets default LOINC/HL70078 + config-extensible; tabular wide-format + first-sheet; `.xlsx` only; Extism 1.0.3 memory/timeout best-effort; the pure plugins' `wasi` manifest flag may need `true`.
