# AMR / GLASS Report Pack — Design

**Status:** Approved (brainstorming) — ready for implementation plan
**Date:** 2026-06-14
**PRD coverage:** P2-REP-1 (GLASS-aligned reports on the multi-driver reporting layer), P2-REP-2 (antibiogram + correct denominators + first-isolate dedup), P2-REP-3 (GLASS-aligned output/export), P2-REP-4 (PDF output), P2-NFR-3 (multi-driver). Adds a patient-origin field across FHIR/flatten/plugin.
**Builds on:** Phase-1 reporting layer (`@openldr/reporting`: Kysely-filter + pure-helper pattern, no raw SQL; `ReportDefinition`/`ReportResultData`; `toCsv`), the FHIR flatten pipeline, the WHONET Rust plugin, the multi-driver target store (`engine` factory + `dialect.ts`).

---

## Goal

Produce WHO GLASS-aligned AMR surveillance output: cumulative antibiograms and first-isolate resistance summaries with correct denominators, the official GLASS-AMR RIS submission file, and PDF report rendering — all on the existing multi-driver reporting layer (Postgres + SQL Server). Adds a patient-origin dimension (inpatient/outpatient) sourced at ingest.

**Decided in brainstorming:** both GLASS-aligned reports AND the official submission-format export; PDF rendering included; first-isolate = per patient+pathogen+specimen-type, earliest in window; origin = an ingest-set coded field on the **specimen**; AMR engine as a module in `@openldr/reporting`; PDF via **pdfkit** (no Chromium); GLASS official **code-list conformance deferred** (structure correct, codes emitted as-present). Built as **one slice**.

---

## AMR data model (verified)

- **Pathogen** = organism-identification observation: `code_code='634-6'` ("Bacteria identified"), `value_code` (e.g. `eco`), `value_text` (e.g. `Escherichia coli`), linked to a specimen via `specimen_ref`.
- **AST result** = observation with `code_text`=antibiotic (e.g. `AMP`), `interpretation_code` ∈ `S|I|R`, same `specimen_ref`.
- **Specimen** = `type_code` (BLOOD/URINE…), `received_time`, **`origin`** (new).
- **Patient** = `gender`, `birth_date`.
- An **isolate** = one organism obs + the AST obs sharing its `specimen_ref`, joined to specimen + patient.
- **Isolate date** = `observation.effective_date_time ?? specimen.received_time` (robust to the WHONET null-`effective_date_time` carry-forward, since `received_time` comes from `spec_date`).

---

## Section 1: Patient origin pipeline (FHIR → flatten → plugin)

1. **`@openldr/fhir`** — add a shared CE extension URL constant `EXT_OPENLDR_SPECIMEN_ORIGIN` (`https://openldr.org/fhir/StructureDefinition/specimen-origin`) + a tested helper `readSpecimenOrigin(resource): 'inpatient'|'outpatient'|'unknown'|null` reading `Specimen.extension[]`. Specimen schema is already `.passthrough()` — no schema change; the extension survives canonical storage.
2. **`@openldr/db`** — external migration `002_specimen_origin` (dialect-aware via the `engine` factory + `dialect.ts`: PG `text` / MSSQL `nvarchar(450)`) adds nullable `specimens.origin`. `SpecimensTable` gains `origin: string | null`. `flattenSpecimen` reads `readSpecimenOrigin` → `origin`, normalized to `inpatient`/`outpatient`/`unknown`.
3. **WHONET plugin (`wasm/whonet-sqlite` + `openldr-plugin-sdk`)** — extend the `isolates` SELECT with an optional `location_type` column (discovered absent-tolerantly like `ab_*`); map WHONET location semantics (`i`→inpatient, `o`→outpatient, else unknown); `fhir::specimen(...)` accepts `origin: Option<&str>` and emits the extension. `make:whonet-sample` adds a `location_type` column so acceptance has real data.
4. **Consumers** — the AMR engine reads `specimens.origin`, defaulting null/missing to `unknown` (a valid GLASS value).

Origin is on the **specimen** (not order/patient) because the isolate is specimen-centric, giving an unambiguous join.

## Section 2: AMR epidemiology engine (`@openldr/reporting/src/amr/`, pure)

Established rule: filtering/joins/grouping in Kysely (multi-driver, no raw SQL); all epidemiology in pure unit-tested helpers.

**Query layer** fetches raw rows: organism observations (`code_code='634-6'`), AST observations (`interpretation_code in ('S','I','R')`), specimens (`type_code`, `received_time`, `origin`), patients (`gender`, `birth_date`) — windowed by date where applicable.

**Pure helpers:**
```ts
interface Isolate {
  patientId: string; specimenType: string; origin: 'inpatient' | 'outpatient' | 'unknown';
  pathogenCode: string; pathogenName: string; date: string | null;
  gender: string; ageBand: string;
  results: { antibiotic: string; ris: 'R' | 'I' | 'S' }[];
}
```
- `buildIsolates(orgObs, astObs, specimens, patients) → Isolate[]` — group AST obs by `specimen_ref`; organism obs on that specimen gives the pathogen; specimen gives type/origin/`received_time`; patient gives gender/age; `date = obs.effective_date_time ?? specimen.received_time`.
- `firstIsolate(isolates, window) → Isolate[]` — keep the **earliest** isolate per `(patientId, pathogenCode, specimenType)` in the window (sort by date asc; dateless sort last); dedup by key.
- `aggregateRIS(isolates) → { specimenType, pathogen, antibiotic, tested, r, i, s, percentR }[]` — one R/I/S contribution per antibiotic per isolate; `percentR = round(r / tested * 100, 1)` with `tested` including I (GLASS denominator).
- `antibiogram(isolates, opts?) → { pathogen, byAntibiotic: Record<string, { tested: number; percentR: number }> }[]` — cumulative pathogen × antibiotic %R matrix.
- `ageBandGlass(birthDate, refDate) → string` — WHO GLASS age groups: `0`, `1-4`, `5-14`, `15-24`, `25-34`, `35-44`, `45-54`, `55-64`, `65+`, `unknown`.

**Params:** `from`/`to` (the first-isolate dedup window) + optional `specimenType`/`pathogen` filters.

## Section 3: Reports + GLASS submission export

**`ReportDefinition`s** (register in `reportCatalog()` → API/CSV/dashboard/CLI automatically):
- **`amr-antibiogram`** — first-isolate pathogen × antibiotic %R matrix; columns built from the data (`[pathogen, ...antibiotics]`), cells `%R (N)`; `chart` = `stat`/`bar` summary (the matrix is the table; Recharts has no heatmap).
- **`amr-first-isolate-summary`** — rows per `(specimenType, pathogen, antibiotic)` → `tested/r/i/s/%R`; `chart` = bar of %R.
- **`amr-glass-ris`** — fully-stratified aggregate `(specimenType, pathogen, antibiotic, ageBand, gender, origin)` → `R/I/S/tested`; doubles as the submission data source.

All run first-isolate dedup over the `from`/`to` window before aggregating.

**GLASS submission export** — pure `toGlassRis(isolates, meta) → GlassRisRow[]` producing the official WHO **GLASS-AMR RIS aggregate** structure: per row `Iso3Country, Year, Specimen, PathogenCode, AntibioticCode, Gender, AgeGroup, Origin, Resistant, Intermediate, Susceptible` (+ derived totals). `meta = { country: string /*ISO3*/, year: number }` from params. Output as **CSV** (the GLASS upload format) + JSON via `toCsv`. Surfaced via CLI `report glass-export --country <ISO3> --year <YYYY> [--from --to] [--out <file>]` and API `GET /api/reports/glass/ris.csv`.

**Scope boundary:** the **structure/columns/stratification are official GLASS**; **code VALUES are emitted as present in the data** (WHONET-aligned: `eco`/`AMP`/`BLOOD`). Full conformance to GLASS official code lists (WHONET→GLASS `ConceptMap` via the terminology service) is a **documented refinement**, not this slice.

## Section 4: PDF rendering (`@openldr/report-pdf`, pdfkit)

A standalone package keeps `pdfkit` out of `@openldr/reporting`'s consumers:
- **`@openldr/report-pdf`** — deps: `pdfkit` only, **no `@openldr/*`**. `renderReportPdf(input): Buffer` where `input = { title, generatedAt, params, columns: {key,label}[], rows: Record<string,unknown>[] }` (a `ReportResult` satisfies this structurally).
- **Layout:** a small grid/table helper (pdfkit has no native tables) — header band, params line, paginated table (bold header repeated per page, zebra rows, page breaks), footer with page numbers. Optional thin `%R` bar for the summary. pdfkit's built-in Helvetica means **no external font files**.
- **Output:** a `Buffer`; deterministic + unit-testable (`%PDF-` header, non-trivial size, round-trips a known title/row).
- **Why pdfkit not Chromium:** no ~300 MB browser in the server image; deterministic/testable; the AMR reports are tabular.

## Section 5: Wiring

- The three AMR reports register in `reportCatalog()` → surfaced by `reporting.run/list`, `/api/reports`, `report list|run` with no extra plumbing.
- `AppContext.reporting` gains `renderPdf(id, rawParams) → Buffer` and `glassRis(params) → { columns, rows }`.
- **CLI:** `report run <id> --format pdf [--out <file>]` (extends `--json|--csv`); `report glass-export --country <ISO3> --year <YYYY> [--from --to] [--out <file>]`.
- **API:** `GET /api/reports/:id.pdf` (application/pdf) + `GET /api/reports/glass/ris.csv` — registered before the `:id` param routes (like the existing `.csv`).
- **Dashboard (`apps/web`):** two thin cards (antibiogram + first-isolate summary) reusing `<ReportView>` (the dynamic-column antibiogram renders in its table). Minimal; reports are fully usable via API/CLI regardless.

## Error handling

- Unknown report id → `ReportNotFoundError` (404); bad params → ZodError (400); DB connection → 503 (existing error map). PDF/GLASS export of an unknown id → same 404 path.
- `glass-export` with no `country`/`year` → clear validation error.
- Isolates with no usable date are retained but sort last in first-isolate; origin null → `unknown`.

## Testing

**Stack-free unit (vitest):** `buildIsolates` (join correctness), `firstIsolate` (dedup key + earliest + dateless handling), `aggregateRIS` (denominators incl. I), `antibiogram` (matrix), `ageBandGlass` (boundaries), `toGlassRis` (stratification + meta), `readSpecimenOrigin`, `@openldr/report-pdf` (`%PDF-` header + round-trip), the `002_specimen_origin` dialect helper. Queries are acceptance-verified (no DB unit test), consistent with existing reports.

**Live acceptance (multi-driver, P2-NFR-3):** build the WHONET plugin with `location_type` → `make:whonet-sample` → ingest → confirm `specimens.origin` populated → run `amr-antibiogram` / `amr-first-isolate-summary` / `amr-glass-ris` + CSV + **PDF** + **GLASS export** via CLI & API → verify first-isolate dedup counts + origin/age/gender stratification on real data, on **both Postgres and SQL Server**.

Full gates: `typecheck` / `test` / `depcruise` / `build:check`.

## Carry-forwards

- GLASS official code-list conformance (WHONET→GLASS `ConceptMap` via terminology) deferred.
- PDF charts basic (tables-first; no rich Recharts fidelity).
- Origin currently emitted only by the WHONET plugin; other ingest paths set the CE extension to populate it.
- Isolates with no usable date sort last in first-isolate.
- Dashboard cards are thin (full report UX is the deferred management-UI sub-project).

## Task decomposition (preview for the plan)

1. FHIR origin extension constant + `readSpecimenOrigin` (TDD).
2. db `002_specimen_origin` migration (dialect-aware) + `SpecimensTable.origin` + `flattenSpecimen`.
3. WHONET plugin + `openldr-plugin-sdk` + `make:whonet-sample`: `location_type` → origin extension.
4. AMR engine pure helpers `buildIsolates`/`firstIsolate`/`aggregateRIS`/`antibiogram`/`ageBandGlass` (TDD).
5. `toGlassRis` formatter (TDD).
6. Three `ReportDefinition`s + register in the catalog.
7. `@openldr/report-pdf` package (pdfkit, TDD).
8. Bootstrap `reporting.renderPdf` + `reporting.glassRis`.
9. CLI `report run --format pdf` + `report glass-export`.
10. Server `/api/reports/:id.pdf` + `/api/reports/glass/ris.csv`.
11. Dashboard antibiogram + summary cards.
12. Live multi-driver acceptance + memory + finish.
