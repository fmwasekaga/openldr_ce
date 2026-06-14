# AMR / GLASS Report Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WHO GLASS-aligned AMR surveillance output — cumulative antibiogram + first-isolate resistance summaries (correct denominators), the official GLASS-AMR RIS submission file, and PDF report rendering — on the existing multi-driver reporting layer, plus a patient-origin dimension sourced at ingest.

**Architecture:** A pure AMR epidemiology module in `@openldr/reporting/src/amr/` (Kysely-filter + pure-helper pattern, no raw SQL) feeds three `ReportDefinition`s and a `toGlassRis` formatter. Origin flows FHIR extension → `specimens.origin` (dialect-aware migration + flatten) → WHONET Rust plugin. PDF via a standalone `@openldr/report-pdf` (pdfkit, no Chromium).

**Tech Stack:** TypeScript ESM, Kysely (multi-driver), zod (params), pdfkit (PDF), Rust/wasm (WHONET plugin), vitest, Docker (Postgres + SQL Server).

**Spec:** `docs/superpowers/specs/2026-06-14-amr-glass-reports-design.md`.

---

## Key facts (verified in the codebase)

- **Reporting** (`packages/reporting/src/`): `types.ts` — `ReportDefinition<P> { id, name, description, params: ZodType<P>, run(db: Kysely<ExternalSchema>, p): Promise<ReportResultData> }`; `ReportResultData { columns: {key,label,kind:'string'|'number'|'percent'|'date'}[], rows: Record<string,unknown>[], chart }`; `ChartHint` includes `{type:'bar',x,y}` / `{type:'stat',value,label}`. `helpers.ts` — `endOfDay(to)`, `toCsv(columns, rows)`, `ageBand(birthDate, refIso)`, `monthKey`. `catalog.ts` — `REPORTS: ReportDefinition[]` + `getReport`/`reportSummaries`/`reportCatalog`. `index.ts` re-exports types/helpers/catalog (+ `eventsource` from Slice B).
- **AMR data shapes** (`packages/db/src/schema/external.ts`): organism obs `code_code='634-6'`, `value_code`, `value_text`, `subject_ref`, `specimen_ref`; AST obs `code_text`=antibiotic, `interpretation_code in ('S','I','R')`, `subject_ref`, `specimen_ref`; specimens `id`, `type_code`, `subject_ref`, `received_time`; patients `id`, `gender`, `birth_date`. `subject_ref` is `Patient/{id}`; `specimen_ref` is `Specimen/{id}`.
- **WHONET date gap:** `wasm/openldr-plugin-sdk/src/fhir.rs::specimen` emits the date as `collection.collectedDateTime`, but `packages/db/src/flatten/specimen.ts` reads `r['receivedTime']` → `specimens.received_time` is **null** for WHONET. Task 2 fixes flatten to coalesce `collection.collectedDateTime`. AST/organism obs carry no `effectiveDateTime`. So the **isolate date = `observation.effective_date_time ?? specimen.received_time`** is reliable only after Task 2.
- **Flatten** (`packages/db/src/flatten/`): `flattenSpecimen(r, prov)` uses helpers from `extract.ts` (`str`, `codeable`, `reference`, `firstIdentifier`, `provColumns`). `flatten/index.ts` dispatches by resourceType.
- **External migrations** (`packages/db/src/migrations/external/`): `externalMigrations(engine)` factory keyed by name (only `001_flat_tables`). `dialect.ts` — `textType(engine)` (`text`/`nvarchar(max)`), `keyType`, `floatType`, `timestampType`, `nowExpr`. DDL uses `sql.raw(textType(engine))`. `packages/db/src/migrations/migrations.test.ts` asserts external keys `['001_flat_tables']`.
- **WHONET plugin** (`wasm/whonet-sqlite/src/mapping.rs`): selects `patient_id, sex, birth_date, spec_num, spec_type, spec_date, organism, organism_code` + discovered `ab_*` columns (via `PRAGMA table_info`); builds Patient/Specimen/organism+AST observations via the SDK (`wasm/openldr-plugin-sdk/src/fhir.rs`). `scripts/make-whonet-sample.mjs` builds the `isolates` SQLite table (node:sqlite). Building the wasm needs the Rust/wasi toolchain (`pnpm build:plugins`; see memory toolchain notes).
- **CLI** (`packages/cli/src/report.ts`): `runReportRun(id, {param[], json, csv})` via `createAppContext().reporting.run`; registered in `packages/cli/src/index.ts`.
- **Server** (`apps/server/src/reports-routes.ts`): `registerReportRoutes(app, ctx)` — `/api/reports`, `/api/reports/:id.csv` (BEFORE `:id`), `/api/reports/:id`; `mapError` → 404/400/503/500.
- **Bootstrap** (`packages/bootstrap/src/index.ts`): `ReportingApi { list, run, runEventSource }` over `reportingDb = store.db as Kysely<ExternalSchema>`; `ReportNotFoundError`.
- **Dashboard** (`apps/web`): a card grid + `<ReportView>` (Recharts + table) driven by `/api/reports/:id`. (Read `apps/web/src/` for the exact card array + ReportView props before Task 11.)
- **FHIR** (`packages/fhir/src/`): resources use zod `.passthrough()` (extensions preserved). No `EXT_OPENLDR_*` constant exists yet in `packages/fhir/src` (form extensions live in `@openldr/forms`). Add the origin constant to `@openldr/fhir`.

---

## Task 1: FHIR `EXT_OPENLDR_SPECIMEN_ORIGIN` + `readSpecimenOrigin`

**Files:**
- Create: `packages/fhir/src/extensions/specimen-origin.ts`
- Create: `packages/fhir/src/extensions/specimen-origin.test.ts`
- Modify: `packages/fhir/src/index.ts`

- [ ] **Step 1: Write failing test** — `packages/fhir/src/extensions/specimen-origin.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { EXT_OPENLDR_SPECIMEN_ORIGIN, readSpecimenOrigin } from './specimen-origin';

describe('readSpecimenOrigin', () => {
  const ext = (code: string) => ({ resourceType: 'Specimen', id: 's', extension: [{ url: EXT_OPENLDR_SPECIMEN_ORIGIN, valueCode: code }] });
  it('reads a valid origin code', () => {
    expect(readSpecimenOrigin(ext('inpatient'))).toBe('inpatient');
    expect(readSpecimenOrigin(ext('outpatient'))).toBe('outpatient');
    expect(readSpecimenOrigin(ext('unknown'))).toBe('unknown');
  });
  it('returns null when the extension is absent', () => {
    expect(readSpecimenOrigin({ resourceType: 'Specimen', id: 's' })).toBeNull();
  });
  it('returns null for an unrecognized code', () => {
    expect(readSpecimenOrigin(ext('bogus'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @openldr/fhir test`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `packages/fhir/src/extensions/specimen-origin.ts`:**
```ts
export const EXT_OPENLDR_SPECIMEN_ORIGIN = 'https://openldr.org/fhir/StructureDefinition/specimen-origin';

export type SpecimenOrigin = 'inpatient' | 'outpatient' | 'unknown';

const VALID: ReadonlySet<string> = new Set(['inpatient', 'outpatient', 'unknown']);

/** Reads the CE specimen-origin extension (`valueCode`) from a Specimen resource; null if absent/invalid. */
export function readSpecimenOrigin(resource: unknown): SpecimenOrigin | null {
  const exts = (resource as { extension?: { url?: string; valueCode?: string }[] } | null)?.extension;
  if (!Array.isArray(exts)) return null;
  const hit = exts.find((e) => e?.url === EXT_OPENLDR_SPECIMEN_ORIGIN);
  const code = hit?.valueCode;
  return code && VALID.has(code) ? (code as SpecimenOrigin) : null;
}
```

- [ ] **Step 4: Export** — append to `packages/fhir/src/index.ts`:
```ts
export * from './extensions/specimen-origin';
```

- [ ] **Step 5: Run, verify pass** — `pnpm --filter @openldr/fhir test && pnpm --filter @openldr/fhir typecheck`. Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add packages/fhir/src/extensions/specimen-origin.ts packages/fhir/src/extensions/specimen-origin.test.ts packages/fhir/src/index.ts
git commit -m "feat(fhir): specimen-origin CE extension + readSpecimenOrigin (P2-REP)"
```

---

## Task 2: `specimens.origin` migration + schema + flatten (origin + collection date)

**Files:**
- Create: `packages/db/src/migrations/external/002_specimen_origin.ts`
- Modify: `packages/db/src/migrations/external/index.ts`
- Modify: `packages/db/src/schema/external.ts`
- Modify: `packages/db/src/migrations/migrations.test.ts`
- Modify: `packages/db/src/flatten/specimen.ts`

- [ ] **Step 1: Create `packages/db/src/migrations/external/002_specimen_origin.ts`** (dialect-aware ALTER):
```ts
import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType } from './dialect';

export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  await db.schema.alterTable('specimens').addColumn('origin', sql.raw(textType(engine))).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('specimens').dropColumn('origin').execute();
}
```

- [ ] **Step 2: Register** in `packages/db/src/migrations/external/index.ts` — add `import * as m002 from './002_specimen_origin';` and the entry after `'001_flat_tables'`:
```ts
    '002_specimen_origin': { up: (db) => m002.up(db, engine), down: m002.down },
```

- [ ] **Step 3: Schema** — in `packages/db/src/schema/external.ts`, add to `SpecimensTable` (after `received_time`):
```ts
  origin: string | null;
```

- [ ] **Step 4: Update the external-keys assertion** in `packages/db/src/migrations/migrations.test.ts` — change `expect(Object.keys(ext)).toEqual(['001_flat_tables'])` to `['001_flat_tables', '002_specimen_origin']` (keep however `ext` is built, e.g. `externalMigrations('postgres')`).

- [ ] **Step 5: Update `packages/db/src/flatten/specimen.ts`** — read the origin extension + coalesce the collection date into `received_time`. Replace the file with:
```ts
import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { SpecimensTable } from '../schema/external';
import { readSpecimenOrigin } from '@openldr/fhir';
import { provColumns, firstIdentifier, codeable, reference, str } from './extract';

export function flattenSpecimen(r: Record<string, unknown>, prov: Provenance): Insertable<SpecimensTable> {
  const idn = firstIdentifier(r);
  const type = codeable(r['type']);
  const accession = (r['accessionIdentifier'] as Record<string, unknown> | undefined)?.['value'];
  const parent = (r['parent'] as Record<string, unknown>[] | undefined)?.[0];
  const collected = (r['collection'] as Record<string, unknown> | undefined)?.['collectedDateTime'];
  return {
    id: String(r['id']),
    identifier_value: idn.value,
    accession: str(accession),
    status: str(r['status']),
    type_code: type.code,
    type_text: type.text,
    subject_ref: reference(r['subject']),
    parent_ref: reference(parent),
    received_time: str(r['receivedTime']) ?? str(collected),
    origin: readSpecimenOrigin(r),
    ...provColumns(prov),
  };
}
```
(`@openldr/db` already depends on `@openldr/fhir`; if not, add `"@openldr/fhir": "workspace:*"` to `packages/db/package.json` and `pnpm install`.)

- [ ] **Step 6: Run** — `pnpm --filter @openldr/db test && pnpm --filter @openldr/db typecheck`. Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add packages/db/src/migrations/external/002_specimen_origin.ts packages/db/src/migrations/external/index.ts packages/db/src/schema/external.ts packages/db/src/migrations/migrations.test.ts packages/db/src/flatten/specimen.ts
git commit -m "feat(db): specimens.origin migration + flatten origin/collection-date (P2-REP)"
```

---

## Task 3: WHONET plugin — `location_type` → origin extension

**Files:**
- Modify: `wasm/openldr-plugin-sdk/src/fhir.rs`
- Modify: `wasm/whonet-sqlite/src/mapping.rs`
- Modify: `scripts/make-whonet-sample.mjs`

> Building the wasm requires the Rust/wasi toolchain (`pnpm build:plugins`). If unavailable in this environment, make the source changes + commit and verify by reading; the live build happens in Task 12.

- [ ] **Step 1: SDK — add origin to `specimen`** in `wasm/openldr-plugin-sdk/src/fhir.rs`. Replace the `specimen` fn:
```rust
/// A Specimen referencing a subject, with optional type code, collection date, and origin.
pub fn specimen(id: &str, subject_ref: &str, type_code: Option<&str>, collected: Option<&str>, origin: Option<&str>) -> Value {
    let mut s = json!({ "resourceType": "Specimen", "id": id, "subject": { "reference": subject_ref } });
    if let Some(t) = type_code {
        s["type"] = json!({ "coding": [{ "code": t }] });
    }
    if let Some(c) = collected {
        s["collection"] = json!({ "collectedDateTime": c });
    }
    if let Some(o) = origin {
        s["extension"] = json!([{ "url": "https://openldr.org/fhir/StructureDefinition/specimen-origin", "valueCode": o }]);
    }
    s
}
```

- [ ] **Step 2: WHONET mapping** in `wasm/whonet-sqlite/src/mapping.rs` — make `location_type` an absent-tolerant column (discover it like `ab_*`), map it to origin, and pass it to `specimen`. After the `ab_cols` discovery block, add a flag:
```rust
    let has_location: bool = {
        let mut stmt = conn.prepare("PRAGMA table_info(isolates)")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(1))?;
        let mut found = false;
        for name in rows { if name? == "location_type" { found = true; } }
        found
    };
```
Change the `base` constant to conditionally include `location_type`:
```rust
    let base = if has_location {
        "patient_id, sex, birth_date, spec_num, spec_type, spec_date, organism, organism_code, location_type"
    } else {
        "patient_id, sex, birth_date, spec_num, spec_type, spec_date, organism, organism_code"
    };
```
After `let organism_code: Option<String> = row.get(7)?;` add (origin read only when present; ab_* index shifts accordingly):
```rust
        let location_type: Option<String> = if has_location { row.get(8)? } else { None };
        let origin = location_type.as_deref().map(|l| match l.to_ascii_lowercase().as_str() {
            "i" | "in" | "inpatient" => "inpatient",
            "o" | "out" | "outpatient" => "outpatient",
            _ => "unknown",
        });
        let ab_base = if has_location { 9 } else { 8 };
```
Change the ab value read to use `ab_base`:
```rust
            let val: Option<String> = row.get(ab_base + i)?;
```
Change the specimen build call:
```rust
        out.push(fhir::specimen(&sid, &patient_ref, spec_type.as_deref(), spec_date.as_deref(), origin));
```

- [ ] **Step 3: Sample generator** — in `scripts/make-whonet-sample.mjs`, add `location_type` to the DDL + inserts:
```js
db.exec(`
  DROP TABLE IF EXISTS isolates;
  CREATE TABLE isolates (
    patient_id TEXT, sex TEXT, birth_date TEXT,
    spec_num TEXT, spec_type TEXT, spec_date TEXT,
    organism TEXT, organism_code TEXT, location_type TEXT,
    ab_AMP TEXT, ab_CIP TEXT, ab_GEN TEXT
  );
`);
const insert = db.prepare('INSERT INTO isolates VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
insert.run('P001', 'F', '1990-04-12', 'S001', 'BLOOD', '2026-01-10', 'Escherichia coli', 'eco', 'i', 'R', 'S', 'S');
insert.run('P002', 'M', '1985-11-30', 'S002', 'URINE', '2026-01-11', 'Klebsiella pneumoniae', 'kpn', 'o', 'R', 'I', 'S');
```
(`location_type` sits between `organism_code` and `ab_AMP`, matching the SELECT order in Step 2; keep the INSERT column order in sync with the `CREATE TABLE`.)

- [ ] **Step 4: Validate JS + (best-effort) cargo** — `node --check scripts/make-whonet-sample.mjs`; if the Rust toolchain is present, `pnpm build:plugins` — else defer the build to Task 12.

- [ ] **Step 5: Commit**
```bash
git add wasm/openldr-plugin-sdk/src/fhir.rs wasm/whonet-sqlite/src/mapping.rs scripts/make-whonet-sample.mjs
git commit -m "feat(whonet-plugin): map location_type -> specimen origin extension (P2-REP)"
```

---

## Task 4: AMR engine — isolates + first-isolate + GLASS age bands (TDD)

**Files:**
- Create: `packages/reporting/src/amr/types.ts`
- Create: `packages/reporting/src/amr/isolates.ts`
- Create: `packages/reporting/src/amr/isolates.test.ts`
- Modify: `packages/reporting/src/index.ts`

- [ ] **Step 1: Create `packages/reporting/src/amr/types.ts`:**
```ts
export type Ris = 'R' | 'I' | 'S';
export type Origin = 'inpatient' | 'outpatient' | 'unknown';

export interface RawOrgObs { id: string; subjectRef: string | null; specimenRef: string | null; valueCode: string | null; valueText: string | null; date: string | null }
export interface RawAstObs { id: string; subjectRef: string | null; specimenRef: string | null; antibiotic: string | null; ris: string | null; date: string | null }
export interface RawSpecimen { id: string; typeCode: string | null; receivedTime: string | null; origin: string | null }
export interface RawPatient { id: string; gender: string | null; birthDate: string | null }

export interface Isolate {
  patientId: string;
  specimenType: string;
  origin: Origin;
  pathogenCode: string;
  pathogenName: string;
  date: string | null;
  gender: string;
  ageBand: string;
  results: { antibiotic: string; ris: Ris }[];
}
```

- [ ] **Step 2: Write failing test** — `packages/reporting/src/amr/isolates.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildIsolates, firstIsolate, ageBandGlass } from './isolates';
import type { RawAstObs, RawOrgObs, RawPatient, RawSpecimen } from './types';

const patients: RawPatient[] = [{ id: 'p1', gender: 'female', birthDate: '1990-01-01' }];
const specimens: RawSpecimen[] = [
  { id: 'sp1', typeCode: 'BLOOD', receivedTime: '2026-01-10', origin: 'inpatient' },
  { id: 'sp2', typeCode: 'BLOOD', receivedTime: '2026-02-15', origin: null },
];
const org: RawOrgObs[] = [
  { id: 'o1', subjectRef: 'Patient/p1', specimenRef: 'Specimen/sp1', valueCode: 'eco', valueText: 'E. coli', date: null },
  { id: 'o2', subjectRef: 'Patient/p1', specimenRef: 'Specimen/sp2', valueCode: 'eco', valueText: 'E. coli', date: null },
];
const ast: RawAstObs[] = [
  { id: 'a1', subjectRef: 'Patient/p1', specimenRef: 'Specimen/sp1', antibiotic: 'AMP', ris: 'R', date: null },
  { id: 'a2', subjectRef: 'Patient/p1', specimenRef: 'Specimen/sp2', antibiotic: 'AMP', ris: 'S', date: null },
];

describe('buildIsolates', () => {
  it('assembles isolates with pathogen, specimen, patient, date, origin', () => {
    const iso = buildIsolates(org, ast, specimens, patients);
    expect(iso).toHaveLength(2);
    expect(iso[0]).toMatchObject({ patientId: 'p1', specimenType: 'BLOOD', origin: 'inpatient', pathogenCode: 'eco', date: '2026-01-10', gender: 'female' });
    expect(iso[0].results).toEqual([{ antibiotic: 'AMP', ris: 'R' }]);
    expect(iso[1].origin).toBe('unknown'); // null origin -> unknown
  });
});

describe('firstIsolate', () => {
  it('keeps the earliest isolate per patient+pathogen+specimen-type', () => {
    const iso = buildIsolates(org, ast, specimens, patients);
    const first = firstIsolate(iso);
    expect(first).toHaveLength(1);
    expect(first[0].date).toBe('2026-01-10'); // the earlier of the two E. coli BLOOD isolates
    expect(first[0].results[0].ris).toBe('R');
  });
});

describe('ageBandGlass', () => {
  it('maps ages to GLASS bands', () => {
    expect(ageBandGlass('2025-06-01', '2026-01-01')).toBe('0');
    expect(ageBandGlass('2022-01-01', '2026-01-01')).toBe('1-4');
    expect(ageBandGlass('1990-01-01', '2026-01-01')).toBe('35-44');
    expect(ageBandGlass('1950-01-01', '2026-01-01')).toBe('65+');
    expect(ageBandGlass(null, '2026-01-01')).toBe('unknown');
  });
});
```

- [ ] **Step 3: Run, verify fail** — `pnpm --filter @openldr/reporting test`. Expected: FAIL (module missing).

- [ ] **Step 4: Implement `packages/reporting/src/amr/isolates.ts`:**
```ts
import type { Isolate, Origin, RawAstObs, RawOrgObs, RawPatient, RawSpecimen, Ris } from './types';

const GLASS_BANDS: [number, number, string][] = [
  [0, 0, '0'], [1, 4, '1-4'], [5, 14, '5-14'], [15, 24, '15-24'], [25, 34, '25-34'],
  [35, 44, '35-44'], [45, 54, '45-54'], [55, 64, '55-64'],
];

export function ageBandGlass(birthDate: string | null, refIso: string): string {
  if (!birthDate) return 'unknown';
  const b = new Date(birthDate); const ref = new Date(refIso);
  if (Number.isNaN(b.getTime()) || Number.isNaN(ref.getTime())) return 'unknown';
  let age = ref.getFullYear() - b.getFullYear();
  const m = ref.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < b.getDate())) age--;
  if (age < 0) return 'unknown';
  if (age >= 65) return '65+';
  for (const [lo, hi, label] of GLASS_BANDS) if (age >= lo && age <= hi) return label;
  return 'unknown';
}

function refId(ref: string | null): string | null {
  return ref ? ref.replace(/^[^/]+\//, '') : null;
}

function normOrigin(o: string | null): Origin {
  return o === 'inpatient' || o === 'outpatient' ? o : 'unknown';
}

export function buildIsolates(org: RawOrgObs[], ast: RawAstObs[], specimens: RawSpecimen[], patients: RawPatient[]): Isolate[] {
  const specById = new Map(specimens.map((s) => [s.id, s]));
  const patById = new Map(patients.map((p) => [p.id, p]));
  const astBySpec = new Map<string, RawAstObs[]>();
  for (const a of ast) {
    const sid = refId(a.specimenRef);
    if (!sid) continue;
    const list = astBySpec.get(sid);
    if (list) list.push(a); else astBySpec.set(sid, [a]);
  }
  const isolates: Isolate[] = [];
  for (const o of org) {
    const sid = refId(o.specimenRef);
    const pid = refId(o.subjectRef);
    if (!sid || !pid) continue;
    const spec = specById.get(sid);
    const pat = patById.get(pid);
    const specimenType = spec?.typeCode ?? '(unknown)';
    const date = o.date ?? spec?.receivedTime ?? null;
    const results = (astBySpec.get(sid) ?? [])
      .filter((a): a is RawAstObs & { antibiotic: string; ris: Ris } => a.antibiotic != null && (a.ris === 'R' || a.ris === 'I' || a.ris === 'S'))
      .map((a) => ({ antibiotic: a.antibiotic, ris: a.ris }));
    isolates.push({
      patientId: pid,
      specimenType,
      origin: normOrigin(spec?.origin ?? null),
      pathogenCode: o.valueCode ?? '(unknown)',
      pathogenName: o.valueText ?? o.valueCode ?? '(unknown)',
      date,
      gender: pat?.gender ?? 'unknown',
      ageBand: ageBandGlass(pat?.birthDate ?? null, date ?? '1970-01-01'),
      results,
    });
  }
  return isolates;
}

/** First isolate per (patient, pathogen, specimen-type): earliest by date (dateless sort last). */
export function firstIsolate(isolates: Isolate[]): Isolate[] {
  const sorted = [...isolates].sort((a, b) => {
    if (a.date === b.date) return 0;
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? -1 : 1;
  });
  const seen = new Set<string>();
  const out: Isolate[] = [];
  for (const iso of sorted) {
    const key = `${iso.patientId}|${iso.pathogenCode}|${iso.specimenType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(iso);
  }
  return out;
}
```
(Note: `ageBand` uses the isolate `date` as the reference, falling back to `'1970-01-01'` only when dateless — age is then `unknown`-ish but deterministic; acceptable since dateless isolates are edge cases.)

- [ ] **Step 5: Export** — append to `packages/reporting/src/index.ts`:
```ts
export * from './amr/types';
export * from './amr/isolates';
```

- [ ] **Step 6: Run, verify pass** — `pnpm --filter @openldr/reporting test && pnpm --filter @openldr/reporting typecheck`. Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add packages/reporting/src/amr/types.ts packages/reporting/src/amr/isolates.ts packages/reporting/src/amr/isolates.test.ts packages/reporting/src/index.ts
git commit -m "feat(reporting): AMR isolates + first-isolate dedup + GLASS age bands (P2-REP-2)"
```

---

## Task 5: AMR engine — RIS aggregation + antibiogram + GLASS RIS (TDD)

**Files:**
- Create: `packages/reporting/src/amr/aggregate.ts`
- Create: `packages/reporting/src/amr/aggregate.test.ts`
- Create: `packages/reporting/src/amr/glass.ts`
- Create: `packages/reporting/src/amr/glass.test.ts`
- Modify: `packages/reporting/src/index.ts`

- [ ] **Step 1: Write failing tests** — `packages/reporting/src/amr/aggregate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { aggregateRIS, antibiogram } from './aggregate';
import type { Isolate } from './types';

const iso = (patientId: string, ris: 'R' | 'I' | 'S'): Isolate => ({
  patientId, specimenType: 'BLOOD', origin: 'unknown', pathogenCode: 'eco', pathogenName: 'E. coli',
  date: '2026-01-10', gender: 'female', ageBand: '25-34', results: [{ antibiotic: 'AMP', ris }],
});

describe('aggregateRIS', () => {
  it('counts R/I/S and %R with I in the denominator', () => {
    const rows = aggregateRIS([iso('p1', 'R'), iso('p2', 'R'), iso('p3', 'I'), iso('p4', 'S')]);
    const amp = rows.find((r) => r.antibiotic === 'AMP')!;
    expect(amp).toMatchObject({ specimenType: 'BLOOD', pathogen: 'eco', tested: 4, r: 2, i: 1, s: 1 });
    expect(amp.percentR).toBe(50); // 2/4
  });
});

describe('antibiogram', () => {
  it('builds a pathogen x antibiotic %R matrix with N', () => {
    const m = antibiogram([iso('p1', 'R'), iso('p2', 'S')]);
    expect(m[0].pathogen).toBe('eco');
    expect(m[0].byAntibiotic.AMP).toEqual({ tested: 2, percentR: 50 });
  });
});
```
And `packages/reporting/src/amr/glass.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { toGlassRis } from './glass';
import type { Isolate } from './types';

const iso: Isolate = {
  patientId: 'p1', specimenType: 'BLOOD', origin: 'inpatient', pathogenCode: 'eco', pathogenName: 'E. coli',
  date: '2026-01-10', gender: 'female', ageBand: '25-34', results: [{ antibiotic: 'AMP', ris: 'R' }, { antibiotic: 'CIP', ris: 'S' }],
};

describe('toGlassRis', () => {
  it('emits one stratified row per pathogen/antibiotic/strata with counts + meta', () => {
    const rows = toGlassRis([iso], { country: 'SLE', year: 2026 });
    const amp = rows.find((r) => r.AntibioticCode === 'AMP')!;
    expect(amp).toMatchObject({ Iso3Country: 'SLE', Year: 2026, Specimen: 'BLOOD', PathogenCode: 'eco', Gender: 'female', AgeGroup: '25-34', Origin: 'inpatient', Resistant: 1, Intermediate: 0, Susceptible: 0, Total: 1 });
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @openldr/reporting test`. Expected: FAIL.

- [ ] **Step 3: Implement `packages/reporting/src/amr/aggregate.ts`:**
```ts
import type { Isolate } from './types';

export interface RisRow { specimenType: string; pathogen: string; antibiotic: string; tested: number; r: number; i: number; s: number; percentR: number }

function pct(r: number, tested: number): number { return tested === 0 ? 0 : Math.round((r / tested) * 1000) / 10; }

export function aggregateRIS(isolates: Isolate[]): RisRow[] {
  const map = new Map<string, RisRow>();
  for (const iso of isolates) {
    for (const res of iso.results) {
      const key = `${iso.specimenType}|${iso.pathogenCode}|${res.antibiotic}`;
      const row = map.get(key) ?? { specimenType: iso.specimenType, pathogen: iso.pathogenCode, antibiotic: res.antibiotic, tested: 0, r: 0, i: 0, s: 0, percentR: 0 };
      row.tested++;
      if (res.ris === 'R') row.r++; else if (res.ris === 'I') row.i++; else row.s++;
      map.set(key, row);
    }
  }
  const out = [...map.values()];
  for (const row of out) row.percentR = pct(row.r, row.tested);
  out.sort((a, b) => a.specimenType.localeCompare(b.specimenType) || a.pathogen.localeCompare(b.pathogen) || a.antibiotic.localeCompare(b.antibiotic));
  return out;
}

export interface AntibiogramRow { pathogen: string; byAntibiotic: Record<string, { tested: number; percentR: number }> }

/** Pathogen x antibiotic %R matrix, collapsing specimen types per (pathogen, antibiotic). */
export function antibiogram(isolates: Isolate[]): AntibiogramRow[] {
  const counts = new Map<string, Map<string, { tested: number; r: number }>>();
  for (const iso of isolates) {
    const byAb = counts.get(iso.pathogenCode) ?? new Map<string, { tested: number; r: number }>();
    for (const res of iso.results) {
      const c = byAb.get(res.antibiotic) ?? { tested: 0, r: 0 };
      c.tested++; if (res.ris === 'R') c.r++;
      byAb.set(res.antibiotic, c);
    }
    counts.set(iso.pathogenCode, byAb);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([pathogen, byAb]) => ({
    pathogen,
    byAntibiotic: Object.fromEntries([...byAb.entries()].map(([ab, c]) => [ab, { tested: c.tested, percentR: pct(c.r, c.tested) }])),
  }));
}
```

- [ ] **Step 4: Implement `packages/reporting/src/amr/glass.ts`:**
```ts
import type { Isolate } from './types';

export interface GlassRisRow {
  Iso3Country: string; Year: number; Specimen: string; PathogenCode: string; AntibioticCode: string;
  Gender: string; AgeGroup: string; Origin: string;
  Resistant: number; Intermediate: number; Susceptible: number; Total: number;
}

export function toGlassRis(isolates: Isolate[], meta: { country: string; year: number }): GlassRisRow[] {
  const map = new Map<string, GlassRisRow>();
  for (const iso of isolates) {
    for (const res of iso.results) {
      const key = [iso.specimenType, iso.pathogenCode, res.antibiotic, iso.gender, iso.ageBand, iso.origin].join('|');
      const row = map.get(key) ?? {
        Iso3Country: meta.country, Year: meta.year, Specimen: iso.specimenType, PathogenCode: iso.pathogenCode, AntibioticCode: res.antibiotic,
        Gender: iso.gender, AgeGroup: iso.ageBand, Origin: iso.origin, Resistant: 0, Intermediate: 0, Susceptible: 0, Total: 0,
      };
      if (res.ris === 'R') row.Resistant++; else if (res.ris === 'I') row.Intermediate++; else row.Susceptible++;
      row.Total++;
      map.set(key, row);
    }
  }
  return [...map.values()].sort((a, b) =>
    a.Specimen.localeCompare(b.Specimen) || a.PathogenCode.localeCompare(b.PathogenCode) || a.AntibioticCode.localeCompare(b.AntibioticCode) ||
    a.Gender.localeCompare(b.Gender) || a.AgeGroup.localeCompare(b.AgeGroup) || a.Origin.localeCompare(b.Origin));
}
```

- [ ] **Step 5: Export** — append to `packages/reporting/src/index.ts`:
```ts
export * from './amr/aggregate';
export * from './amr/glass';
```

- [ ] **Step 6: Run, verify pass** — `pnpm --filter @openldr/reporting test && pnpm --filter @openldr/reporting typecheck`. Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add packages/reporting/src/amr/aggregate.ts packages/reporting/src/amr/aggregate.test.ts packages/reporting/src/amr/glass.ts packages/reporting/src/amr/glass.test.ts packages/reporting/src/index.ts
git commit -m "feat(reporting): AMR RIS aggregation + antibiogram + GLASS RIS formatter (P2-REP-2/3)"
```

---

## Task 6: Query layer + three AMR `ReportDefinition`s

**Files:**
- Create: `packages/reporting/src/amr/query.ts`
- Create: `packages/reporting/src/reports/amr-antibiogram.ts`
- Create: `packages/reporting/src/reports/amr-first-isolate-summary.ts`
- Create: `packages/reporting/src/reports/amr-glass-ris.ts`
- Modify: `packages/reporting/src/catalog.ts`
- Modify: `packages/reporting/src/index.ts`

Verified by typecheck + live acceptance (SQL surface; no unit test, like existing reports).

- [ ] **Step 1: Create `packages/reporting/src/amr/query.ts`** (Kysely, no raw SQL):
```ts
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import { endOfDay } from '../helpers';
import type { RawAstObs, RawOrgObs, RawPatient, RawSpecimen } from './types';

export interface AmrWindow { from?: string; to?: string }
export interface AmrData { org: RawOrgObs[]; ast: RawAstObs[]; specimens: RawSpecimen[]; patients: RawPatient[] }

export async function fetchAmrData(db: Kysely<ExternalSchema>, w: AmrWindow): Promise<AmrData> {
  const orgRows = await db.selectFrom('observations').where('code_code', '=', '634-6')
    .select(['id', 'subject_ref', 'specimen_ref', 'value_code', 'value_text', 'effective_date_time']).execute();
  const astRows = await db.selectFrom('observations').where('interpretation_code', 'in', ['S', 'I', 'R'])
    .select(['id', 'subject_ref', 'specimen_ref', 'code_text', 'interpretation_code', 'effective_date_time']).execute();
  const specRows = await db.selectFrom('specimens').select(['id', 'type_code', 'received_time', 'origin']).execute();
  const patRows = await db.selectFrom('patients').select(['id', 'gender', 'birth_date']).execute();

  const specById = new Map(specRows.map((s) => [s.id, s]));
  const specDate = (ref: string | null): string | null => {
    const sid = ref ? ref.replace(/^[^/]+\//, '') : null;
    return sid ? (specById.get(sid)?.received_time ?? null) : null;
  };
  const inWindow = (d: string | null): boolean => {
    if (!w.from && !w.to) return true;
    if (!d) return true; // dateless retained (sort last downstream)
    if (w.from && d < w.from) return false;
    if (w.to && d > endOfDay(w.to)) return false;
    return true;
  };

  return {
    org: orgRows.filter((r) => inWindow(r.effective_date_time ?? specDate(r.specimen_ref)))
      .map((r) => ({ id: r.id, subjectRef: r.subject_ref, specimenRef: r.specimen_ref, valueCode: r.value_code, valueText: r.value_text, date: r.effective_date_time })),
    ast: astRows.map((r) => ({ id: r.id, subjectRef: r.subject_ref, specimenRef: r.specimen_ref, antibiotic: r.code_text, ris: r.interpretation_code, date: r.effective_date_time })),
    specimens: specRows.map((s) => ({ id: s.id, typeCode: s.type_code, receivedTime: s.received_time, origin: s.origin })),
    patients: patRows.map((p) => ({ id: p.id, gender: p.gender, birthDate: p.birth_date })),
  };
}
```

- [ ] **Step 2: Create `packages/reporting/src/reports/amr-first-isolate-summary.ts`:**
```ts
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportDefinition, ReportResultData } from '../types';
import { fetchAmrData } from '../amr/query';
import { buildIsolates, firstIsolate } from '../amr/isolates';
import { aggregateRIS } from '../amr/aggregate';

const params = z.object({ from: z.string().optional(), to: z.string().optional() });
type Params = z.infer<typeof params>;

export const amrFirstIsolateSummary: ReportDefinition<Params> = {
  id: 'amr-first-isolate-summary',
  name: 'AMR First-Isolate Resistance Summary',
  description: 'R/I/S counts and %R by specimen type, pathogen, and antibiotic (first isolate per patient).',
  params,
  async run(db: Kysely<ExternalSchema>, p: Params): Promise<ReportResultData> {
    const data = await fetchAmrData(db, p);
    const rows = aggregateRIS(firstIsolate(buildIsolates(data.org, data.ast, data.specimens, data.patients)));
    return {
      columns: [
        { key: 'specimenType', label: 'Specimen', kind: 'string' },
        { key: 'pathogen', label: 'Pathogen', kind: 'string' },
        { key: 'antibiotic', label: 'Antibiotic', kind: 'string' },
        { key: 'tested', label: 'Tested', kind: 'number' },
        { key: 'r', label: 'R', kind: 'number' },
        { key: 'i', label: 'I', kind: 'number' },
        { key: 's', label: 'S', kind: 'number' },
        { key: 'percentR', label: '%R', kind: 'percent' },
      ],
      rows: rows as unknown as Record<string, unknown>[],
      chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
    };
  },
};
```

- [ ] **Step 3: Create `packages/reporting/src/reports/amr-antibiogram.ts`** (dynamic antibiotic columns):
```ts
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportColumn, ReportDefinition, ReportResultData } from '../types';
import { fetchAmrData } from '../amr/query';
import { buildIsolates, firstIsolate } from '../amr/isolates';
import { antibiogram } from '../amr/aggregate';

const params = z.object({ from: z.string().optional(), to: z.string().optional() });
type Params = z.infer<typeof params>;

export const amrAntibiogram: ReportDefinition<Params> = {
  id: 'amr-antibiogram',
  name: 'AMR Cumulative Antibiogram',
  description: 'First-isolate %R matrix of pathogen x antibiotic (cell = %R with N tested).',
  params,
  async run(db: Kysely<ExternalSchema>, p: Params): Promise<ReportResultData> {
    const data = await fetchAmrData(db, p);
    const matrix = antibiogram(firstIsolate(buildIsolates(data.org, data.ast, data.specimens, data.patients)));
    const antibiotics = [...new Set(matrix.flatMap((m) => Object.keys(m.byAntibiotic)))].sort();
    const columns: ReportColumn[] = [{ key: 'pathogen', label: 'Pathogen', kind: 'string' }, ...antibiotics.map((a) => ({ key: a, label: a, kind: 'string' as const }))];
    const rows = matrix.map((m) => {
      const row: Record<string, unknown> = { pathogen: m.pathogen };
      for (const a of antibiotics) {
        const cell = m.byAntibiotic[a];
        row[a] = cell ? `${cell.percentR}% (${cell.tested})` : '';
      }
      return row;
    });
    return { columns, rows, chart: { type: 'stat', value: String(matrix.length), label: 'pathogens' } };
  },
};
```

- [ ] **Step 4: Create `packages/reporting/src/reports/amr-glass-ris.ts`:**
```ts
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportDefinition, ReportResultData } from '../types';
import { fetchAmrData } from '../amr/query';
import { buildIsolates, firstIsolate } from '../amr/isolates';
import { toGlassRis } from '../amr/glass';

const params = z.object({ from: z.string().optional(), to: z.string().optional(), country: z.string().default('XXX'), year: z.coerce.number().default(0) });
type Params = z.infer<typeof params>;

export const amrGlassRis: ReportDefinition<Params> = {
  id: 'amr-glass-ris',
  name: 'AMR GLASS RIS (stratified)',
  description: 'First-isolate R/I/S counts stratified by specimen, pathogen, antibiotic, gender, age group, origin (GLASS submission shape).',
  params,
  async run(db: Kysely<ExternalSchema>, p: Params): Promise<ReportResultData> {
    const data = await fetchAmrData(db, p);
    const rows = toGlassRis(firstIsolate(buildIsolates(data.org, data.ast, data.specimens, data.patients)), { country: p.country, year: p.year });
    return {
      columns: [
        { key: 'Specimen', label: 'Specimen', kind: 'string' }, { key: 'PathogenCode', label: 'Pathogen', kind: 'string' },
        { key: 'AntibioticCode', label: 'Antibiotic', kind: 'string' }, { key: 'Gender', label: 'Gender', kind: 'string' },
        { key: 'AgeGroup', label: 'Age', kind: 'string' }, { key: 'Origin', label: 'Origin', kind: 'string' },
        { key: 'Resistant', label: 'R', kind: 'number' }, { key: 'Intermediate', label: 'I', kind: 'number' },
        { key: 'Susceptible', label: 'S', kind: 'number' }, { key: 'Total', label: 'Total', kind: 'number' },
      ],
      rows: rows as unknown as Record<string, unknown>[],
      chart: { type: 'stat', value: String(rows.length), label: 'strata' },
    };
  },
};
```

- [ ] **Step 5: Register in `packages/reporting/src/catalog.ts`** — add imports + extend `REPORTS`:
```ts
import { amrAntibiogram } from './reports/amr-antibiogram';
import { amrFirstIsolateSummary } from './reports/amr-first-isolate-summary';
import { amrGlassRis } from './reports/amr-glass-ris';
```
```ts
const REPORTS: ReportDefinition[] = [amrResistance, testVolume, patientDemographics, turnaroundTime, amrAntibiogram, amrFirstIsolateSummary, amrGlassRis] as ReportDefinition[];
```

- [ ] **Step 6: Export the query** — append to `packages/reporting/src/index.ts`:
```ts
export * from './amr/query';
```

- [ ] **Step 7: Typecheck + test** — `pnpm --filter @openldr/reporting typecheck && pnpm --filter @openldr/reporting test`. Expected: PASS.

- [ ] **Step 8: Commit**
```bash
git add packages/reporting/src/amr/query.ts packages/reporting/src/reports/amr-antibiogram.ts packages/reporting/src/reports/amr-first-isolate-summary.ts packages/reporting/src/reports/amr-glass-ris.ts packages/reporting/src/catalog.ts packages/reporting/src/index.ts
git commit -m "feat(reporting): amr-antibiogram + first-isolate-summary + glass-ris reports (P2-REP-1/3)"
```

---

## Task 7: `@openldr/report-pdf` package (pdfkit, TDD)

**Files:**
- Create: `packages/report-pdf/package.json`
- Create: `packages/report-pdf/tsconfig.json`
- Create: `packages/report-pdf/src/index.ts`
- Create: `packages/report-pdf/src/index.test.ts`

- [ ] **Step 1: Create `packages/report-pdf/package.json`:**
```json
{
  "name": "@openldr/report-pdf",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run", "lint": "echo \"no lint\"" },
  "dependencies": { "pdfkit": "^0.15.0" },
  "devDependencies": { "@types/node": "^22.10.0", "@types/pdfkit": "^0.13.4", "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 2: Create `packages/report-pdf/tsconfig.json`:**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Run** `pnpm install` (resolves pdfkit + the new package). If `pdfkit`/`@types/pdfkit` versions don't resolve, pick the nearest published versions and update package.json.

- [ ] **Step 4: Write failing test** — `packages/report-pdf/src/index.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { renderReportPdf } from './index';

describe('renderReportPdf', () => {
  it('produces a PDF buffer with the %PDF header', async () => {
    const buf = await renderReportPdf({
      title: 'AMR First-Isolate Summary', generatedAt: '2026-06-14T00:00:00Z', params: { from: '2026-01-01' },
      columns: [{ key: 'pathogen', label: 'Pathogen' }, { key: 'percentR', label: '%R' }],
      rows: [{ pathogen: 'eco', percentR: 50 }, { pathogen: 'kpn', percentR: 100 }],
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(500);
  });
  it('handles zero rows', async () => {
    const buf = await renderReportPdf({ title: 'Empty', generatedAt: '2026-06-14T00:00:00Z', params: {}, columns: [{ key: 'a', label: 'A' }], rows: [] });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
```

- [ ] **Step 5: Run, verify fail** — `pnpm --filter @openldr/report-pdf test`. Expected: FAIL (module missing).

- [ ] **Step 6: Implement `packages/report-pdf/src/index.ts`:**
```ts
import PDFDocument from 'pdfkit';

export interface PdfColumn { key: string; label: string }
export interface PdfInput {
  title: string;
  generatedAt: string;
  params: Record<string, unknown>;
  columns: PdfColumn[];
  rows: Record<string, unknown>[];
}

export function renderReportPdf(input: PdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape', bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const usable = right - left;

    doc.font('Helvetica-Bold').fontSize(16).text(input.title, left, doc.y);
    doc.font('Helvetica').fontSize(8).fillColor('#555')
      .text(`Generated ${input.generatedAt}  ·  ${Object.entries(input.params).map(([k, v]) => `${k}=${String(v)}`).join('  ') || 'no params'}`);
    doc.fillColor('#000').moveDown(0.5);

    const cols = input.columns;
    const colW = usable / Math.max(cols.length, 1);
    const rowH = 16;

    const drawHeader = (): void => {
      doc.font('Helvetica-Bold').fontSize(9);
      const y = doc.y;
      cols.forEach((c, i) => doc.text(c.label, left + i * colW + 2, y + 4, { width: colW - 4, ellipsis: true }));
      doc.moveTo(left, y + rowH).lineTo(right, y + rowH).strokeColor('#999').stroke();
      doc.y = y + rowH + 2;
    };
    drawHeader();

    doc.font('Helvetica').fontSize(9);
    input.rows.forEach((row, idx) => {
      if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) { doc.addPage(); drawHeader(); doc.font('Helvetica').fontSize(9); }
      const y = doc.y;
      if (idx % 2 === 1) doc.rect(left, y, usable, rowH).fillColor('#f3f3f3').fill().fillColor('#000');
      cols.forEach((c, i) => doc.text(String(row[c.key] ?? ''), left + i * colW + 2, y + 4, { width: colW - 4, ellipsis: true }));
      doc.y = y + rowH;
    });
    if (input.rows.length === 0) doc.fillColor('#777').text('(no rows)', left, doc.y + 4).fillColor('#000');

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font('Helvetica').fontSize(7).fillColor('#999')
        .text(`OpenLDR  ·  page ${i + 1} of ${range.count}`, left, doc.page.height - doc.page.margins.bottom + 4, { width: usable, align: 'right' });
    }
    doc.end();
  });
}
```
(`renderReportPdf` returns `Promise<Buffer>`; the test `await`s it. `bufferPages: true` is required for `bufferedPageRange`/`switchToPage`.)

- [ ] **Step 7: Run, verify pass** — `pnpm --filter @openldr/report-pdf test && pnpm --filter @openldr/report-pdf typecheck`. Expected: PASS.

- [ ] **Step 8: Commit**
```bash
git add packages/report-pdf pnpm-lock.yaml
git commit -m "feat(report-pdf): pdfkit report renderer (P2-REP-4)"
```

---

## Task 8: Bootstrap — `reporting.renderPdf`

**Files:**
- Modify: `packages/bootstrap/package.json`
- Modify: `packages/bootstrap/src/index.ts`
- Modify: `tsconfig.depcruise.json` (if depcruise needs the alias)

- [ ] **Step 1: Add the dep** — in `packages/bootstrap/package.json` `dependencies`, add `"@openldr/report-pdf": "workspace:*"`. Run `pnpm install`.

- [ ] **Step 2: Extend the reporting wiring** in `packages/bootstrap/src/index.ts`:
  (a) Add the import:
```ts
import { renderReportPdf } from '@openldr/report-pdf';
```
  (b) Extend `ReportingApi`:
```ts
export interface ReportingApi {
  list(): ReportSummary[];
  run(id: string, rawParams: unknown): Promise<ReportResult>;
  runEventSource(id: string, window: { from: string; to: string }): Promise<{ rows: Record<string, unknown>[] }>;
  renderPdf(id: string, rawParams: unknown): Promise<Buffer>;
}
```
  (c) Add the method inside the `reporting` object literal (after `runEventSource`):
```ts
    async renderPdf(id, rawParams) {
      const result = await this.run(id, rawParams);
      const def = getReport(id)!;
      return renderReportPdf({
        title: def.name,
        generatedAt: result.meta.generatedAt,
        params: (rawParams ?? {}) as Record<string, unknown>,
        columns: result.columns.map((c) => ({ key: c.key, label: c.label })),
        rows: result.rows,
      });
    },
```
(`this.run` resolves/validates the report + throws `ReportNotFoundError`; `getReport(id)` is non-null after `run` succeeded. If the object-literal `this` typing is awkward, hoist `run` into a named local `runReport` and call that from both `run` and `renderPdf`.)

- [ ] **Step 3: Typecheck + depcruise** — `pnpm --filter @openldr/bootstrap typecheck && pnpm depcruise`. If depcruise can't resolve `@openldr/report-pdf`, add `"@openldr/report-pdf": ["packages/report-pdf/src/index.ts"]` to `tsconfig.depcruise.json` `paths` (mirroring the others) and report it. Expected: PASS.

- [ ] **Step 4: Commit**
```bash
git add packages/bootstrap/src/index.ts packages/bootstrap/package.json pnpm-lock.yaml tsconfig.depcruise.json
git commit -m "feat(bootstrap): reporting.renderPdf via report-pdf (P2-REP-4)"
```

---

## Task 9: CLI — `report run --format pdf` + `report glass-export`

**Files:**
- Modify: `packages/cli/src/report.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Extend `packages/cli/src/report.ts`** — add the `writeFileSync` import, a `--format pdf` path in `runReportRun`, and a `runReportGlassExport`. Add at top:
```ts
import { writeFileSync } from 'node:fs';
```
Replace `runReportRun`:
```ts
export async function runReportRun(id: string, opts: RunOpts & { format?: string; out?: string }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    if (opts.format === 'pdf') {
      const buf = await ctx.reporting.renderPdf(id, parseParams(opts.param));
      const out = opts.out ?? `${id}.pdf`;
      writeFileSync(out, buf);
      process.stdout.write(`wrote ${out} (${buf.length} bytes)\n`);
      return 0;
    }
    const result = await ctx.reporting.run(id, parseParams(opts.param));
    if (opts.csv) process.stdout.write(toCsv(result.columns, result.rows));
    else if (opts.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else {
      const header = result.columns.map((c) => c.label).join(' | ');
      const body = result.rows.map((r) => result.columns.map((c) => String(r[c.key] ?? '')).join(' | ')).join('\n');
      process.stdout.write(`${header}\n${body || '(no rows)'}\n`);
    }
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runReportGlassExport(opts: { country: string; year: string; from?: string; to?: string; out?: string; json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const params: Record<string, string> = { country: opts.country, year: opts.year };
    if (opts.from) params.from = opts.from;
    if (opts.to) params.to = opts.to;
    const result = await ctx.reporting.run('amr-glass-ris', params);
    const csv = toCsv(result.columns, result.rows);
    if (opts.out) { writeFileSync(opts.out, csv); process.stdout.write(`wrote ${opts.out}\n`); }
    else if (opts.json) process.stdout.write(JSON.stringify(result.rows, null, 2) + '\n');
    else process.stdout.write(csv);
    return 0;
  } finally {
    await ctx.close();
  }
}
```

- [ ] **Step 2: Register in `packages/cli/src/index.ts`** — read how the `report run` command is currently registered, then add `--format`/`--out` options threaded into the `runReportRun` call, add `runReportGlassExport` to the import, and add the `glass-export` subcommand:
```ts
report.command('glass-export').description('Export the GLASS-AMR RIS submission file (CSV)')
  .requiredOption('--country <iso3>', 'ISO3 country code').requiredOption('--year <yyyy>', 'reporting year')
  .option('--from <date>', 'window start').option('--to <date>', 'window end').option('--out <file>', 'output CSV file').option('--json', 'emit JSON rows', false)
  .action(async (o: { country: string; year: string; from?: string; to?: string; out?: string; json: boolean }) => { process.exitCode = await runReportGlassExport(o); });
```
For the `run` subcommand, add `.option('--format <fmt>', 'json|csv|pdf')` + `.option('--out <file>', 'output file (pdf)')` and pass `format`/`out` through to `runReportRun` in its action (match the existing action signature).

- [ ] **Step 3: Typecheck + build:check** — `pnpm --filter @openldr/cli typecheck && pnpm --filter @openldr/cli build:check`. Expected: PASS; `glass-export` + `run --format` appear in `node dist/index.js report --help`.

- [ ] **Step 4: Commit**
```bash
git add packages/cli/src/report.ts packages/cli/src/index.ts
git commit -m "feat(cli): report run --format pdf + report glass-export (P2-REP-3/4)"
```

---

## Task 10: Server — `/api/reports/:id.pdf` + `/api/reports/glass/ris.csv`

**Files:**
- Modify: `apps/server/src/reports-routes.ts`

- [ ] **Step 1: Add the routes** in `apps/server/src/reports-routes.ts`, BEFORE the `/api/reports/:id` route (so `.pdf` + `/glass/` match first):
```ts
  app.get('/api/reports/glass/ris.csv', async (req, reply) => {
    try {
      const result = await ctx.reporting.run('amr-glass-ris', req.query as Record<string, unknown>);
      reply.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename="glass-ris.csv"');
      return toCsv(result.columns, result.rows);
    } catch (err) { return mapError(err, reply); }
  });

  app.get('/api/reports/:id.pdf', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const buf = await ctx.reporting.renderPdf(id, req.query);
      reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${id}.pdf"`);
      return reply.send(buf);
    } catch (err) { return mapError(err, reply); }
  });
```
(Place both immediately after the existing `:id.csv` route and before `:id`.)

- [ ] **Step 2: Typecheck + build:check** — `pnpm --filter @openldr/server typecheck && pnpm --filter @openldr/server build:check`. Expected: PASS.

- [ ] **Step 3: Commit**
```bash
git add apps/server/src/reports-routes.ts
git commit -m "feat(server): /api/reports/:id.pdf + /api/reports/glass/ris.csv (P2-REP-3/4)"
```

---

## Task 11: Dashboard — antibiogram + first-isolate summary cards

**Files:**
- Modify: `apps/web/src/` (the dashboard card list — exact file found by reading)

- [ ] **Step 1: Read the dashboard** — read `apps/web/src/` to find the array of report cards feeding `<ReportView>` (e.g. a `DASHBOARD_REPORTS`/cards list of `{ id, title }`). Identify the exact file + array + the card object shape.

- [ ] **Step 2: Add two cards** — append to that array, matching the existing shape exactly: `{ id: 'amr-antibiogram', title: 'Cumulative Antibiogram' }` and `{ id: 'amr-first-isolate-summary', title: 'First-Isolate Resistance' }` (adjust property names to the actual shape). The existing `<ReportView>` renders `result.columns`/`result.rows` (so the antibiogram's dynamic columns display) + the `chart` hint — no new component needed.

- [ ] **Step 3: Typecheck + build the web app** — `pnpm --filter @openldr/web typecheck && pnpm --filter @openldr/web build`. Expected: PASS.

- [ ] **Step 4: Commit**
```bash
git add apps/web/src
git commit -m "feat(web): antibiogram + first-isolate dashboard cards (P2-REP-1, P2-UI)"
```

---

## Task 12: Live multi-driver acceptance + memory + finish

**Files:** none (verification + memory). Internal Postgres dev stack + Docker (SQL Server profile) up; Rust/wasi toolchain for the plugin build.

- [ ] **Step 1: Build the WHONET plugin + sample** — `pnpm build:plugins` (builds `whonet-sqlite` wasm with `location_type`→origin) + `pnpm make:whonet-sample` (writes `samples/whonet-sample.sqlite` with `location_type`). Fix Rust toolchain issues per the memory toolchain notes if needed.

- [ ] **Step 2: Migrate (Postgres) + install plugin + ingest** —
```bash
pnpm openldr db migrate                                  # applies external 002_specimen_origin
pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm reference-plugins/whonet-sqlite/manifest.json
pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite
```
Confirm origin populated: `docker exec openldr_ce-postgres-1 psql -U openldr -d openldr_target -c "select id, type_code, received_time, origin from specimens;"` → origins `inpatient`/`outpatient`, `received_time` non-null.

- [ ] **Step 3: Run the AMR reports (Postgres)** —
```bash
pnpm openldr report run amr-first-isolate-summary --json
pnpm openldr report run amr-antibiogram --json
pnpm openldr report run amr-glass-ris --param country=SLE --param year=2026 --json
```
Expected: summary shows per-(specimen,pathogen,antibiotic) R/I/S + %R; antibiogram shows the pathogen×antibiotic matrix; glass-ris shows stratified rows with origin/age/gender. **Verify first-isolate dedup:** ingest the same sample twice → counts do NOT double.

- [ ] **Step 4: CSV + PDF + GLASS export (CLI + API)** —
```bash
pnpm openldr report run amr-first-isolate-summary --format pdf --out .dhis2-seed/amr.pdf   # gitignored dir
pnpm openldr report glass-export --country SLE --year 2026 --out .dhis2-seed/glass-ris.csv
head -c 5 .dhis2-seed/amr.pdf      # %PDF-
cat .dhis2-seed/glass-ris.csv
```
Plus API (build + run the server, repo root): `curl -s localhost:3000/api/reports/amr-first-isolate-summary.pdf -o .dhis2-seed/api.pdf` (→ `%PDF-`); `curl -s "localhost:3000/api/reports/glass/ris.csv?country=SLE&year=2026"`.

- [ ] **Step 5: SQL Server multi-driver (P2-NFR-3)** — with the `mssql` profile (`MSSQL_PORT=11433`; see memory), set `TARGET_STORE_ADAPTER=mssql` + `MSSQL_*`, `db migrate` (applies `002_specimen_origin` via the dialect-aware ALTER), ingest the same WHONET sample, re-run the three AMR reports → identical results to Postgres (no raw-SQL regression).

- [ ] **Step 6: Full gates** — `pnpm typecheck && pnpm test && pnpm depcruise && pnpm build:check`. Expected: all PASS; `pnpm test` stays stack-free.

- [ ] **Step 7: Update build-plan memory** — record Phase-2 §7 step 4 (AMR/GLASS report pack) done, the acceptance result (PG + MSSQL), and carry-forwards. File: `C:\Users\Fredrick\.claude\projects\D--Projects-Repositories-openldr-ce\memory\openldr-ce-build-plan.md` (+ `MEMORY.md` index line).

- [ ] **Step 8: Finish the branch** — use superpowers:finishing-a-development-branch (merge to `main`; strip any harness-injected `Co-Authored-By` trailers per P1-CONV-2).

---

## Self-review notes (author)

- **Spec coverage:** origin pipeline (Section 1) → T1/T2/T3; AMR engine (Section 2) → T4/T5/T6; reports + GLASS export (Section 3) → T6/T9/T10; PDF (Section 4) → T7/T8/T9/T10; wiring (Section 5) → T8/T9/T10/T11; multi-driver (P2-NFR-3) → T2 (dialect ALTER) + T12. P2-REP-2 first-isolate/denominators → T4/T5 (unit-tested).
- **No placeholders:** every file has complete code. T11 reads the dashboard file first because the exact card array isn't pinned — an explicit read step, not a placeholder. The WHONET `location_type` is absent-tolerant (discovered via PRAGMA), so real WHONET DBs without it still ingest.
- **Type/name consistency:** `EXT_OPENLDR_SPECIMEN_ORIGIN`/`readSpecimenOrigin` (fhir→db flatten); `specimens.origin` (migration/schema/flatten/query); `Isolate`/`Raw*`/`buildIsolates`/`firstIsolate`/`ageBandGlass` (T4) → `aggregateRIS`/`antibiogram`/`toGlassRis` (T5) → reports (T6); `fetchAmrData`/`AmrWindow` (T6); `renderReportPdf`/`PdfInput` (T7) → bootstrap `renderPdf` (T8) → CLI (T9) → server (T10); report ids `amr-antibiogram`/`amr-first-isolate-summary`/`amr-glass-ris` consistent across T6/T9/T10/T11.
- **Date robustness:** T2 fixes `flattenSpecimen` to coalesce `collection.collectedDateTime` into `received_time`, so the isolate date is non-null for WHONET — required for first-isolate ordering.
- **Carry-forwards (for build-plan):** GLASS official code-list conformance deferred; PDF tables-first; origin emitted only by WHONET; dateless isolates sort last; dashboard cards thin.
