# Ingestion Plugins — HL7 v2 + CSV/Excel (P2-PLUG) — Design

**Status:** Approved (brainstorming) — ready for implementation plan
**Date:** 2026-06-14
**PRD coverage:** P2-PLUG-1 (HL7 v2 plugin), P2-PLUG-2 (CSV/Excel plugin with configurable column-to-field mapping), P2-PLUG-3 (both on the Extism/WASM SDK; with WHONET, prove multi-format ingestion + exercise the plugin contract).
**Builds on:** the Phase-1 plugin runtime (`@openldr/plugins`: Extism runner, manifest, `WasmPluginConverter`, NDJSON output), the ingest pipeline (`@openldr/ingest`: `Converter`/`ConvertContext`, `handleIngestEvent`, `BatchStore`, `acceptPayload`), the `openldr-plugin-sdk` Rust FHIR builders, the WHONET reference plugin, and the §7-step-4 origin-aware `specimen` builder + `specimens.origin`.

---

## Goal

Two new Rust/WASM ingestion plugins — **`hl7v2`** (ORU^R01 results + ORM^O01 orders → FHIR R4) and **`tabular`** (CSV + Excel `.xlsx` with a configurable column→FHIR mapping) — plus a **plugin-config channel** (the mapping is operator config, not data) persisted so retries survive. Together with WHONET, they prove multi-format ingestion through one plugin contract.

**Decided in brainstorming:** one slice (both plugins + config extension); HL7 = ORU+ORM; tabular = CSV + Excel (calamine); mapping reaches the plugin via an Extism **config** channel, **persisted in `ingest_batches`**; HL7 parser hand-rolled; OBX organism/AST classification is **deterministic** (not heuristic).

---

## Section 1: Plugin-config extension (persisted)

The mapping config flows as an Extism config map (separate from the data bytes):

- **`@openldr/plugins`** — `RunOptions` (`runner.ts`) gains `config?: Record<string, string>`; `extism-runner.ts` passes it to `createPlugin(wasm, { useWasi, runInWorker: false, config: opts.config ?? {}, functions })` (Extism 1.0.3 supports a config map, read in-plugin via `extism_pdk` `config::get`); `wasm-converter.ts` forwards `ctx.config` into `runner.run`.
- **`@openldr/ingest`** — `ConvertContext` gains `config?: Record<string, string>`; `handleIngestEvent` reads `config` from the `ingest.received` payload and passes it in the ctx to `c.convert(raw, { source, batchId, config })`. `AcceptInput` gains `config?`; `acceptPayload` persists it on the batch and includes it in the published payload. `republish` reads config back from the batch record.
- **`@openldr/db`** — internal migration `010_ingest_batch_config` adds a nullable `ingest_batches.config` jsonb column; `IngestBatchesTable` gains `config`; `BatchStore.create` writes it, `get`/`list`/`republish` paths return it.
- **`@openldr/cli`** — `ingest <file> --plugin <id> [--config <file.json>]`: the `--config` file is a JSON object that becomes the Extism config map; the CLI `JSON.stringify`s any non-string values (tabular: `{ "mapping": { …schema… } }`; HL7: `{ "organismIdCodes": [...] }`).

**Persistence rationale:** the outbox retries failed batches; without persisted config a retried config-driven batch loses its mapping and fails differently than it succeeded — a silent correctness hole. `ingest_batches.config` closes it (and makes `pipeline retry` work for config-driven plugins).

HL7 messages are self-contained; the HL7 plugin only uses config for the optional code-set overrides (Section 3). The channel is a general capability any plugin can use.

## Section 2: SDK builder additions

`wasm/openldr-plugin-sdk/src/fhir.rs` gains two builders matching the existing flat-table flatteners (`service_request.ts`, `diagnostic_report.ts`):

- **`service_request(id, subject_ref, code, code_text, status)`** → FHIR `ServiceRequest` (`code.coding[].code` + `code.text`, `subject`, `status`, `intent:'order'`) → flattens to `service_requests`.
- **`diagnostic_report(id, subject_ref, specimen_ref, code, code_text, issued, conclusion)`** → FHIR `DiagnosticReport` (`code`, `subject`, `specimen[]`, `issued`, `conclusion`, `category:'LAB'`) → flattens to `diagnostic_reports`.

Unit-tested in the SDK crate's `#[cfg(test)]` module (assert `resourceType` + key fields). Both plugins reuse the origin-aware `specimen(... origin)` builder (from §7 step 4) to stamp inpatient/outpatient.

## Section 3: HL7 v2 plugin (`wasm/hl7v2`)

New Rust cdylib (sibling of `whonet-sqlite`); `wasi:false`; id `hl7v2`; built to `reference-plugins/hl7v2/`.

- **`src/parser.rs`** — hand-rolled minimal HL7 v2 parser: split a message into segments (`\r`/`\n`), fields (`|`), components (`^`), repetitions (`~`); read encoding chars from `MSH-2` (default `^~\&`); unescape `\F\`→`|`, `\S\`→`^`, `\R\`→`~`, `\T\`→`&`, `\E\`→`\`. A `Segment` with `field(n)`/`component(n,c)` accessors.
- **`src/lib.rs`** — `convert(input)` decodes UTF-8, splits into messages at `MSH` boundaries, dispatches each by `MSH-9` (`ORU^R01` / `ORM^O01`), `to_ndjson`. Empty input → empty.
- **`src/mapping.rs`** — message → FHIR.

**ORU^R01 → FHIR:**
- `PID` → Patient (PID-3 id, PID-5 family^given, PID-7 birthDate, PID-8 sex M/F→male/female).
- `PV1` → patient class (PV1-2 I/O/E → inpatient/outpatient/unknown) → specimen origin extension.
- `ORC`/`OBR` → ServiceRequest (OBR-4 universal service id → code) + DiagnosticReport.
- `SPM` → Specimen (SPM-4 type, SPM-17 collection datetime, origin from PV1).
- `OBX` → Observations, classified **deterministically**:
  1. **AST result** ⟺ `OBX-8` (Interpretation, HL7 table **0078**) ∈ susceptibility set `{S, I, R, SDD, NS}` → `observation_ast` (antibiotic = `OBX-3` code preferred over text; interpretation = normalized `OBX-8`).
  2. **Organism identification** ⟺ `OBX-3` code ∈ organism-ID code set (default LOINC `634-6`, `88040-1`) **and** `OBX-2` value type ∈ `{CE, CWE, CF}` → `observation_organism` (organism = coded `OBX-5`).
  3. else → skipped.
  Precedence: rule 1 before rule 2. No free-text matching.

**ORM^O01 → FHIR:** Patient (PID) + ServiceRequest (ORC/OBR) only.

**Optional config:** `organismIdCodes` (extend the organism-ID set) + `astInterpretationCodes` (extend/override the OBX-8 susceptibility set), both with the LOINC/HL70078 defaults above — works out-of-the-box, declarable per LIS.

## Section 4: CSV/Excel plugin (`wasm/tabular`)

New Rust cdylib; `wasi:false`; id `tabular`; built to `reference-plugins/tabular/`.

- **`src/reader.rs`** — sniffs the input: `.xlsx` (ZIP magic `50 4B 03 04`) → **calamine** (first sheet, or config `sheet`); else **csv** crate (comma/tab sniffed from the header). Both → `Vec<HashMap<header, value>>`.
- **`src/lib.rs`** — `convert(input)` reads the mapping from `config::get("mapping")` → parses rows → maps each → `to_ndjson`. Empty input → empty.
- **`src/mapping.rs`** — config-driven row→FHIR (the WHONET mapping generalized), reusing the SDK builders.

**Mapping config (`mapping` config value, JSON):**
```json
{ "sheet": "Sheet1",
  "patientId": "PatientID", "gender": "Sex", "genderMap": {"M":"male","F":"female"},
  "birthDate": "DOB", "specimenId": "SpecimenNo", "specimenType": "Specimen",
  "collectedDate": "CollectionDate", "origin": "LocationType",
  "originMap": {"I":"inpatient","O":"outpatient"},
  "organism": "Organism", "organismCode": "OrganismCode",
  "antibiotics": [ {"column":"AMP","code":"AMP"}, {"column":"CIP","code":"CIP"} ] }
```
Each row → Patient + Specimen (origin via `originMap`) + organism Observation (if `organism` present) + one AST Observation per antibiotic column whose cell ∈ {S,I,R}. Stable ids from `patientId`/`specimenId` (row-index fallback). Value maps optional.

**Fail-loud validation:** requires `patientId` + `specimenId` + (`organism` or `antibiotics`); missing/invalid/absent mapping → `convert` returns an error → batch fails with a clear audited message.

**SIR normalization:** antibiotic cells trimmed+uppercased; only {S,I,R} become AST obs; others skipped.

## Section 5: Wiring, samples, testing & acceptance

- **build:** `scripts/build-wasm-plugins.mjs` extended to build `hl7v2` + `tabular` and stage them.
- **samples:** `samples/hl7-oru-sample.hl7` (ORU micro + one ORM), `samples/lab-sample.csv` + `samples/lab-mapping.json`, and `scripts/make-lab-sample.mjs` that also writes `samples/lab-sample.xlsx` (SheetJS script devDep).

**Testing:**
- **TS unit (vitest):** `extism-runner` passes `config` to `createPlugin` (fake assertion); `wasm-converter` forwards `ctx.config`; `ConvertContext.config` flows through `handleIngestEvent`; `BatchStore` persists/returns `config`; CLI `--config` file → config map.
- **Rust unit (`cargo test`):** HL7 parser (split/unescape/multi-message); HL7 mapping (ORU→organism+AST+ServiceRequest+DiagnosticReport, ORM→ServiceRequest, OBX classification + precedence); tabular mapping (config-driven row→resources, value maps, fail-loud validation); tabular CSV reader (xlsx via live acceptance).
- **Live acceptance:** build both plugins; install; ingest the HL7 sample → FHIR → `amr-first-isolate-summary` shows HL7 isolates with PV1 origin; ingest the CSV `--config lab-mapping.json` → FHIR → reports; ingest the xlsx → same isolates; confirm `pipeline retry` works (config persisted). **Multi-format proven (P2-PLUG-3): WHONET + HL7 + tabular via one contract.** Full gates (`typecheck`/`test`/`depcruise`/`build:check`).

## Error handling

- Tabular: missing/invalid config or required keys → `convert` Err → batch `failed` (audited `ingest.batch.failed`), no partial output.
- HL7: unparseable message / unknown `MSH-9` → skip that message (logged) or Err on a structurally invalid message; malformed segment → best-effort field access (missing fields → null/skip).
- Plugin runtime errors (timeout, instantiate) surface as batch failure via the existing outbox retry path.

## Carry-forwards

- HL7 organism/AST code sets default to LOINC/HL70078 (operator-extensible via config); the parser targets common LIS ORU layouts.
- Tabular is **wide-format** (one row = one isolate, antibiotic-per-column) + first-sheet; long-format is a future mapping mode.
- Extism 1.0.3 memory/timeout sandbox limits remain best-effort (existing carry-forward; hard enforcement awaits a newer SDK).
- `.xlsx` only (not legacy `.xls`).

## Task decomposition (preview for the plan)

1. Plugin-config channel in `@openldr/plugins` (runner + extism-runner + wasm-converter) (TDD).
2. `@openldr/ingest` config threading (ConvertContext, handle, acceptPayload, AcceptInput, republish) (TDD).
3. `@openldr/db` migration `010_ingest_batch_config` + `IngestBatchesTable` + `BatchStore` config (TDD where unit-testable).
4. CLI `ingest --config` (read file → config map) (TDD).
5. SDK `service_request` + `diagnostic_report` builders (Rust TDD).
6. `wasm/hl7v2` parser (Rust TDD).
7. `wasm/hl7v2` ORU/ORM mapping + OBX classification + `convert` + manifest (Rust TDD).
8. `wasm/tabular` reader (csv + calamine) + config schema + mapping + `convert` + manifest (Rust TDD).
9. Samples + `make-lab-sample.mjs` + `build:plugins` wiring.
10. Live acceptance (build, ingest HL7 + CSV + xlsx, reports, retry) + memory + finish.
