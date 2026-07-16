# CDR → OpenLDR CE FHIR Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach `cdr-toolchain`'s `export-batch` to map its `V2Payload` to FHIR and POST it to an OpenLDR CE workflow webhook, so real DISA\*Lab data lands in CE's FHIR store.

**Architecture:** The CLI stays the engine — decode, compare-vs-v1, audit and quarantine are untouched. We add one pure transform (`V2Payload → FHIR resource[]`), one HTTP client (webhook token instead of Bearer), and a target flag. CE takes **no code changes**: one hand-built Studio workflow (webhook → `split-out(body)` → `persist-store`) receives a bare JSON array of FHIR resources.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), `node:test` + `node:assert/strict` (**not vitest**), `commander`, `zod`, Node 20+ built-in `fetch`. Conformance testing via `fhir-validator-js` (devDependency, test-only).

**Spec:** `docs/superpowers/specs/2026-07-16-cdr-fhir-ingest-to-ce-design.md` (openldr_ce, `783cbe66`)

---

## Repos

Two working trees. **Almost all work is in cdr-toolchain.**

| Repo | Path | Role |
|---|---|---|
| `cdr-toolchain` | `D:\Projects\Repositories\cdr-toolchain` | All code changes. Branch from `main` (`345a698`). |
| `openldr_ce` | `D:\Projects\Repositories\openldr_ce` | Config only (a Studio workflow) + this plan/spec. No code. |

Commit to each repo separately. Never stage across repos. **No `Co-Authored-By` trailer** in either.

## Conventions (cdr-toolchain)

- ESM: relative imports **must** carry the `.js` extension (`./types.js`), even from `.ts`.
- Tests are `src/**/*.test.ts`, run by `node --import tsx --test` (`apps/cli/package.json`).
  Import style, verified at `apps/cli/src/audit/detector-non-test.test.ts:1-2`:
  ```ts
  import { test } from "node:test";
  import assert from "node:assert/strict";
  ```
- Run a single test file: `cd apps/cli && node --import tsx --test src/export/fhir-transform.test.ts`
- Run all CLI tests: `cd apps/cli && pnpm test`
- Typecheck: `cd apps/cli && pnpm typecheck`

## CRITICAL: CE's primitive regexes (the hidden landmines)

Read from `openldr_ce/packages/fhir/src/datatypes/primitives.ts:3-17`. Every resource the mapper
emits is `safeParse`d against these. **Three will reject real DISA data if ignored:**

```ts
// openldr_ce/packages/fhir/src/datatypes/primitives.ts:3-6 (VERBATIM, read at those lines)
const ID_RE = /^[A-Za-z0-9.\-]{1,64}$/;
const CODE_RE = /^[^\s]+(\s[^\s]+)*$/;
const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const DATETIME_RE = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?)?)?$/;
```

1. **`fhirId` forbids underscores.** `toV2` sets `request_id = prefix + LabNumber.trim()`
   (`cdr-toolchain/apps/cli/src/export/v2-transform.ts:269`) and `patient_guid = request_id`
   (`:197`). `OPENLDR_LABNO_PREFIX` is a free-text env value. If it contains `_` — and the v2
   reference example literally uses `DEFAULT_REQ-2024-00456` — **every resource id fails
   validation**. Ids must be sanitised (Task 2).
2. **`fhirDateTime` requires a timezone when a time is present.** `2024-07-20T08:30:00` is
   **invalid**; `2024-07-20T08:30:00Z` is valid. Date-only (`2024-07-20`) is valid.
   **AMENDED 2026-07-16 — the zone is a required config value, never assumed.** `disaToIso`
   emits unzoned local time on purpose (`apps/cli/src/export/v2-transform.ts:38-50`: *"No
   timezone — DISA stores local time; v2 is responsible for tz interpretation per deployment"*).
   Moz/Zambia are UTC+2, so appending `Z` would silently shift every timestamp 2h earlier.
   `fhirDateTime` therefore takes an explicit `tzOffset` (e.g. `+02:00`), and
   `OPENLDR_CE_TIMEZONE` / `--ce-tz` is **required** when a CE target is set (Tasks 8 + 10).
   **No `new Date()` fallback:** `disaToIso` passes unrecognised input through raw
   (`v2-transform.ts:46`), and JS's parser would silently reinterpret e.g. `"07/20/2024"` under
   US ordering. Unrecognised → `undefined` (omit the field). A guessed clinical timestamp is
   worse than an absent one.
3. **`fhirString` is `z.string().min(1)`** (`primitives.ts:12`) — an empty string fails. When a
   V2 value is `null` or `""`, **omit the field**; never emit `""`.

`ServiceRequest` is CE's strictest resource — it requires `resourceType`, `status`, `intent`,
`subject` (`openldr_ce/packages/fhir/src/resources/service-request.ts:8-17`). `Patient` requires
only `resourceType` (`patient.ts:8`).

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/cli/src/export/fhir-primitives.ts` (create) | Pure guards: id sanitising, dateTime coercion, empty-string omission. No FHIR resources. |
| `apps/cli/src/export/fhir-primitives.test.ts` (create) | Tests for the above. |
| `apps/cli/src/export/fhir-transform.ts` (create) | `toFhir(payload) → FhirResource[]`. The deliverable. Pure; no I/O. |
| `apps/cli/src/export/fhir-transform.test.ts` (create) | Unit + fixture round-trip tests. |
| `apps/cli/src/export/fhir-conformance.test.ts` (create) | `fhir-validator-js` conformance run over mapper output. |
| `apps/cli/src/api/ce-client.ts` (create) | `postFhirBundle` — webhook token, JSON array body. |
| `apps/cli/src/config.ts` (modify) | Add `OPENLDR_CE_*` env keys + config fields. |
| `apps/cli/src/commands/export-batch.ts` (modify) | CE target flags, `--no-check` refusal, CE send branch. |
| `apps/cli/src/audit/detector.ts` (modify) | Fix the stale `specimen_missing` message. |

Splitting primitives from the transform keeps the regex-guard logic independently testable — it
is where the subtle bugs live, and `fhir-transform.ts` would otherwise grow past what fits
comfortably in context.

---

## Task 1: Branch both repos

**Files:** none (git only)

- [ ] **Step 1: Branch cdr-toolchain**

```bash
cd /d/Projects/Repositories/cdr-toolchain
git checkout -b feat/ce-fhir-ingest
git status --short   # expect: clean
```

- [ ] **Step 2: Confirm the CLI test runner works before changing anything**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli && pnpm test 2>&1 | tail -20
```

Expected: existing tests pass. If they already fail, **stop and report** — do not build on a red baseline.

---

## Task 2: FHIR primitive guards

**Files:**
- Create: `apps/cli/src/export/fhir-primitives.ts`
- Test: `apps/cli/src/export/fhir-primitives.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/src/export/fhir-primitives.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fhirId, fhirDateTime, fhirText } from "./fhir-primitives.js";

test("fhirId strips characters FHIR forbids", () => {
  // CE's ID_RE is /^[A-Za-z0-9.\-]{1,64}$/ — underscore is NOT allowed.
  assert.equal(fhirId("DEFAULT_REQ-2024-00456"), "DEFAULT-REQ-2024-00456");
  assert.equal(fhirId("ZUL0800028"), "ZUL0800028");
  assert.equal(fhirId("a b/c"), "a-b-c");
});

test("fhirId truncates to 64 chars", () => {
  assert.equal(fhirId("x".repeat(70))?.length, 64);
});

test("fhirId returns undefined for empty/null input", () => {
  assert.equal(fhirId(null), undefined);
  assert.equal(fhirId(""), undefined);
  assert.equal(fhirId("___"), undefined); // sanitises to "---"? no: all-separator collapses to empty
});

test("fhirDateTime demands a timezone when a time is present", () => {
  assert.equal(fhirDateTime("2024-07-20T08:30:00Z"), "2024-07-20T08:30:00Z");
  // A bare local datetime is INVALID FHIR — must gain a zone.
  assert.equal(fhirDateTime("2024-07-20T08:30:00"), "2024-07-20T08:30:00Z");
  assert.equal(fhirDateTime("2024-07-20"), "2024-07-20");
  assert.equal(fhirDateTime(null), undefined);
  assert.equal(fhirDateTime("not a date"), undefined);
});

test("fhirText omits empty strings rather than emitting them", () => {
  // CE's fhirString is z.string().min(1) — "" fails validation.
  assert.equal(fhirText(""), undefined);
  assert.equal(fhirText("   "), undefined);
  assert.equal(fhirText(null), undefined);
  assert.equal(fhirText("Jane"), "Jane");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node --import tsx --test src/export/fhir-primitives.test.ts
```

Expected: FAIL — `Cannot find module './fhir-primitives.js'`.

- [ ] **Step 3: Write the implementation** — SKETCH (new code; no existing source to cite)

Create `apps/cli/src/export/fhir-primitives.ts`:

```ts
// Guards enforcing OpenLDR CE's FHIR primitive regexes. CE safeParses every
// resource against these; a value that violates one is rejected at persist.
// Mirrors openldr_ce/packages/fhir/src/datatypes/primitives.ts:3-17.

/** CE ID_RE: /^[A-Za-z0-9.\-]{1,64}$/ — note underscore is NOT permitted. */
export function fhirId(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9.\-]/g, "-")  // forbidden char -> hyphen
    .replace(/-{2,}/g, "-")            // collapse runs
    .replace(/^-+|-+$/g, "")           // no leading/trailing separator
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : undefined;
}

/** CE DATETIME_RE requires a zone when a time is present. Returns undefined
 *  for anything unparseable rather than emitting an invalid value. */
export function fhirDateTime(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = raw.trim();
  if (s.length === 0) return undefined;
  // Date-only is valid FHIR as-is.
  if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(s)) return s;
  // Already zoned.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s)) return s;
  // Unzoned local datetime -> assume UTC. DISA stores wall-clock with no zone.
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
    return `${s.replace(" ", "T").replace(/\.\d+$/, "")}Z`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** CE fhirString is z.string().min(1) — omit rather than emit "". */
export function fhirText(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const t = raw.trim();
  return t.length > 0 ? t : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node --import tsx --test src/export/fhir-primitives.test.ts
```

Expected: PASS, 5 tests. If `fhirId("___")` disagrees with the assertion, fix the **test** to
match the implementation's actual contract (all-separator input → `undefined`), not the reverse.

- [ ] **Step 5: Commit**

```bash
cd /d/Projects/Repositories/cdr-toolchain
git add apps/cli/src/export/fhir-primitives.ts apps/cli/src/export/fhir-primitives.test.ts
git commit -m "feat(export): FHIR primitive guards for id/dateTime/string

CE rejects ids containing underscores (ID_RE forbids them) and datetimes
without a timezone. toV2 builds request_id from OPENLDR_LABNO_PREFIX, which
is free text — so ids must be sanitised before they reach CE."
```

---

## Task 3: Map `patient` → `Patient`

**Files:**
- Create: `apps/cli/src/export/fhir-transform.ts`
- Test: `apps/cli/src/export/fhir-transform.test.ts`

`V2Patient` fields, read at `apps/cli/src/export/types.ts:17-29`: `patient_guid`, `firstname`,
`middlename`, `surname`, `sex`, `folder_no`, `date_of_birth`, `phone`, `email`, `national_id`,
`patient_data`.

Inverting `hl7-fhir.schema.js:913-926` (openldr-v2), which maps FHIR Patient → these fields.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/src/export/fhir-transform.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { toFhir } from "./fhir-transform.js";
import type { V2Payload } from "./types.js";

export function basePayload(over: Partial<V2Payload> = {}): V2Payload {
  return {
    patient: {
      patient_guid: "DEFAULT_REQ-2024-00456", firstname: "Jane", middlename: null,
      surname: "Doe", sex: "F", folder_no: "FLD-9981", date_of_birth: "1990-05-14",
      phone: null, email: null, national_id: null, patient_data: {},
    },
    lab_request: {
      request_id: "DEFAULT_REQ-2024-00456",
      facility_code: null, panel_code: null, specimen_code: null,
      taken_datetime: null, collected_datetime: null, received_at: null,
      registered_at: null, analysis_at: null, authorised_at: null,
      clinical_info: null, icd10_codes: null, therapy: null, priority: null,
      age_years: null, age_days: null, sex: "F", patient_class: null,
      section_code: null, result_status: "F", requesting_facility_code: null,
      testing_facility_code: null, requesting_doctor: null, tested_by: null,
      authorised_by: null, source_payload: {},
    },
    lab_results: [], isolates: [], susceptibility_tests: [],
    ...over,
  };
}

function findOne(resources: unknown[], type: string): Record<string, any> {
  const hits = resources.filter((r: any) => r.resourceType === type);
  assert.equal(hits.length, 1, `expected exactly one ${type}, got ${hits.length}`);
  return hits[0] as Record<string, any>;
}

test("patient maps to a Patient with a sanitised id", () => {
  const out = toFhir(basePayload());
  const p = findOne(out, "Patient");
  // Underscore is illegal in a FHIR id — must be sanitised.
  assert.equal(p.id, "DEFAULT-REQ-2024-00456");
  assert.equal(p.name[0].family, "Doe");
  assert.deepEqual(p.name[0].given, ["Jane"]);
  assert.equal(p.gender, "female");
  assert.equal(p.birthDate, "1990-05-14");
});

test("patient sex codes map to FHIR gender", () => {
  const g = (sex: string | null) => {
    const pl = basePayload();
    pl.patient.sex = sex;
    return (findOne(toFhir(pl), "Patient") as any).gender;
  };
  assert.equal(g("M"), "male");
  assert.equal(g("F"), "female");
  assert.equal(g("U"), "unknown");
  assert.equal(g("I"), "other");   // HL7 Indeterminate
  assert.equal(g(null), undefined);
});

test("null name parts are omitted, never emitted as empty strings", () => {
  const pl = basePayload();
  pl.patient.middlename = null;
  pl.patient.surname = null;
  const p = findOne(toFhir(pl), "Patient");
  assert.deepEqual(p.name[0].given, ["Jane"]);
  assert.equal("family" in p.name[0], false);
});

test("folder_no becomes an identifier", () => {
  const p = findOne(toFhir(basePayload()), "Patient");
  assert.equal(p.identifier.some((i: any) => i.value === "FLD-9981"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node --import tsx --test src/export/fhir-transform.test.ts
```

Expected: FAIL — `Cannot find module './fhir-transform.js'`.

- [ ] **Step 3: Write the implementation** — SKETCH (new code)

Create `apps/cli/src/export/fhir-transform.ts`:

```ts
// V2Payload -> FHIR R4 resources. Pure; no I/O.
//
// Derived by INVERTING openldr-v2's
// apps/openldr-minio/default-plugins/schema/hl7-fhir.schema.js, which maps
// FHIR -> the same canonical record toV2 emits. Anchors:
//   Patient        <- hl7-fhir.schema.js:913-926
//   lab_request    <- :927-956
//   lab_results    <- :778-811
//   micro hasMember<- :492-773
import type { V2Payload, V2Patient } from "./types.js";
import { fhirId, fhirDateTime, fhirText } from "./fhir-primitives.js";

export type FhirResource = Record<string, unknown>;

/** V2 sex (M/F/U/I) -> FHIR administrative-gender. */
function toGender(sex: string | null): string | undefined {
  switch ((sex ?? "").trim().toUpperCase()) {
    case "M": return "male";
    case "F": return "female";
    case "U": return "unknown";
    case "I": return "other"; // HL7 Indeterminate has no FHIR equivalent
    default: return undefined;
  }
}

/** Drop undefined values so we never emit `"field": undefined` or "". */
function compact<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

function patientResource(p: V2Patient, id: string | undefined): FhirResource {
  const given = [fhirText(p.firstname), fhirText(p.middlename)].filter(
    (v): v is string => v !== undefined,
  );
  const name = compact({ family: fhirText(p.surname), ...(given.length > 0 ? { given } : {}) });

  const identifier: Record<string, unknown>[] = [];
  const folder = fhirText(p.folder_no);
  if (folder !== undefined) identifier.push({ system: "urn:openldr:folder-no", value: folder });
  const nid = fhirText(p.national_id);
  if (nid !== undefined) {
    identifier.push({
      system: "urn:openldr:national-id",
      value: nid,
      type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "NI" }] },
    });
  }

  const telecom: Record<string, unknown>[] = [];
  const phone = fhirText(p.phone);
  if (phone !== undefined) telecom.push({ system: "phone", value: phone });
  const email = fhirText(p.email);
  if (email !== undefined) telecom.push({ system: "email", value: email });

  return compact({
    resourceType: "Patient",
    id,
    ...(identifier.length > 0 ? { identifier } : {}),
    ...(Object.keys(name).length > 0 ? { name: [name] } : {}),
    gender: toGender(p.sex),
    birthDate: fhirDateTime(p.date_of_birth),
    ...(telecom.length > 0 ? { telecom } : {}),
  });
}

export function toFhir(payload: V2Payload): FhirResource[] {
  // toV2 sets patient_guid = request_id (v2-transform.ts:197) because DISA has
  // no patient identity. So Patient.id and the request share a root id.
  const patientId = fhirId(payload.patient.patient_guid ?? payload.lab_request.request_id);
  return [patientResource(payload.patient, patientId)];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node --import tsx --test src/export/fhir-transform.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
cd /d/Projects/Repositories/cdr-toolchain
git add apps/cli/src/export/fhir-transform.ts apps/cli/src/export/fhir-transform.test.ts
git commit -m "feat(export): map V2 patient to FHIR Patient"
```

---

## Task 4: Map `lab_request` → `ServiceRequest` + `Specimen` + `DiagnosticReport`

**Files:**
- Modify: `apps/cli/src/export/fhir-transform.ts`
- Test: `apps/cli/src/export/fhir-transform.test.ts`

`V2LabRequest` read at `apps/cli/src/export/types.ts:30-57`. `V2ConceptCode` at `:5-15`
(`system_id?`, `concept_code`, `display_name`, `concept_class`, `datatype`, `properties?`).

**CE requires `ServiceRequest.status`, `.intent`, `.subject`** — `service-request.ts:8-17`.

- [ ] **Step 1: Write the failing test** — append to `fhir-transform.test.ts`

```ts
test("lab_request produces ServiceRequest, Specimen and DiagnosticReport", () => {
  const pl = basePayload();
  pl.lab_request.panel_code = {
    concept_code: "CULT", display_name: "Blood Culture",
    concept_class: "panel", datatype: "coded", system_id: "DEFAULT_TEST",
  };
  pl.lab_request.specimen_code = {
    concept_code: "BLD", display_name: "Blood",
    concept_class: "specimen", datatype: "coded", system_id: "DEFAULT_SPEC",
  };
  pl.lab_request.collected_datetime = "2024-07-20T08:30:00";
  pl.lab_request.received_at = "2024-07-20T09:00:00";

  const out = toFhir(pl);
  const sr = findOne(out, "ServiceRequest");
  const sp = findOne(out, "Specimen");
  const dr = findOne(out, "DiagnosticReport");

  // CE requires status + intent + subject on ServiceRequest.
  assert.equal(sr.status, "completed");
  assert.equal(sr.intent, "order");
  assert.equal(sr.subject.reference, "Patient/DEFAULT-REQ-2024-00456");
  assert.equal(sr.code.coding[0].code, "CULT");

  // Unzoned DISA datetimes must gain a zone or CE rejects them.
  assert.equal(sp.collection.collectedDateTime, "2024-07-20T08:30:00Z");
  assert.equal(sp.receivedTime, "2024-07-20T09:00:00Z");
  assert.equal(sp.type.coding[0].code, "BLD");

  assert.equal(dr.status, "final");
  assert.equal(dr.code.coding[0].code, "CULT");
  assert.equal(dr.subject.reference, "Patient/DEFAULT-REQ-2024-00456");
  assert.equal(dr.specimen[0].reference, `Specimen/${sp.id}`);
});

test("result_status maps to DiagnosticReport.status", () => {
  const s = (rs: string | null) => {
    const pl = basePayload();
    pl.lab_request.result_status = rs;
    return (findOne(toFhir(pl), "DiagnosticReport") as any).status;
  };
  assert.equal(s("F"), "final");
  assert.equal(s("P"), "preliminary");
  assert.equal(s("C"), "corrected");
  assert.equal(s("X"), "cancelled");
  assert.equal(s(null), "unknown");  // never omit — CE requires status
});

test("a null panel_code still yields a DiagnosticReport with a code", () => {
  // CE requires DiagnosticReport.code; we must not emit a report without one.
  const pl = basePayload();
  pl.lab_request.panel_code = null;
  const dr = findOne(toFhir(pl), "DiagnosticReport");
  assert.ok(dr.code, "DiagnosticReport.code is required by CE");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node --import tsx --test src/export/fhir-transform.test.ts
```

Expected: FAIL — "expected exactly one ServiceRequest, got 0".

- [ ] **Step 3: Write the implementation** — SKETCH. Add to `fhir-transform.ts`:

```ts
import type { V2ConceptCode, V2LabRequest } from "./types.js";

/** V2 system_id -> a code system URI. DISA-native systems have no public URI,
 *  so they become urn:openldr:* — mirrors how hl7-fhir.schema.js keeps
 *  source_system_url alongside the concept (:37-47). */
function systemUri(systemId: string | undefined): string | undefined {
  if (systemId === undefined || systemId.trim().length === 0) return undefined;
  return `urn:openldr:${systemId.trim().toLowerCase()}`;
}

function toCodeableConcept(c: V2ConceptCode | null): Record<string, unknown> | undefined {
  if (c === null) return undefined;
  const code = fhirText(c.concept_code);
  if (code === undefined) return undefined;
  return compact({
    coding: [compact({ system: systemUri(c.system_id), code, display: fhirText(c.display_name) })],
    text: fhirText(c.display_name),
  });
}

/** hl7-fhir.schema.js:300-314 maps FHIR status -> F/P/C/X/R/I. Inverted here.
 *  Never returns undefined: CE requires DiagnosticReport.status. */
function toReportStatus(rs: string | null): string {
  switch ((rs ?? "").trim().toUpperCase()) {
    case "F": return "final";
    case "P": return "preliminary";
    case "C": return "corrected";
    case "X": return "cancelled";
    case "R": return "registered";
    case "I": return "registered";
    default: return "unknown";
  }
}

const UNKNOWN_CODE = {
  coding: [{ system: "http://terminology.hl7.org/CodeSystem/data-absent-reason", code: "unknown" }],
  text: "unknown",
};

function requestResources(
  lr: V2LabRequest, patientRef: string, rootId: string,
): FhirResource[] {
  const out: FhirResource[] = [];
  const panel = toCodeableConcept(lr.panel_code) ?? UNKNOWN_CODE;

  out.push(compact({
    resourceType: "ServiceRequest",
    id: rootId,
    status: "completed",     // CE-required
    intent: "order",         // CE-required
    subject: { reference: patientRef },
    code: panel,
    ...(fhirText(lr.clinical_info) !== undefined
      ? { note: [{ text: fhirText(lr.clinical_info) }] } : {}),
    ...(fhirText(lr.requesting_doctor) !== undefined
      ? { requester: { display: fhirText(lr.requesting_doctor) } } : {}),
  }));

  const specimenId = fhirId(`${rootId}-spec`);
  const collection = compact({ collectedDateTime: fhirDateTime(lr.collected_datetime) });
  out.push(compact({
    resourceType: "Specimen",
    id: specimenId,
    subject: { reference: patientRef },
    type: toCodeableConcept(lr.specimen_code),
    receivedTime: fhirDateTime(lr.received_at),
    ...(Object.keys(collection).length > 0 ? { collection } : {}),
  }));

  out.push(compact({
    resourceType: "DiagnosticReport",
    id: rootId,
    status: toReportStatus(lr.result_status),  // CE-required
    code: panel,                               // CE-required
    subject: { reference: patientRef },
    ...(specimenId !== undefined ? { specimen: [{ reference: `Specimen/${specimenId}` }] } : {}),
    effectiveDateTime: fhirDateTime(lr.taken_datetime ?? lr.collected_datetime),
    issued: fhirDateTime(lr.authorised_at),
    basedOn: [{ reference: `ServiceRequest/${rootId}` }],
    ...(fhirText(lr.testing_facility_code?.display_name ?? null) !== undefined
      ? { performer: [{ display: fhirText(lr.testing_facility_code!.display_name) }] } : {}),
  }));

  return out;
}
```

Replace the body of `toFhir` with:

```ts
export function toFhir(payload: V2Payload): FhirResource[] {
  const rootId = fhirId(payload.lab_request.request_id);
  if (rootId === undefined) {
    throw new Error(`request_id "${payload.lab_request.request_id}" sanitises to an empty FHIR id`);
  }
  const patientId = fhirId(payload.patient.patient_guid) ?? rootId;
  const patientRef = `Patient/${patientId}`;

  return [
    patientResource(payload.patient, patientId),
    ...requestResources(payload.lab_request, patientRef, rootId),
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node --import tsx --test src/export/fhir-transform.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
cd /d/Projects/Repositories/cdr-toolchain
git add apps/cli/src/export/fhir-transform.ts apps/cli/src/export/fhir-transform.test.ts
git commit -m "feat(export): map lab_request to ServiceRequest/Specimen/DiagnosticReport"
```

---

## Task 5: Map `lab_results` → `Observation[]`

**Files:**
- Modify: `apps/cli/src/export/fhir-transform.ts`
- Test: `apps/cli/src/export/fhir-transform.test.ts`

`V2LabResult` read at `apps/cli/src/export/types.ts:58-83`.

**Spec decision (confirmed 2026-07-16):** `abnormal_flag` → `Observation.interpretation`,
`rpt_range` → `Observation.referenceRange`. The v2 reference nulls both on its FHIR path
(`hl7-fhir.schema.js:802-805`) while populating them on its v2 path (`:192-194`) — going
FHIR-ward we map them rather than inherit the drop.

- [ ] **Step 1: Write the failing test** — append to `fhir-transform.test.ts`

```ts
import type { V2LabResult } from "./types.js";

function labResult(over: Partial<V2LabResult> = {}): V2LabResult {
  return {
    source_test_code: "CULT", obx_set_id: 1, obx_sub_id: 0,
    observation_code: {
      concept_code: "WBC", display_name: "White Blood Cell Count",
      concept_class: "test", datatype: "numeric", system_id: "DEFAULT_TEST",
    },
    result_value: "15.2", result_type: "NM", numeric_value: 15.2,
    coded_value: null, text_value: null, numeric_units: "x10^9/L",
    abnormal_flag: null, rpt_units: null, rpt_flag: null, rpt_range: null,
    result_timestamp: null, isolate_index: null, is_resulted: true,
    raw_result: {}, ...over,
  };
}

test("numeric lab_result becomes an Observation with valueQuantity", () => {
  const pl = basePayload({ lab_results: [labResult()] });
  const o = findOne(toFhir(pl), "Observation");
  assert.equal(o.status, "final");           // CE-required
  assert.equal(o.code.coding[0].code, "WBC");
  assert.equal(o.valueQuantity.value, 15.2);
  assert.equal(o.valueQuantity.unit, "x10^9/L");
  assert.equal(o.subject.reference, "Patient/DEFAULT-REQ-2024-00456");
});

test("abnormal_flag maps to interpretation and rpt_range to referenceRange", () => {
  const pl = basePayload({ lab_results: [labResult({ abnormal_flag: "H", rpt_range: "4.0-11.0" })] });
  const o = findOne(toFhir(pl), "Observation");
  assert.equal(o.interpretation[0].coding[0].code, "H");
  assert.equal(o.referenceRange[0].low.value, 4.0);
  assert.equal(o.referenceRange[0].high.value, 11.0);
});

test("a non-numeric range falls back to referenceRange.text", () => {
  const pl = basePayload({ lab_results: [labResult({ rpt_range: "negative" })] });
  const o = findOne(toFhir(pl), "Observation");
  assert.equal(o.referenceRange[0].text, "negative");
});

test("coded and string results pick the right value[x]", () => {
  const coded = basePayload({
    lab_results: [labResult({ result_type: "CE", numeric_value: null, coded_value: "ECO", result_value: "Escherichia coli" })],
  });
  assert.equal((findOne(toFhir(coded), "Observation") as any).valueCodeableConcept.coding[0].code, "ECO");

  const str = basePayload({
    lab_results: [labResult({ result_type: "ST", numeric_value: null, result_value: "turbid" })],
  });
  assert.equal((findOne(toFhir(str), "Observation") as any).valueString, "turbid");
});

test("DiagnosticReport.result references every Observation", () => {
  const pl = basePayload({ lab_results: [labResult(), labResult({ obx_set_id: 2 })] });
  const out = toFhir(pl);
  const dr = findOne(out, "DiagnosticReport");
  const obs = out.filter((r: any) => r.resourceType === "Observation");
  assert.equal(obs.length, 2);
  assert.equal(dr.result.length, 2);
  // Every reference must resolve to an emitted Observation id.
  const ids = new Set(obs.map((o: any) => `Observation/${o.id}`));
  for (const ref of dr.result) assert.equal(ids.has(ref.reference), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node --import tsx --test src/export/fhir-transform.test.ts
```

Expected: FAIL — "expected exactly one Observation, got 0".

- [ ] **Step 3: Write the implementation** — SKETCH. Add to `fhir-transform.ts`:

```ts
import type { V2LabResult } from "./types.js";

/** "4.0-11.0" -> {low,high}; anything else -> {text}. Never returns undefined
 *  for a non-empty input, so information is preserved either way. */
function toReferenceRange(range: string | null, unit: string | undefined): Record<string, unknown> | undefined {
  const t = fhirText(range);
  if (t === undefined) return undefined;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*$/.exec(t);
  if (m !== null) {
    return compact({
      low: compact({ value: Number(m[1]), unit }),
      high: compact({ value: Number(m[2]), unit }),
    });
  }
  return { text: t };
}

function observationResource(
  r: V2LabResult, patientRef: string, rootId: string, index: number,
): FhirResource {
  const unit = fhirText(r.numeric_units) ?? fhirText(r.rpt_units);
  const obsId = fhirId(`${rootId}-obs-${index}`);

  // value[x] — exactly one. Order mirrors hl7-fhir.schema.js:324-334 inverted.
  let value: Record<string, unknown> = {};
  if (r.numeric_value !== null) {
    value = { valueQuantity: compact({ value: r.numeric_value, unit }) };
  } else if (fhirText(r.coded_value) !== undefined) {
    value = {
      valueCodeableConcept: compact({
        coding: [compact({ code: fhirText(r.coded_value), display: fhirText(r.result_value) })],
        text: fhirText(r.result_value),
      }),
    };
  } else {
    const s = fhirText(r.result_value) ?? fhirText(r.text_value);
    if (s !== undefined) value = { valueString: s };
  }

  const flag = fhirText(r.abnormal_flag);
  const refRange = toReferenceRange(r.rpt_range, unit);

  return compact({
    resourceType: "Observation",
    id: obsId,
    status: "final",  // CE-required
    code: toCodeableConcept(r.observation_code) ?? UNKNOWN_CODE,
    subject: { reference: patientRef },
    effectiveDateTime: fhirDateTime(r.result_timestamp),
    ...value,
    ...(flag !== undefined
      ? { interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: flag }] }] }
      : {}),
    ...(refRange !== undefined ? { referenceRange: [refRange] } : {}),
  });
}
```

Extend `toFhir` — replace its body with:

```ts
export function toFhir(payload: V2Payload): FhirResource[] {
  const rootId = fhirId(payload.lab_request.request_id);
  if (rootId === undefined) {
    throw new Error(`request_id "${payload.lab_request.request_id}" sanitises to an empty FHIR id`);
  }
  const patientId = fhirId(payload.patient.patient_guid) ?? rootId;
  const patientRef = `Patient/${patientId}`;

  const observations = payload.lab_results.map((r, i) =>
    observationResource(r, patientRef, rootId, i + 1),
  );

  const out = [
    patientResource(payload.patient, patientId),
    ...requestResources(payload.lab_request, patientRef, rootId),
    ...observations,
  ];

  // Link the report to its observations.
  const dr = out.find((r) => r.resourceType === "DiagnosticReport");
  if (dr !== undefined && observations.length > 0) {
    dr.result = observations.map((o) => ({ reference: `Observation/${o.id as string}` }));
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node --import tsx --test src/export/fhir-transform.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
cd /d/Projects/Repositories/cdr-toolchain
git add apps/cli/src/export/fhir-transform.ts apps/cli/src/export/fhir-transform.test.ts
git commit -m "feat(export): map lab_results to FHIR Observations

abnormal_flag -> Observation.interpretation and rpt_range -> referenceRange:
the v2 schema's FHIR path nulls both while its v2 path populates them, so
going FHIR-ward we map rather than inherit the drop."
```

---

## Task 6: Map `isolates` + `susceptibility_tests` → the `hasMember` tree

**Files:**
- Modify: `apps/cli/src/export/fhir-transform.ts`
- Test: `apps/cli/src/export/fhir-transform.test.ts`

`V2Isolate` at `types.ts:85-104`; `V2SusceptibilityTest` at `types.ts:106-119`.

The v2 convention, documented at `hl7-fhir.schema.js:496-518`:
`DiagnosticReport.result[] → Observation(culture) → hasMember[] → Observation(isolate) → hasMember[] → Observation(AST)`.
Isolate indices are 1-based (`:713`). **The shipped `.example.json` has no `hasMember` tree**, so
this branch is unexercised by the reference fixture — these hand-built tests are the only cover.

- [ ] **Step 1: Write the failing test** — append to `fhir-transform.test.ts`

```ts
import type { V2Isolate, V2SusceptibilityTest } from "./types.js";

function isolate(over: Partial<V2Isolate> = {}): V2Isolate {
  return {
    isolate_index: 1, source_test_code: "CULT",
    organism_code: {
      concept_code: "ECO", display_name: "Escherichia coli",
      concept_class: "organism", datatype: "coded",
    },
    organism_type: "bacteria", isolate_number: "1", serotype: null,
    patient_age_days: null, patient_sex: "F", ward: null, ward_type: null,
    origin: null, beta_lactamase: null, esbl: null, carbapenemase: null,
    mrsa_screen: null, inducible_clinda: null, custom_fields: null,
    raw_result: {}, ...over,
  };
}

function ast(over: Partial<V2SusceptibilityTest> = {}): V2SusceptibilityTest {
  return {
    isolate_index: 1, source_test_code: "SENS",
    antibiotic_code: {
      concept_code: "AMP", display_name: "Ampicillin",
      concept_class: "antibiotic", datatype: "coded",
    },
    test_method: "DISK", disk_potency: null, result_raw: "R",
    result_numeric: null, susceptibility_value: "R", quantitative_value: null,
    guideline: "CLSI", guideline_version: null, raw_result: {}, ...over,
  };
}

test("an isolate becomes an Observation linked from the report", () => {
  const pl = basePayload({ isolates: [isolate()] });
  const out = toFhir(pl);
  const iso = out.find((r: any) => r.resourceType === "Observation" && r.valueCodeableConcept?.coding?.[0]?.code === "ECO") as any;
  assert.ok(iso, "expected an isolate Observation carrying the organism code");
  assert.equal(iso.status, "final");
  const dr = findOne(out, "DiagnosticReport");
  assert.equal(dr.result.some((r: any) => r.reference === `Observation/${iso.id}`), true);
});

test("AST hangs off its isolate via hasMember", () => {
  const pl = basePayload({ isolates: [isolate()], susceptibility_tests: [ast()] });
  const out = toFhir(pl);
  const iso = out.find((r: any) => r.valueCodeableConcept?.coding?.[0]?.code === "ECO") as any;
  const abx = out.find((r: any) => r.code?.coding?.[0]?.code === "AMP") as any;
  assert.ok(abx, "expected an AST Observation for the antibiotic");
  assert.equal(iso.hasMember.some((m: any) => m.reference === `Observation/${abx.id}`), true);
  // S/I/R lands as the interpretation, per hl7-fhir.schema.js:528-553 inverted.
  assert.equal(abx.interpretation[0].coding[0].code, "R");
});

test("AST with no matching isolate_index is still emitted, not silently dropped", () => {
  const pl = basePayload({ isolates: [isolate()], susceptibility_tests: [ast({ isolate_index: 99 })] });
  const out = toFhir(pl);
  const abx = out.find((r: any) => r.code?.coding?.[0]?.code === "AMP");
  assert.ok(abx, "an orphan AST must not vanish from the payload");
});

test("MIC test_method carries the quantitative value", () => {
  const pl = basePayload({
    isolates: [isolate()],
    susceptibility_tests: [ast({ test_method: "MIC", result_numeric: 0.5, quantitative_value: "<=0.5" })],
  });
  const abx = toFhir(pl).find((r: any) => r.code?.coding?.[0]?.code === "AMP") as any;
  assert.equal(abx.component[0].valueQuantity.value, 0.5);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node --import tsx --test src/export/fhir-transform.test.ts
```

Expected: FAIL — "expected an isolate Observation carrying the organism code".

- [ ] **Step 3: Write the implementation** — SKETCH. Add to `fhir-transform.ts`:

```ts
import type { V2Isolate, V2SusceptibilityTest } from "./types.js";

const SIR_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation";

function astResource(
  s: V2SusceptibilityTest, patientRef: string, rootId: string, index: number,
): FhirResource {
  const sir = s.susceptibility_value;
  const component =
    s.result_numeric !== null
      ? [{
          code: { text: s.test_method === "MIC" ? "MIC" : "Zone diameter" },
          valueQuantity: compact({ value: s.result_numeric }),
        }]
      : undefined;

  return compact({
    resourceType: "Observation",
    id: fhirId(`${rootId}-ast-${index}`),
    status: "final",
    code: toCodeableConcept(s.antibiotic_code) ?? UNKNOWN_CODE,
    subject: { reference: patientRef },
    ...(sir !== null ? { interpretation: [{ coding: [{ system: SIR_SYSTEM, code: sir }] }] } : {}),
    ...(fhirText(s.result_raw) !== undefined ? { valueString: fhirText(s.result_raw) } : {}),
    ...(s.test_method !== null ? { method: { text: s.test_method } } : {}),
    ...(component !== undefined ? { component } : {}),
    ...(fhirText(s.guideline) !== undefined ? { note: [{ text: fhirText(s.guideline) }] } : {}),
  });
}

function isolateResource(
  iso: V2Isolate, patientRef: string, rootId: string,
): FhirResource {
  return compact({
    resourceType: "Observation",
    id: fhirId(`${rootId}-iso-${iso.isolate_index}`),
    status: "final",
    code: { text: fhirText(iso.source_test_code) ?? "Isolate" },
    subject: { reference: patientRef },
    valueCodeableConcept: toCodeableConcept(iso.organism_code) ?? UNKNOWN_CODE,
  });
}
```

Extend `toFhir` — replace its body with the final version:

```ts
export function toFhir(payload: V2Payload): FhirResource[] {
  const rootId = fhirId(payload.lab_request.request_id);
  if (rootId === undefined) {
    throw new Error(`request_id "${payload.lab_request.request_id}" sanitises to an empty FHIR id`);
  }
  const patientId = fhirId(payload.patient.patient_guid) ?? rootId;
  const patientRef = `Patient/${patientId}`;

  const observations = payload.lab_results.map((r, i) =>
    observationResource(r, patientRef, rootId, i + 1),
  );

  const isolates = payload.isolates.map((iso) => isolateResource(iso, patientRef, rootId));
  const asts = payload.susceptibility_tests.map((s, i) =>
    astResource(s, patientRef, rootId, i + 1),
  );

  // Hang each AST off its isolate via hasMember. An AST whose isolate_index
  // matches nothing is still emitted (unlinked) — never silently dropped.
  payload.susceptibility_tests.forEach((s, i) => {
    const host = isolates.find((r) => r.id === fhirId(`${rootId}-iso-${s.isolate_index}`));
    if (host === undefined) return;
    const members = (host.hasMember as { reference: string }[] | undefined) ?? [];
    members.push({ reference: `Observation/${asts[i]!.id as string}` });
    host.hasMember = members;
  });

  const out = [
    patientResource(payload.patient, patientId),
    ...requestResources(payload.lab_request, patientRef, rootId),
    ...observations,
    ...isolates,
    ...asts,
  ];

  // The report indexes the lab results and the isolates (not the ASTs — those
  // are reachable through their isolate's hasMember).
  const dr = out.find((r) => r.resourceType === "DiagnosticReport");
  const indexed = [...observations, ...isolates];
  if (dr !== undefined && indexed.length > 0) {
    dr.result = indexed.map((o) => ({ reference: `Observation/${o.id as string}` }));
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node --import tsx --test src/export/fhir-transform.test.ts
```

Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
cd /d/Projects/Repositories/cdr-toolchain
git add apps/cli/src/export/fhir-transform.ts apps/cli/src/export/fhir-transform.test.ts
git commit -m "feat(export): map isolates and susceptibility tests to the hasMember tree

The v2 reference example ships no hasMember tree, so this branch has no
fixture cover upstream — these hand-built tests are the only coverage."
```

---

## Task 7: Conformance test against the real HL7 validator

**Files:**
- Create: `apps/cli/src/export/fhir-conformance.test.ts`
- Modify: `apps/cli/package.json`

`fhir-validator-js` v1.4.1 (published 2026-06-28) self-provisions an Adoptium JRE and downloads
the validator JAR. **devDependency only — it never ships.** First run downloads ~100–200MB.

- [ ] **Step 1: Add the devDependency**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
pnpm add -D fhir-validator-js
```

- [ ] **Step 2: Write the conformance test**

Create `apps/cli/src/export/fhir-conformance.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { toFhir } from "./fhir-transform.js";
import { basePayload } from "./fhir-transform.test.js";

// The validator provisions a JRE + JAR on first run (~100-200MB) and starts a
// local server. Skipped unless FHIR_CONFORMANCE=1 so the default `pnpm test`
// stays fast and offline-safe.
const ENABLED = process.env.FHIR_CONFORMANCE === "1";

let validator: any;

before(async () => {
  if (!ENABLED) return;
  const mod: any = await import("fhir-validator-js");
  validator = await mod.createValidator({ version: "4.0.1" });
}, { timeout: 600_000 });

after(async () => { if (validator?.shutdown) await validator.shutdown(); });

test("every emitted resource is conformant R4", { skip: !ENABLED }, async () => {
  const resources = toFhir(basePayload());
  for (const r of resources) {
    const res = await validator.validate(r);
    const errors = (res.issues ?? []).filter((i: any) => i.severity === "error" || i.severity === "fatal");
    assert.deepEqual(
      errors, [],
      `${(r as any).resourceType}/${(r as any).id} failed R4 conformance:\n${JSON.stringify(errors, null, 2)}`,
    );
  }
});
```

- [ ] **Step 3: Run the conformance test**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
FHIR_CONFORMANCE=1 node --import tsx --test src/export/fhir-conformance.test.ts
```

Expected: PASS. **If `createValidator` has a different signature, read the package's README and
adapt — do not guess.** Record every error it reports: that list is the input to the CE
strictness slice ("high" ≈ what this enforces).

- [ ] **Step 4: Verify the default test run stays green and fast**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli && pnpm test 2>&1 | tail -10
```

Expected: PASS, conformance test skipped.

- [ ] **Step 5: Commit**

```bash
cd /d/Projects/Repositories/cdr-toolchain
git add apps/cli/package.json apps/cli/src/export/fhir-conformance.test.ts ../pnpm-lock.yaml
git commit -m "test(export): R4 conformance gate via fhir-validator-js

Test-only devDep; never ships. Gated behind FHIR_CONFORMANCE=1 so the
default test run stays fast and offline-safe. CE's own zod schemas are too
lenient to catch mapping bugs (a bare {resourceType:'Specimen'} validates),
so conformance is checked here rather than relied on downstream."
```

---

## Task 8: CE config keys

**Files:**
- Modify: `apps/cli/src/config.ts`

Existing shape, read at `config.ts:82-104` (`EnvSchema`), `:10-27` (`LoadedConfig`), `:56-67`
(`ConfigOverrides`), `:190-196` (assembly).

- [ ] **Step 1: Add env keys to `EnvSchema`**

After `OPENLDR_V2_INSECURE_TLS` (`config.ts:104`), add:

```ts
  OPENLDR_CE_URL: z.string().url().optional(),
  OPENLDR_CE_HOOK_PATH: z.string().optional(),
  OPENLDR_CE_WEBHOOK_TOKEN: z.string().min(1).optional(),
```

- [ ] **Step 2: Add fields to `LoadedConfig`** (near `openldrV2Path`, `config.ts:27`)

```ts
  /** OpenLDR CE base URL — the workflow-webhook target. */
  openldrCeUrl?: string;
  /** Path of the CE workflow webhook, e.g. /api/workflows/hooks/cdr-ingest. */
  openldrCeHookPath: string;
  /** Secret for the CE webhook's `x-webhook-token` header. */
  openldrCeWebhookToken?: string;
```

- [ ] **Step 3: Add to `ConfigOverrides`** (near `openldrV2Path`, `config.ts:67`)

```ts
  openldrCeUrl?: string;
  openldrCeHookPath?: string;
  openldrCeWebhookToken?: string;
```

- [ ] **Step 4: Wire the assembly** (after `openldrV2Path`, `config.ts:196`)

```ts
    openldrCeUrl: overrides.openldrCeUrl ?? env.data.OPENLDR_CE_URL,
    openldrCeHookPath: overrides.openldrCeHookPath ?? env.data.OPENLDR_CE_HOOK_PATH ?? "/api/workflows/hooks/cdr-ingest",
    openldrCeWebhookToken: overrides.openldrCeWebhookToken ?? env.data.OPENLDR_CE_WEBHOOK_TOKEN,
```

- [ ] **Step 5: Typecheck and commit**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli && pnpm typecheck
```

Expected: no errors.

```bash
cd /d/Projects/Repositories/cdr-toolchain
git add apps/cli/src/config.ts
git commit -m "feat(config): OPENLDR_CE_URL / _HOOK_PATH / _WEBHOOK_TOKEN"
```

---

## Task 9: CE HTTP client

**Files:**
- Create: `apps/cli/src/api/ce-client.ts`
- Test: `apps/cli/src/api/ce-client.test.ts`

CE's webhook auth, read at `openldr_ce/apps/server/src/workflows-routes.ts:412-413`: token from
the `x-webhook-token` header **only**, constant-time compared. And `:417-424`: a non-JSON
content-type with a Buffer body is diverted to blob storage and the body is **lost** — so
`Content-Type: application/json` is mandatory.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/src/api/ce-client.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { postFhirResources } from "./ce-client.js";

test("posts a bare JSON array with the webhook token header", async () => {
  let seenUrl = "";
  let seenInit: any = null;
  const fakeFetch = async (url: any, init: any) => {
    seenUrl = String(url); seenInit = init;
    return new Response(JSON.stringify({ ok: true, runId: "r1" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };

  const res = await postFhirResources([{ resourceType: "Patient", id: "p1" }], {
    baseUrl: "https://ce.example.com/",
    path: "/api/workflows/hooks/cdr-ingest",
    token: "secret-token",
    fetchImpl: fakeFetch as unknown as typeof fetch,
  });

  assert.equal(seenUrl, "https://ce.example.com/api/workflows/hooks/cdr-ingest");
  assert.equal(seenInit.headers["x-webhook-token"], "secret-token");
  // Content-Type MUST be json or CE diverts the body to blob storage and drops it.
  assert.equal(seenInit.headers["Content-Type"], "application/json");
  // No Bearer — CE's webhook is secret-gated, not Keycloak-gated.
  assert.equal("Authorization" in seenInit.headers, false);
  // The body is the ARRAY itself; split-out does a flat lookup on `body`.
  assert.deepEqual(JSON.parse(seenInit.body), [{ resourceType: "Patient", id: "p1" }]);
  assert.equal(res.status, 200);
  assert.equal((res.body as any).runId, "r1");
});

test("a 401 raises API_REJECTED and does not retry", async () => {
  let calls = 0;
  const fakeFetch = async () => { calls += 1; return new Response("nope", { status: 401 }); };
  await assert.rejects(
    () => postFhirResources([], {
      baseUrl: "https://ce.example.com", path: "/h", token: "bad",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    }),
    /API_REJECTED|invalid webhook token|401/,
  );
  assert.equal(calls, 1, "4xx must not be retried");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node --import tsx --test src/api/ce-client.test.ts
```

Expected: FAIL — `Cannot find module './ce-client.js'`.

- [ ] **Step 3: Write the implementation** — SKETCH

Create `apps/cli/src/api/ce-client.ts`:

```ts
import { CliError } from "../errors.js";

// POST FHIR resources to an OpenLDR CE workflow webhook.
//
// CE contract (openldr_ce/apps/server/src/workflows-routes.ts:403-428):
//  - auth is the `x-webhook-token` header ONLY (no Bearer, no query token)
//  - Content-Type MUST be application/json: a non-JSON content-type with a
//    Buffer body is diverted to blob storage and webhookBody becomes undefined
//    (:417-424), so the payload would vanish silently
//  - the body must be a BARE ARRAY: the workflow's split-out node does a flat
//    key lookup on `body` (split-out.ts:9), so a wrapper object would pass
//    through unexploded and fail validation downstream

export interface CePostOptions {
  baseUrl: string;
  path: string;
  token: string;
  maxRetries?: number;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export interface CePostResult {
  status: number;
  body: unknown;
  attempts: number;
}

const DEFAULT_RETRIES = 5;
const DEFAULT_TIMEOUT_MS = 30_000;

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function postFhirResources(
  resources: unknown[], opts: CePostOptions,
): Promise<CePostResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = joinUrl(opts.baseUrl, opts.path);
  const maxRetries = opts.maxRetries ?? DEFAULT_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let attempt = 0;
  let lastTransient: unknown = null;

  while (attempt < maxRetries) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "x-webhook-token": opts.token,
        },
        body: JSON.stringify(resources),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status >= 200 && res.status < 300) {
        const text = await res.text();
        let body: unknown = null;
        if (text.length > 0) { try { body = JSON.parse(text); } catch { body = text; } }
        return { status: res.status, body, attempts: attempt };
      }

      if (res.status >= 400 && res.status < 500) {
        const detail = await res.text();
        throw new CliError(
          "API_REJECTED",
          `CE rejected the payload (HTTP ${res.status}): ${detail.slice(0, 500)}`,
        );
      }

      lastTransient = new Error(`HTTP ${res.status}`);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof CliError) throw err;
      lastTransient = err;
    }

    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 60_000)));
    }
  }

  throw new CliError(
    "API_UNAVAILABLE",
    `CE unreachable after ${maxRetries} attempts: ${String(lastTransient)}`,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node --import tsx --test src/api/ce-client.test.ts
```

Expected: PASS, 2 tests. If `API_REJECTED`/`API_UNAVAILABLE` are not in `ERROR_CODES`
(`apps/cli/src/errors.ts`), add them there with exit codes matching the existing convention —
do not invent a new error mechanism.

- [ ] **Step 5: Commit**

```bash
cd /d/Projects/Repositories/cdr-toolchain
git add apps/cli/src/api/ce-client.ts apps/cli/src/api/ce-client.test.ts apps/cli/src/errors.ts
git commit -m "feat(api): CE webhook client

Bare JSON array + x-webhook-token. A non-JSON content-type would make CE
divert the body to blob storage and silently drop it, so the header is
asserted in the test rather than assumed."
```

---

## Task 10: `export-batch` CE target + `--no-check` refusal

**Files:**
- Modify: `apps/cli/src/commands/export-batch.ts`
- Test: `apps/cli/src/commands/export-batch-ce-guard.test.ts`

The refusal is the spec's enforced safety rule. On the v2 path, storage rejected specimen-less
records as a backstop; **CE has no such backstop** (its `Specimen` requires only `resourceType`),
so on the CE path the audit gate is the only protection.

`--no-check` arrives as `check: false` — commander's `--no-` inversion, noted at
`export-batch.ts:37-38`. Resolved at `:753` as `const doCheck = opts.check !== false;`.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/src/commands/export-batch-ce-guard.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCeGatesEnabled } from "./export-batch.js";

test("refuses --no-check when a CE target is configured", () => {
  assert.throws(
    () => assertCeGatesEnabled({ ceUrl: "https://ce.example.com", doCheck: false, doQuarantine: true }),
    /--no-check/,
  );
});

test("refuses --no-quarantine when a CE target is configured", () => {
  assert.throws(
    () => assertCeGatesEnabled({ ceUrl: "https://ce.example.com", doCheck: true, doQuarantine: false }),
    /--no-quarantine/,
  );
});

test("allows the gates to be disabled when the target is not CE", () => {
  assert.doesNotThrow(
    () => assertCeGatesEnabled({ ceUrl: undefined, doCheck: false, doQuarantine: false }),
  );
});

test("allows a CE target with both gates on", () => {
  assert.doesNotThrow(
    () => assertCeGatesEnabled({ ceUrl: "https://ce.example.com", doCheck: true, doQuarantine: true }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node --import tsx --test src/commands/export-batch-ce-guard.test.ts
```

Expected: FAIL — `assertCeGatesEnabled` is not exported.

- [ ] **Step 3: Add the guard** — SKETCH. Add to `apps/cli/src/commands/export-batch.ts` (module scope, exported for test):

```ts
/** CE has no storage-level backstop: its Specimen schema requires only
 *  resourceType, so a specimen-less record persists silently. On the v2 path
 *  storage rejected those. Therefore the audit gate is the ONLY protection on
 *  the CE path, and disabling it must fail before the first query runs.
 *  A rule that depends on an operator reading a doc is not a rule. */
export function assertCeGatesEnabled(o: {
  ceUrl: string | undefined; doCheck: boolean; doQuarantine: boolean;
}): void {
  if (o.ceUrl === undefined || o.ceUrl.length === 0) return;
  if (!o.doCheck) {
    throw new CliError(
      "USAGE",
      "--no-check is refused when the target is OpenLDR CE. CE's FHIR validation is structural only and will accept records the v1 fidelity check exists to catch; the gate is the only thing between bad source data and the store. Drop --no-check, or target v2 instead.",
    );
  }
  if (!o.doQuarantine) {
    throw new CliError(
      "USAGE",
      "--no-quarantine is refused when the target is OpenLDR CE. The audit gate is the only protection on this path — CE will not reject records the audit would quarantine.",
    );
  }
}
```

- [ ] **Step 4: Wire the guard into the action, before any DB work**

In the `.action(...)` body, immediately after `quarantineThreshold` is resolved
(`export-batch.ts:~761`) and **before** the `--explain` branch at `:763`:

```ts
      const ceUrl = opts.ceUrl ?? config.openldrCeUrl;
      assertCeGatesEnabled({ ceUrl, doCheck, doQuarantine });
```

Add the CE flags to the command definition, after `--api-path` (`export-batch.ts:722`):

```ts
    .option("--ce-url <url>", "OpenLDR CE base URL (overrides OPENLDR_CE_URL env). Selects the CE target.")
    .option("--ce-hook-path <path>", "CE workflow webhook path (overrides OPENLDR_CE_HOOK_PATH env)")
    .option("--ce-token <secret>", "CE webhook token for x-webhook-token (overrides OPENLDR_CE_WEBHOOK_TOKEN env)")
```

And add to the `ExportBatchOpts` interface (`export-batch.ts:31`):

```ts
  ceUrl?: string;
  ceHookPath?: string;
  ceToken?: string;
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node --import tsx --test src/commands/export-batch-ce-guard.test.ts && pnpm typecheck
```

Expected: PASS, 4 tests; no type errors.

- [ ] **Step 6: Send to CE in the POST branch**

In `processOneLab`, the v2 lab leg begins at `export-batch.ts:586` (`if (payload.lab_results.length > 0 || payload.lab_request.panel_code !== null) {`). Add a CE branch **before** it, so a CE target takes this path instead of the v2 one:

```ts
    if (ctx.ceConfig !== undefined) {
      const resources = toFhir(payload);
      const post = await postFhirResources(resources, {
        baseUrl: ctx.ceConfig.baseUrl,
        path: ctx.ceConfig.path,
        token: ctx.ceConfig.token,
      });
      result.http_status = post.status;
      result.status = "posted";
      result.duration_ms = Date.now() - start;
      return result;
    }
```

Add the imports at the top of `export-batch.ts`:

```ts
import { toFhir } from "../export/fhir-transform.js";
import { postFhirResources } from "../api/ce-client.js";
```

Build `ctx.ceConfig` where `ctx.postConfig` is assembled, guarding on the token:

```ts
      const ceConfig = ceUrl !== undefined && ceUrl.length > 0
        ? {
            baseUrl: ceUrl,
            path: opts.ceHookPath ?? config.openldrCeHookPath,
            token: opts.ceToken ?? config.openldrCeWebhookToken ?? "",
          }
        : undefined;
      if (ceConfig !== undefined && ceConfig.token.length === 0) {
        throw new CliError(
          "CONFIG_MISSING",
          "CE webhook token required. Set OPENLDR_CE_WEBHOOK_TOKEN or pass --ce-token.",
        );
      }
```

Add `ceConfig` to the context type used by `processOneLab` (search for `postConfig` in the ctx interface and add a sibling optional field of the same shape as above).

- [ ] **Step 7: Verify the whole suite is green**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli && pnpm test 2>&1 | tail -10 && pnpm typecheck
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
cd /d/Projects/Repositories/cdr-toolchain
git add apps/cli/src/commands/export-batch.ts apps/cli/src/commands/export-batch-ce-guard.test.ts
git commit -m "feat(export-batch): CE target and enforced gate refusal

--no-check/--no-quarantine now exit non-zero before the first query when a
CE target is configured. v2's storage rejected specimen-less records as a
backstop; CE's Specimen schema requires only resourceType, so the audit gate
is the only protection on this path."
```

---

## Task 11: Fix the stale `specimen_missing` message

**Files:**
- Modify: `apps/cli/src/audit/detector.ts`

Current text, read at `apps/cli/src/audit/detector.ts:~99`:

> `` `Lab has ${realPanels.length} ordered test panel(s) but no specimen recorded. v2 storage will reject — fix the source data before re-attempting.` ``

CE will **not** reject it (`Specimen` requires only `resourceType`). The claim is now false and
misleading.

- [ ] **Step 1: Update the message**

```ts
        message: `Lab has ${realPanels.length} ordered test panel(s) but no specimen recorded. Quarantined: v2 storage rejects this, and OpenLDR CE would silently accept it — fix the source data before re-attempting.`,
```

- [ ] **Step 2: Run the audit tests**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node --import tsx --test src/audit/detector-non-test.test.ts
```

Expected: PASS. If a test asserts on the message text, update the assertion.

- [ ] **Step 3: Commit**

```bash
cd /d/Projects/Repositories/cdr-toolchain
git add apps/cli/src/audit/detector.ts
git commit -m "fix(audit): correct specimen_missing's stale rejection claim

It said 'v2 storage will reject'. CE will not — its Specimen schema requires
only resourceType. The gate, not the destination, is what stops this record."
```

---

## Task 12: Build the CE workflow (openldr_ce, config only)

**Files:** none — Studio UI work against the running dev stack (API `:3000`, Studio `:5173`).

- [ ] **Step 1: Confirm CE is up**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/health
```

Expected: a response (401 is fine — it means the API is live).

- [ ] **Step 2: Create the workflow in Studio**

Open `http://localhost:5173` → Workflows → new workflow named `cdr-ingest`, with exactly three nodes:

| Node | Config |
|---|---|
| **Trigger** (webhook) | path `cdr-ingest`; generate a secret and record it |
| **Split Out** | `field` = **`body`** — a flat key lookup (`split-out.ts:9`), not a path |
| **Persist Store** | `source` = `cdr` |

Wire: trigger → split-out → persist-store. Save and enable.

- [ ] **Step 3: Record the secret**

Add to `cdr-toolchain/apps/cli/.env` (gitignored, confirmed via `git check-ignore`):

```
OPENLDR_CE_URL=http://localhost:3000
OPENLDR_CE_HOOK_PATH=/api/workflows/hooks/cdr-ingest
OPENLDR_CE_WEBHOOK_TOKEN=<the secret from step 2>
```

- [ ] **Step 4: Smoke-test the webhook with a hand-made Patient — before touching DISA**

```bash
curl -s -X POST http://localhost:3000/api/workflows/hooks/cdr-ingest \
  -H "Content-Type: application/json" \
  -H "x-webhook-token: <secret>" \
  -d '[{"resourceType":"Patient","id":"smoke-1","gender":"female"}]'
```

Expected: `{"ok":true,"runId":"..."}`. Then confirm it landed:

```bash
docker exec -i $(docker ps -qf name=postgres) psql -U postgres -d openldr \
  -c "select resource_type, id from fhir.fhir_resources order by 1 desc limit 5;"
```

Expected: a `Patient` row with id `smoke-1`.

**If the row is absent but the webhook returned ok**, the split-out field is wrong — re-check it
is `body`, and that the request carried `Content-Type: application/json`.

---

## Task 13: Live run — one lab

**Files:** none

**This queries the live production DISA and puts real PHI into the dev Postgres. Both approved
in the spec (2026-07-16). Read-only is verified.**

- [ ] **Step 1: Dry-run one lab and inspect the FHIR — no network write**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
pnpm dev -- export-batch --limit 1 --dry-run --emit-payloads 2>/dev/null | head -1 | python -m json.tool | head -40
```

Expected: a `V2Payload`. **Confirm `--emit-payloads` still emits V2, not FHIR** — this slice does
not change that flag's contract.

- [ ] **Step 2: Verify the gate refusal actually fires**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
pnpm dev -- export-batch --limit 1 --no-check --ce-url http://localhost:3000; echo "exit=$?"
```

Expected: non-zero exit, message naming `--no-check`, **and no DISA query issued**.

- [ ] **Step 3: Send exactly one lab to CE**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
pnpm dev -- export-batch --limit 1 --ce-url http://localhost:3000
```

Expected: one NDJSON line with `"status":"posted"`.

- [ ] **Step 4: Verify it landed, with provenance**

```bash
docker exec -i $(docker ps -qf name=postgres) psql -U postgres -d openldr -c \
  "select resource_type, count(*) from fhir.fhir_resources group by 1 order by 1;"
docker exec -i $(docker ps -qf name=postgres) psql -U postgres -d openldr -c \
  "select id, resource_type from fhir.change_log order by seq desc limit 10;"
```

Expected: Patient / ServiceRequest / Specimen / DiagnosticReport / Observation rows, and
matching `change_log` entries (persist writes both — `fhir-store.ts:184,260,315`).

- [ ] **Step 5: Report before widening**

Stop here and report: resource counts, anything the audit quarantined, and any resource CE
rejected. **Do not proceed to Task 14 without review.**

---

## Task 14: Live run — small batch

**Files:** none

- [ ] **Step 1: Twenty labs**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
pnpm dev -- export-batch --limit 20 --ce-url http://localhost:3000 > /tmp/ce-batch.ndjson
tail -5 /tmp/ce-batch.ndjson
```

- [ ] **Step 2: Reconcile the counts**

```bash
grep -c '"status":"posted"' /tmp/ce-batch.ndjson
grep -c '"status":"quarantined"' /tmp/ce-batch.ndjson
docker exec -i $(docker ps -qf name=postgres) psql -U postgres -d openldr -c \
  "select count(distinct id) from fhir.fhir_resources where resource_type='DiagnosticReport';"
```

Expected: `DiagnosticReport` count == posted count. A mismatch means resources were silently
dropped — **investigate before widening further**.

- [ ] **Step 3: Merge to local `main`**

```bash
cd /d/Projects/Repositories/cdr-toolchain
git checkout main
git merge --no-ff feat/ce-fhir-ingest -m "feat: CDR -> OpenLDR CE FHIR ingest

Maps V2Payload to FHIR R4 and posts to a CE workflow webhook. The CLI stays
the engine; CE takes no code changes."
git branch -d feat/ce-fhir-ingest
```

- [ ] **Step 4: Report findings**

Record for the CE-strictness slice: every conformance error `fhir-validator-js` reported, and
anything real DISA data did that the fixtures did not predict.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `fhir-transform.ts` — V2Payload → FHIR | 3, 4, 5, 6 |
| Patient / ServiceRequest+Specimen+DiagnosticReport / Observation / hasMember tree | 3 / 4 / 5 / 6 |
| `abnormal_flag` → interpretation, `rpt_range` → referenceRange | 5 |
| `ce-client.ts` — x-webhook-token, retry reuse | 9 |
| `export-batch` CE target flags + env | 8, 10 |
| `--no-check` refused in code, before first query | 10 |
| `fhir-validator-js` as test-only devDep | 7 |
| Fix `specimen_missing` stale message | 11 |
| CE workflow: webhook → split-out(`body`) → persist-store, no code changes | 12 |
| Bare JSON array + `Content-Type: application/json` | 9 (asserted), 12 (smoke) |
| One payload per lab (non-atomic persist blast radius) | 10 (per-lab send in `processOneLab`) |
| Live: `--limit 1` → verify → small batch | 13, 14 |
| Audit rule asserting projection-needed fields | **GAP — see below** |

**Gap accepted:** the spec's third testing bullet (an audit rule asserting the mapper's output
carries the fields CE's projection needs) is **deliberately deferred to after Task 13**. What the
projection actually requires is not knowable from the fixtures; Task 13 Step 5 and Task 14 Step 4
gather exactly that evidence. Writing the rule now would be guessing. Raise it as a follow-up
task once the live run reports.

**Placeholder scan:** no TBD/TODO; every code step carries complete code; new code is marked
SKETCH per the cite-or-flag rule, and every quoted existing line carries a `file:line`.

**Type consistency:** `toFhir(payload: V2Payload): FhirResource[]` — Tasks 3→6 all extend one
signature. `postFhirResources(resources, opts)` — Task 9 defines, Task 10 calls with the same
shape. `assertCeGatesEnabled({ceUrl, doCheck, doQuarantine})` — Task 10 defines and calls
identically. `fhirId`/`fhirDateTime`/`fhirText` — Task 2 defines, Tasks 3–6 consume unchanged.
`ctx.ceConfig` (`{baseUrl, path, token}`) — built and consumed in Task 10.
