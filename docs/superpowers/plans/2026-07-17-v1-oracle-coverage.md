# v1 Oracle Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the V2↔v1 coverage guard assert against **v1's real 60/28 columns** instead of the 26/13 our `SELECT` happens to fetch — so the gate grades the oracle, not itself.

**Architecture:** A checked-in `v1-schema.json` snapshot (generated from `INFORMATION_SCHEMA`) becomes the coverage guard's source of truth. Every v1 column is classified into exactly one of five buckets: **def** (graded), **exception** (structural gap), **bookkeeping**, **not_carried** (a product decision), **measured_empty**. The fetch and row types widen to cover the 16 columns that get new defs; 25 are `not_carried` and never SELECTed.

**Tech Stack:** TypeScript. **`node:test`, NOT vitest.** Run from `apps/cli`.

**Spec:** `docs/superpowers/specs/2026-07-17-v1-oracle-coverage-design.md` (`bb9e88bc` + `5d359c62`, `cc82c3f0`, `af42f70a`, `61ea80e0`, `89127c20`, `ee961469`)

**Repo:** `D:\Projects\Repositories\cdr-toolchain`, branch `slice/observation-timestamps`, baseline `ac4dd1e`, clean. **173 tests / 172 pass / 1 pre-existing skip.**

---

## ⛔ Read before Task 1

1. **Run tests from `apps/cli`.** `node --import tsx --test` from the repo root fails with
   `ERR_MODULE_NOT_FOUND` (tsx is a dep of `apps/cli`, not the root) — **a resolution error is easy
   to mistake for a real test failure**, which defeats the watch-it-fail step.
2. **`pnpm dev -- <cmd>` breaks commander** — flags are silently ignored. Use
   `node --import tsx src/index.ts <cmd>`.
3. **No `Co-Authored-By` trailer.** The user is the sole contributor.
4. **This slice MEASURES. It fixes no stub.** Every new def below is *expected* to go red. The red is
   the deliverable; each fix is its own later slice.
5. **"Non-empty" is TYPE-DEPENDENT.** `<> ''` for VARCHAR, `<> 0` for numeric/bit. Using one rule for
   both produced confident nonsense twice while writing the spec. Numerics default to `0` in v1
   (`types.ts:160`).
6. **PHI:** `EncryptedPatientID` is **`not_carried` and must never be added to the SELECT.** The gate
   prints values into diff rows and committed findings docs.
7. **Patient identity is OUT OF SCOPE — deferred to last, by decision.** `patient_guid = requestId`
   is **SETTLED** (the blocker is commercial, not technical). **Do not open it.** See
   [[disa-vendor-constraint]].

---

## File Structure

| file | responsibility |
|---|---|
| Create: `apps/cli/scripts/dump-v1-schema.ts` | generator — dumps `INFORMATION_SCHEMA` to the snapshot |
| Create: `apps/cli/src/compare/v1-schema.json` | the snapshot: v1's real column lists |
| Create: `apps/cli/src/compare/v1-coverage.ts` | the five buckets + `not_carried`/`measured_empty` tables |
| Create: `apps/cli/src/compare/v1-coverage.test.ts` | the coverage guard + count guard |
| Modify: `apps/cli/src/openldr.ts` | widen `REQUEST_COLUMNS` / `LAB_RESULT_COLUMNS` + row types |
| Modify: `apps/cli/src/compare/v2-mapping.ts` | the 16 new defs; move bookkeeping into `v1-coverage.ts` |
| Modify: `apps/cli/src/compare/v2-mapping.test.ts` | retire the old type-based guard |

**Arithmetic that must hold at the end. Verified column-by-column, not eyeballed:**

```
Requests   60 = 4 bookkeeping + 25 existing defs + 1 exception (LIMSPointOfCareDesc)
                             + 20 not_carried + 10 new defs
LabResults 28 = 4 bookkeeping + 10 existing defs + 1 exception (OBRSetID) + 2 pairing-key
                             +  5 not_carried +  6 new defs
```

⚠ **`LIMSPanelCode` and `LIMSPanelDesc` are NOT LabResults columns** — `openldr.ts:217` selects them
as `req.[...]` through the join to Requests. They never appear in the LabResults snapshot, so they
play no part in its arithmetic even though `OpenLdrV1LabResult` declares them. **This is why the
"13 declared fields" number is not 13 real columns** — the same
mistake-a-type-for-a-schema trap this whole slice exists to close.

⚠ `allPanelCodes` is likewise **not a column** — `fetchRequestByRequestId` synthesises it
(`openldr.ts:114-124`). It is `V1_REQUEST_DERIVED`, not bookkeeping, and the snapshot has never heard
of it.

---

## Task 1: The v1 schema snapshot + its generator

**Files:**
- Create: `apps/cli/scripts/dump-v1-schema.ts`
- Create: `apps/cli/src/compare/v1-schema.json`
- Create: `apps/cli/src/compare/v1-coverage.test.ts`

**Why a snapshot and not live `INFORMATION_SCHEMA`** (decided, spec §5.2): the Zambia and Mozambique
teams run this **without a Tanzania v1 to query**, and CI has no v1 at all — a live guard simply
would not run for them. The snapshot's failure mode is going **stale**, so Step 3's count assertion
exists to make a truncated or partial regeneration **fail loudly** instead of quietly shrinking
coverage. That quiet shrink is the exact bug this slice exists to kill.

- [ ] **Step 1: Write the generator**

Create `apps/cli/scripts/dump-v1-schema.ts`:

```ts
// Regenerate with:
//   cd apps/cli && node --import tsx scripts/dump-v1-schema.ts
// Requires a live OpenLDR v1 connection (OPENLDR_V1_CONNECTION_STRING).
// The output is COMMITTED so the coverage guard runs without a database --
// the Zambia/Moz teams have no Tanzania v1, and CI has none at all.
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "disalab";
import { closePool } from "../src/db.js";
import { loadConfig } from "../src/config.js";

const cfg = loadConfig({});
const cs = cfg.openldrConnectionString;
if (cs === undefined || cs.length === 0) {
  throw new Error("Set OPENLDR_V1_CONNECTION_STRING to regenerate the schema snapshot.");
}
const db = cfg.openldrDataDatabase;

const out: Record<string, string[]> = {};
try {
  const pool = await getPool(cs);
  for (const table of ["Requests", "LabResults"]) {
    const r = await pool.request().query(
      `select COLUMN_NAME from [${db}].INFORMATION_SCHEMA.COLUMNS
       where TABLE_NAME='${table}' order by ORDINAL_POSITION`,
    );
    out[table] = (r.recordset as { COLUMN_NAME: string }[]).map((x) => x.COLUMN_NAME);
  }
} finally {
  await closePool();
}

const target = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "compare", "v1-schema.json");
writeFileSync(
  target,
  JSON.stringify(
    {
      _comment:
        "GENERATED — do not hand-edit. Regenerate: cd apps/cli && node --import tsx scripts/dump-v1-schema.ts",
      _source: `${db} INFORMATION_SCHEMA.COLUMNS`,
      _generated_from_site: "TDS (Tanzania)",
      tables: out,
    },
    null,
    2,
  ) + "\n",
);
console.log(`wrote ${target}: Requests=${out.Requests?.length}, LabResults=${out.LabResults?.length}`);
```

⚠ **No timestamp field.** A regenerated-but-identical snapshot must produce **no diff**, or every
regeneration becomes a noise commit and people stop regenerating.

- [ ] **Step 2: Run it**

Run: `cd apps/cli && node --import tsx scripts/dump-v1-schema.ts`
Expected: `wrote ...v1-schema.json: Requests=60, LabResults=28`

⚠ **If the counts are not 60 and 28, STOP and report.** They were measured on 2026-07-17. A
different number means this laptop's v1 is not the v1 the spec measured, and every count in the spec
is suspect.

- [ ] **Step 3: Write the count guard**

Create `apps/cli/src/compare/v1-coverage.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import schema from "./v1-schema.json" with { type: "json" };

// THE STALENESS GUARD. The snapshot's only failure mode is going stale or being
// regenerated against a partial/wrong database. Pinning the COUNT makes that fail
// loudly here, instead of silently shrinking what the coverage guard below checks
// -- a quiet shrink is the exact bug this slice exists to kill.
// Measured against INFORMATION_SCHEMA on 2026-07-17.
test("the v1 schema snapshot has v1's real column counts", () => {
  assert.equal(schema.tables.Requests.length, 60);
  assert.equal(schema.tables.LabResults.length, 28);
});

// Guards the guard: a snapshot of 60 empty strings would satisfy the counts above.
test("the snapshot holds real column names", () => {
  for (const t of ["Requests", "LabResults"] as const) {
    for (const c of schema.tables[t]) {
      assert.ok(typeof c === "string" && c.trim().length > 0, `${t}: blank column name`);
    }
  }
  assert.ok(schema.tables.Requests.includes("OBRSetID"));
  assert.ok(schema.tables.LabResults.includes("LIMSRptFlag"));
});
```

- [ ] **Step 4: Run it**

Run: `cd apps/cli && node --import tsx --test src/compare/v1-coverage.test.ts`
Expected: PASS (2 tests).

⚠ If `import ... with { type: "json" }` errors, the repo's Node/tsconfig may not allow JSON import
attributes. **Fallback:** `import { readFileSync } from "node:fs"` +
`JSON.parse(readFileSync(new URL("./v1-schema.json", import.meta.url), "utf8"))`. Do **not** convert
the snapshot to a `.ts` file — it must stay machine-generated data, not code someone edits by hand.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/scripts/dump-v1-schema.ts apps/cli/src/compare/v1-schema.json apps/cli/src/compare/v1-coverage.test.ts
git commit -m "feat(compare): check in a generated v1 schema snapshot

The coverage guard has been asserting over OpenLdrV1Request -- the 26 columns our
SELECT fetches -- while calling it 'every v1 column'. v1's Requests table has 60
and LabResults has 28. Snapshot rather than live INFORMATION_SCHEMA because the
Zambia/Moz teams run this with no Tanzania v1, and CI has none; the count guard
makes the snapshot's one failure mode (going stale) fail loudly."
```

---

## Task 2: The five buckets — classify every column

**Files:**
- Create: `apps/cli/src/compare/v1-coverage.ts`
- Modify: `apps/cli/src/compare/v1-coverage.test.ts`

**Context:** every v1 column must land in exactly one bucket. Two of the five are **not graded**, so a
mistake in either is **invisible in the report** — they are reviewed by hand, not by test.

- [ ] **Step 1: Write the bucket model + tables**

Create `apps/cli/src/compare/v1-coverage.ts`:

```ts
/**
 * Classification of every v1 column. The coverage guard (v1-coverage.test.ts)
 * asserts this against the GENERATED snapshot, not against our row types --
 * OpenLdrV1Request is the 26 columns we SELECT, which is not v1.
 */

/** LIS-generated bookkeeping. Stamped by OpenLDR when it ingests an HL7 message;
 *  nothing on the CDR side can or should produce them.
 *  ⚠ LabResults spells it LIMSVersionStamp (capital S); Requests uses
 *  LIMSVersionstamp. That is v1's own inconsistency, verified in both
 *  INFORMATION_SCHEMA and types.ts. CE standardises on the capital-S form in ITS
 *  OWN schema -- but these lists must keep mirroring v1 exactly, because
 *  v1-transform writes into v1's real tables. Do not "fix" the typo here. */
export const V1_REQUEST_BOOKKEEPING: readonly string[] = [
  "DateTimeStamp", "Versionstamp", "LIMSDateTimeStamp", "LIMSVersionstamp",
];
export const V1_RESULT_BOOKKEEPING: readonly string[] = [
  "DateTimeStamp", "Versionstamp", "LIMSDateTimeStamp", "LIMSVersionStamp",
];

/** Not a v1 column at all: fetchRequestByRequestId synthesises it by aggregating
 *  LIMSPanelCode across sibling OBR rows (openldr.ts:114-124). Excluded from the
 *  snapshot guard because the snapshot only knows real columns. */
export const V1_REQUEST_DERIVED: readonly string[] = ["allPanelCodes"];

export interface NotCarried {
  column: string;
  /** The measurement behind the decision, WITH its date. Never "n/a". */
  measured: string;
  reason: string;
  decidedBy: string;
  decidedOn: string;
  /** Set when the column is EXPECTED BACK. "for now" without this is a lie the
   *  next reader cannot detect. */
  revisit?: string;
}

/**
 * ⛔ A DECISION, not a measurement. Dropped because CE chose not to model them --
 * NOT because they are unpopulated. TDS is 1 site of 22; a population count from
 * Zambia does NOT make these wrong. Do not "correct" an entry by pointing at a
 * count -- that is what `revisit` is for.
 */
export const V1_REQUEST_NOT_CARRIED: readonly NotCarried[] = [
  { column: "WorkUnits", measured: "0 non-zero of 174,261 (TDS, 2026-07-17)", reason: "dead; billing metric out of CE scope", decidedBy: "user", decidedOn: "2026-07-17" },
  { column: "CostUnits", measured: "36,374 non-zero of 174,261 = 20.9% (TDS, 2026-07-17)", reason: "billing/cost units out of CE scope REGARDLESS of population — asked explicitly because at ~20% the 'barely used' rationale did not reach it", decidedBy: "user", decidedOn: "2026-07-17" },
  { column: "Deceased", measured: "0 non-zero of 174,261 (TDS, 2026-07-17)", reason: "dead", decidedBy: "user", decidedOn: "2026-07-17" },
  { column: "TargetTimeDays", measured: "0 non-zero of 174,261 (TDS, 2026-07-17)", reason: "dead; turnaround targets out of CE scope", decidedBy: "user", decidedOn: "2026-07-17" },
  { column: "TargetTimeMins", measured: "0 non-zero of 174,261 (TDS, 2026-07-17)", reason: "dead; turnaround targets out of CE scope", decidedBy: "user", decidedOn: "2026-07-17" },
  { column: "LOINCPanelCode", measured: "0 of 174,261 (TDS, 2026-07-17)", reason: "CE resolves LOINC through its own terminology service; importing v1's empty LOINC column imports a problem CE already solved", decidedBy: "user", decidedOn: "2026-07-17" },
  { column: "LIMSPreReg_RegistrationDateTime", measured: "0 of 174,261 (TDS, 2026-07-17)", reason: "pre-registration workflow, never used", decidedBy: "user", decidedOn: "2026-07-17" },
  { column: "LIMSPreReg_ReceivedDateTime", measured: "0 of 174,261 (TDS, 2026-07-17)", reason: "pre-registration workflow, never used", decidedBy: "user", decidedOn: "2026-07-17" },
  { column: "LIMSPreReg_RegistrationFacilityCode", measured: "0 of 174,261 (TDS, 2026-07-17)", reason: "pre-registration workflow, never used", decidedBy: "user", decidedOn: "2026-07-17" },
  { column: "AdmitAttendDateTime", measured: "0 of 174,261 (TDS, 2026-07-17)", reason: "legacy admission timestamp; CE does not model encounters", decidedBy: "user", decidedOn: "2026-07-17" },
  { column: "ReferringRequestID", measured: "0 of 174,261 (TDS, 2026-07-17)", reason: "legacy referral linkage, unused", decidedBy: "user", decidedOn: "2026-07-17" },
  { column: "HL7EthnicGroupCode", measured: "0 of 174,261 (TDS, 2026-07-17)", reason: "unused AND sensitive — dropped on principle as well as population", decidedBy: "user", decidedOn: "2026-07-17" },
  { column: "HL7SpecimenSourceCode", measured: "0 of 174,261 (TDS, 2026-07-17)", reason: "specimen SITE never populated (specimen SOURCE is carried — see V2_REQUEST_FIELDS.specimen_code)", decidedBy: "user", decidedOn: "2026-07-17", revisit: "specimen-site may return; user: 'we will slowly add them back bit by bit'" },
  { column: "HL7SpecimenSiteCode", measured: "0 of 174,261 (TDS, 2026-07-17)", reason: "specimen site never populated", decidedBy: "user", decidedOn: "2026-07-17", revisit: "specimen-site may return; user: 'we will slowly add them back bit by bit'" },
  { column: "LIMSSpecimenSiteCode", measured: "0 of 174,261 (TDS, 2026-07-17)", reason: "specimen site never populated", decidedBy: "user", decidedOn: "2026-07-17", revisit: "specimen-site may return; user: 'we will slowly add them back bit by bit'" },
  { column: "LIMSSpecimenSiteDesc", measured: "0 of 174,261 (TDS, 2026-07-17)", reason: "specimen site never populated", decidedBy: "user", decidedOn: "2026-07-17", revisit: "specimen-site may return; user: 'we will slowly add them back bit by bit'" },
  { column: "Newborn", measured: "6 non-zero of 174,261 (TDS, 2026-07-17) — NOISE, not zero", decidedBy: "user", decidedOn: "2026-07-17", reason: "negligible; CE does not model it" },
  { column: "Repeated", measured: "3 non-zero of 174,261 (TDS, 2026-07-17) — NOISE, not zero", decidedBy: "user", decidedOn: "2026-07-17", reason: "negligible; CE does not model it" },
  { column: "ReceivingFacilityCode", measured: "174,261 of 174,261 = CONSTANT 'TDS' (TDS, 2026-07-17) — populated, not empty", reason: "duplicate of TestingFacilityCode (measured: both 'TDS' on every row), which IS graded; derivable from site config", decidedBy: "user", decidedOn: "2026-07-17", revisit: "user: 'may need to be revisited like specimen-site and ReceivingFacilityCode'" },
  { column: "EncryptedPatientID", measured: "88,115 of 174,261 = 50.6%, 44,829 distinct values, one spanning 116 requests (TDS, 2026-07-17)", reason: "PHI-adjacent pseudonym, and it is v1's OWN hash from v1's ingest — CE should not inherit another system's derivation. ⚠ NOT dropped as redundant: that premise was FALSIFIED, it is a working patient key. Its real home is v2's patients.encrypted_patient_id, which CDR never populates. Patient identity is deferred to LAST by decision.", decidedBy: "user", decidedOn: "2026-07-17", revisit: "deferred, not closed — patient identity is its own workstream, taken last" },
];

export const V1_RESULT_NOT_CARRIED: readonly NotCarried[] = [
  { column: "WorkUnits", measured: "227 non-zero of 643,855 = 0.04% (TDS, 2026-07-17)", reason: "noise; billing metric out of CE scope", decidedBy: "user", decidedOn: "2026-07-17" },
  { column: "CostUnits", measured: "127,140 non-zero of 643,855 = 19.7% (TDS, 2026-07-17)", reason: "billing/cost units out of CE scope REGARDLESS of population", decidedBy: "user", decidedOn: "2026-07-17" },
  { column: "Note", measured: "68,645 of 643,855 = 10.7% (TDS, 2026-07-17) — a BIT (0 x 575,210 / 1 x 68,645), not free text", reason: "legacy flag with undocumented meaning", decidedBy: "user", decidedOn: "2026-07-17" },
  { column: "DateTimeValue", measured: "33,004 of 643,855 = 5.1% (TDS, 2026-07-17)", reason: "a TYPED PROJECTION, not data: for 30,198 of its 33,004 rows LIMSRptResult already holds the same value as text ('01/03/2013' <-> 2013-03-01), which CDR emits as result_value. The 2,806 exceptions are ALL one observation — TPT 'Tranportation Time' (v1's typo) under panel COL: logistics, not a clinical result. ⚠ It is NOT a per-result timestamp — measured, not assumed", decidedBy: "user", decidedOn: "2026-07-17" },
  { column: "LOINCCode", measured: "2 of 643,855 (TDS, 2026-07-17)", reason: "dead; CE resolves LOINC through its own terminology service", decidedBy: "user", decidedOn: "2026-07-17" },
];

/**
 * ⛔ Deliberately EMPTY, and it stays defined.
 *
 * Every column that would have landed here was swept into not_carried as a SCOPE
 * decision. The distinction is load-bearing and must not be collapsed:
 *
 *   measured_empty -- "we observed no data, on ONE of 22 sites". Falsified by the
 *                     next site's data. If wrong, a REAL field is silently uncovered.
 *   not_carried    -- "CE deliberately does not model this". Reversed only by a
 *                     person. If wrong, nothing.
 *
 * Conflating them is how "we have no evidence" becomes "we decided" without
 * anyone deciding.
 */
export const V1_REQUEST_MEASURED_EMPTY: readonly NotCarried[] = [];
export const V1_RESULT_MEASURED_EMPTY: readonly NotCarried[] = [];
```

- [ ] **Step 1b: Resolve the NAME COLLISIONS this creates — do this before Step 2 or the imports lie**

`v2-mapping.ts` already exports `V1_REQUEST_BOOKKEEPING` and `V1_RESULT_BOOKKEEPING`, and **neither
means what `v1-coverage.ts` means by "bookkeeping"**. Two different things under one name in two
modules is a bug waiting to happen — rename at the source rather than aliasing at each import:

| in `v2-mapping.ts` | currently | rename to | why |
|---|---|---|---|
| `V1_REQUEST_BOOKKEEPING` = `["allPanelCodes"]` | a **derived TS field**, not a v1 column | **MOVE to `v1-coverage.ts` as `V1_REQUEST_DERIVED`** — delete it from `v2-mapping.ts`, do not leave a copy | it is not bookkeeping and not a column; the snapshot has never heard of it. Step 1's `v1-coverage.ts` already declares `V1_REQUEST_DERIVED` — **two definitions would drift** |
| `V1_RESULT_BOOKKEEPING` = `["RequestID","LIMSPanelCode","LIMSObservationCode"]` | the **pairing key** | **`V1_RESULT_PAIRING_KEY`** | it says what it is; rows are paired BY these, so grading them would be vacuously green |

`v1-coverage.ts` then owns `V1_REQUEST_BOOKKEEPING` / `V1_RESULT_BOOKKEEPING` meaning the real
LIS stamps.

Also **delete** the two doc-only constants `V1_REQUEST_UNCOVERED_NOT_FETCHED = 34` and
`V1_RESULT_UNCOVERED_NOT_FETCHED = 11` from `v2-mapping.ts`, plus their comment blocks. They
existed only to record the blind spot in prose; **this task closes it, so leaving them behind leaves
a false claim in the source.** Fix the imports in `v2-mapping.test.ts` and
`v2-result-mapping.test.ts` accordingly.

Run: `cd apps/cli && npx tsc --noEmit` — expected clean before continuing.

- [ ] **Step 2: Write the failing coverage guard**

Append to `apps/cli/src/compare/v1-coverage.test.ts`:

```ts
import {
  V1_REQUEST_BOOKKEEPING, V1_RESULT_BOOKKEEPING,
  V1_REQUEST_NOT_CARRIED, V1_RESULT_NOT_CARRIED,
  V1_REQUEST_MEASURED_EMPTY, V1_RESULT_MEASURED_EMPTY,
} from "./v1-coverage.js";
import {
  V2_REQUEST_FIELDS, V2_REQUEST_EXCEPTIONS,
  V2_RESULT_FIELDS, V2_RESULT_EXCEPTIONS,
  V1_RESULT_PAIRING_KEY,
} from "./v2-mapping.js";

// THE GUARD THIS SLICE EXISTS FOR. The old one asserted over OpenLdrV1Request --
// our SELECT -- and called it "every v1 column". It covered 26 of 60.
test("every v1 Requests column is classified", () => {
  const covered = new Set<string>([
    ...V2_REQUEST_FIELDS.map((f) => f.v1Column),
    ...V2_REQUEST_EXCEPTIONS.map((e) => e.v1Column),
    ...V1_REQUEST_BOOKKEEPING,
    ...V1_REQUEST_NOT_CARRIED.map((n) => n.column),
    ...V1_REQUEST_MEASURED_EMPTY.map((n) => n.column),
  ]);
  const uncovered = schema.tables.Requests.filter((c) => !covered.has(c));
  assert.deepEqual(uncovered, [], `unclassified v1 Requests columns: ${uncovered.join(", ")}`);
});

test("every v1 LabResults column is classified", () => {
  const covered = new Set<string>([
    ...V2_RESULT_FIELDS.map((f) => f.v1Column),
    ...V2_RESULT_EXCEPTIONS.map((e) => e.v1Column),
    ...V1_RESULT_PAIRING_KEY, // RequestID / LIMSPanelCode / LIMSObservationCode
    ...V1_RESULT_BOOKKEEPING,
    ...V1_RESULT_NOT_CARRIED.map((n) => n.column),
    ...V1_RESULT_MEASURED_EMPTY.map((n) => n.column),
  ]);
  // LIMSPanelCode / LIMSPanelDesc are joined in from Requests (openldr.ts:217),
  // so they are not LabResults columns and never appear in this snapshot.
  const uncovered = schema.tables.LabResults.filter((c) => !covered.has(c));
  assert.deepEqual(uncovered, [], `unclassified v1 LabResults columns: ${uncovered.join(", ")}`);
});

// Every column in EXACTLY one bucket -- a column that is both graded and
// not_carried would silently never be fetched while claiming to be graded.
test("no v1 column is in two buckets", () => {
  const req = [
    ...V2_REQUEST_FIELDS.map((f) => f.v1Column),
    ...V2_REQUEST_EXCEPTIONS.map((e) => e.v1Column),
    ...V1_REQUEST_BOOKKEEPING,
    ...V1_REQUEST_NOT_CARRIED.map((n) => n.column),
  ];
  const dupes = req.filter((c, i) => req.indexOf(c) !== i);
  assert.deepEqual(dupes, [], `v1 Requests columns in two buckets: ${dupes.join(", ")}`);
});

// not_carried is NOT GRADED, so a mistake in it is invisible in the report.
// These are the only automated checks it gets.
test("every not_carried entry carries a measurement, a reason and a decider", () => {
  for (const n of [...V1_REQUEST_NOT_CARRIED, ...V1_RESULT_NOT_CARRIED]) {
    assert.ok(n.measured.trim().length > 0, `${n.column}: no measurement`);
    assert.ok(!/^n\/?a$/i.test(n.measured.trim()), `${n.column}: "n/a" is not a measurement`);
    assert.ok(n.reason.trim().length > 0, `${n.column}: no reason`);
    assert.ok(n.decidedBy.trim().length > 0, `${n.column}: no decider`);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(n.decidedOn), `${n.column}: decidedOn must be YYYY-MM-DD`);
  }
});

// The user's plan is "we will slowly add them back bit by bit". A bucket that
// cannot say "parked" vs "gone" turns that into archaeology through a git log.
test("the columns promised a revisit actually carry one", () => {
  const parked = new Set([
    "HL7SpecimenSourceCode", "HL7SpecimenSiteCode", "LIMSSpecimenSiteCode",
    "LIMSSpecimenSiteDesc", "ReceivingFacilityCode", "EncryptedPatientID",
  ]);
  for (const n of V1_REQUEST_NOT_CARRIED) {
    if (parked.has(n.column)) {
      assert.ok(n.revisit !== undefined && n.revisit.trim().length > 0, `${n.column}: parked but no revisit note`);
    }
  }
});
```

- [ ] **Step 3: Run — CONFIRM IT FAILS. Paste the output.**

Run: `cd apps/cli && node --import tsx --test src/compare/v1-coverage.test.ts`
Expected: FAIL on both coverage tests, listing the **10 unclassified Requests columns**
(`OBRSetID`, `RequestTypeCode`, `LIMSFacilityCode`, `RegisteredBy`, `OrderingNotes`,
`LIMSAnalyzerCode`, `LIMSVendorCode`, `CollectionVolume`, `LIMSRejectionCode`, `LIMSRejectionDesc`)
and the **6 unclassified LabResults columns** (`LIMSRptFlag`, `LIMSRptUnits`, `SILoRange`,
`SIHiRange`, `CodedValue`, `ResultSemiquantitive`).

⚠ **If it lists MORE than those 16, STOP and report** — the extra names are columns neither the spec
nor this plan accounted for, and the spec's arithmetic is wrong.

- [ ] **Step 4: Commit (RED — deliberately)**

The guard is honest and currently failing; Tasks 3–6 close it. Committing red here means the next
task cannot quietly redefine the target.

```bash
git add apps/cli/src/compare/v1-coverage.ts apps/cli/src/compare/v1-coverage.test.ts
git commit -m "feat(compare): classify every v1 column into five buckets (guard RED)

Adds not_carried (a decision) and measured_empty (a measurement) as SEPARATE
buckets -- they look identical in a report and expire differently: a measurement
is falsified by the next site's data, a decision only by a person. measured_empty
is deliberately empty and stays defined for the next site.

The coverage guard now asserts against the generated snapshot and FAILS on the 16
columns Tasks 3-6 add defs for. Committed red on purpose."
```

---

## Task 3: Widen the `Requests` fetch + row type

**Files:** `apps/cli/src/openldr.ts`

**Context:** `REQUEST_COLUMNS` (`:69-80`) selects 26 columns. Add the 10 that get defs. The 20
`not_carried` columns are **never added** — `EncryptedPatientID` especially (PHI).

- [ ] **Step 1: Widen `REQUEST_COLUMNS`** (`openldr.ts:69-80`)

```ts
const REQUEST_COLUMNS = `
  [RequestID],
  [RequestingFacilityCode], [TestingFacilityCode], [LIMSPointOfCareDesc],
  [LIMSPanelCode], [LIMSPanelDesc],
  [LIMSSpecimenSourceCode], [LIMSSpecimenSourceDesc],
  [SpecimenDateTime], [ReceivedDateTime], [RegisteredDateTime],
  [AnalysisDateTime], [AuthorisedDateTime],
  [ClinicalInfo], [ICD10ClinicalInfoCodes], [Therapy],
  [HL7PriorityCode], [HL7SexCode], [HL7PatientClassCode],
  [HL7SectionCode], [HL7ResultStatusCode],
  [AgeInYears], [AgeInDays],
  [AttendingDoctor], [TestedBy], [AuthorisedBy],
  [OBRSetID], [RequestTypeCode], [LIMSFacilityCode],
  [RegisteredBy], [OrderingNotes], [LIMSAnalyzerCode], [LIMSVendorCode],
  [CollectionVolume], [LIMSRejectionCode], [LIMSRejectionDesc]
`;
```

⚠ **Do NOT add `EncryptedPatientID`** — PHI, `not_carried`. The gate prints values into diff rows and
committed findings docs. Coverage is not a licence to widen a PHI blast radius.

- [ ] **Step 2: Widen `OpenLdrV1Request`** (`openldr.ts:6-42`) — add before `allPanelCodes`:

```ts
  /** HL7 OBR set id. v1's grain is (RequestID, OBRSetID) — ONE ROW PER ORDERED
   *  PANEL. Measured on TDS: 76,002 of 174,261 rows are OBRSetID > 1 (43.6%), and
   *  60,140 of 98,259 requests (61.2%) carry 2+ distinct LIMSPanelCodes.
   *  ⚠ fetchRequestByRequestId returns the LOWEST OBRSetID row (see :110), so this
   *  is always the FIRST OBR — a fact that was implicit and is now visible. */
  OBRSetID: number | null;
  RequestTypeCode: string | null;
  LIMSFacilityCode: string | null;
  RegisteredBy: string | null;
  OrderingNotes: string | null;
  LIMSAnalyzerCode: string | null;
  LIMSVendorCode: string | null;
  CollectionVolume: number | null;
  LIMSRejectionCode: string | null;
  LIMSRejectionDesc: string | null;
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/cli && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Verify the DISA↔v1 gate is unchanged on real data**

```bash
cd apps/cli && node --import tsx src/index.ts compare-batch --limit 20 --summary-only 2> after.json
```
⚠ **This is the regression check.** Widening a SELECT must not change a single comparison. Compare
`per_field` against a run from `git stash`; every field's counts must be **identical** (`elapsed_ms`
will differ — normalise it). **If any count moves, STOP and report** — a wider SELECT changing
results means something reads the row shape, not just named fields.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/openldr.ts
git commit -m "feat(openldr): fetch the 10 Requests columns that get defs

Includes OBRSetID, which makes fetchRequestByRequestId's lowest-OBR choice
visible instead of implicit. EncryptedPatientID is deliberately NOT added: PHI,
not_carried, and the gate prints values into committed findings docs."
```

---

## Task 4: Widen the `LabResults` fetch + row type

**Files:** `apps/cli/src/openldr.ts`

- [ ] **Step 1: Widen `LAB_RESULT_COLUMNS`** (`openldr.ts:215-222`)

```ts
const LAB_RESULT_COLUMNS = `
  lr.[RequestID], lr.[OBRSetID], lr.[OBXSetID], lr.[OBXSubID],
  req.[LIMSPanelCode], req.[LIMSPanelDesc],
  lr.[LIMSObservationCode], lr.[LIMSObservationDesc],
  lr.[LIMSRptResult], lr.[LIMSCodedValue],
  lr.[HL7ResultTypeCode], lr.[HL7AbnormalFlagCodes],
  lr.[LIMSRptRange], lr.[SIValue], lr.[SIUnits],
  lr.[LIMSRptFlag], lr.[LIMSRptUnits],
  lr.[SILoRange], lr.[SIHiRange],
  lr.[CodedValue], lr.[ResultSemiquantitive]
`;
```

⚠ **`CodedValue` and `LIMSCodedValue` are DIFFERENT columns** and both exist. Keep the `lr.` prefix
on every new one — `LIMSPanelCode`/`LIMSPanelDesc` are the only `req.` entries, and that asymmetry is
load-bearing.

- [ ] **Step 2: Widen `OpenLdrV1LabResult`** (`openldr.ts:50-66`):

```ts
  /** v1's LIMS-NATIVE flag. ⚠ NOT the same field as HL7AbnormalFlagCodes: its
   *  value set is L/H/L-/H+ where the HL7 one is N/L/H/LL/HH. Measured on TDS:
   *  8,372 of 643,855 non-empty (1.3%) — L 5,337 / H 2,194 / L- 666 / H+ 145.
   *  Do NOT map one onto the other. */
  LIMSRptFlag: string | null;
  LIMSRptUnits: string | null;
  SILoRange: number | null;
  SIHiRange: number | null;
  /** ⚠ DISTINCT from LIMSCodedValue, which is also fetched. */
  CodedValue: string | null;
  ResultSemiquantitive: number | null;
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/cli && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Verify the result-level gate is unchanged**

```bash
cd apps/cli && node --import tsx src/index.ts compare-batch --limit 20 --summary-only --results 2>&1 >/dev/null | grep -o '"observations":{[^}]*}'
```
Expected: `{"total":143,"match":143,"mismatch":0,"only_disa":0,"only_v1":0}` — **identical to the
pre-task baseline.** ⚠ If it moves, STOP and report.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/openldr.ts
git commit -m "feat(openldr): fetch the 6 LabResults columns that get defs

LIMSRptFlag is a DIFFERENT field from HL7AbnormalFlagCodes (L/H/L-/H+ vs
N/L/H/LL/HH), and CodedValue is distinct from LIMSCodedValue. Both pairs are easy
to conflate and neither may be mapped onto the other."
```

---

## Task 5: The 10 new request-level defs

**Files:** `apps/cli/src/compare/v2-mapping.ts`, `apps/cli/src/compare/v2-mapping.test.ts`

⚠ **Every getV2 below was MEASURED, not guessed.** Asserting "V2 has nothing" for a field that V2
does carry manufactures a defect — that is how `patient_class` nearly sent a fix slice to invent data
v1 never had. Read each comment before changing one.

- [ ] **Step 1: Write the failing tests** — append to `v2-mapping.test.ts`:

```ts
// LIMSFacilityCode DOES have a V2 counterpart and must MATCH. Measured on TDS,
// the four facility columns disambiguate exactly:
//   RequestingFacilityCode 'DISA0JJAA' | TestingFacilityCode 'TDS'
//   LIMSFacilityCode       '0JJAA'     | ReceivingFacilityCode 'TDS'
// i.e. LIMSFacilityCode is RequestingFacilityCode WITHOUT the DISA prefix, and
// equals DISA's own Facility.Code — which is what V2 emits. So this is a def
// expected to be GREEN. If it reds, the bug is here, not in the export.
test("lims_facility_code matches V2's requesting facility concept — no prefix", () => {
  const p = payload({ requesting_facility_code: { concept_code: "0JJAA" } as never });
  assert.equal(statusOf(p, v1({ LIMSFacilityCode: "0JJAA" }), "lims_facility_code"), "match");
});

// THE MULTI-PANEL DEFECT. V2LabRequest has no obr_set_id at all (types.ts:30-57),
// while v2's own contract has it: 02-openldr_external.sql:276 obr_set_id INTEGER
// "HL7 OBR set ID (for multi-panel requests)", UNIQUE (request_id, obr_set_id,
// facility_id), and external-persistence.service.ts:632 defaults it `?? 1`.
// Expected RED on every row.
test("obr_set_id is only_v1 — V2LabRequest has no such field", () => {
  assert.equal(statusOf(payload({}), v1({ OBRSetID: 2 }), "obr_set_id"), "only_v1");
});

// CDR knows a request was REJECTED (result_status: rejection.rejected ? "X" : null,
// v2-transform.ts:350) but carries no code or reason. v1 has both on 4,518 rows
// (2.6%). detectDisaRejection is real logic that has never been graded.
test("rejection_code is only_v1 — CDR drops WHY a request was rejected", () => {
  assert.equal(statusOf(payload({}), v1({ LIMSRejectionCode: "HAEM" }), "rejection_code"), "only_v1");
});

// The '' pair-guard, again, for the new defs: v1 writes '' not NULL for absent
// strings, so an unrejected request must MATCH, not red. Without this, 169,743
// unrejected rows would report as losses.
test("rejection_code vs an EMPTY v1 value is a match", () => {
  assert.equal(statusOf(payload({}), v1({ LIMSRejectionCode: "" }), "rejection_code"), "match");
});

test("registered_by is only_v1 — CDR has no registered_by field", () => {
  assert.equal(statusOf(payload({}), v1({ RegisteredBy: "JDOE" }), "registered_by"), "only_v1");
});
```

- [ ] **Step 2: Run — CONFIRM FAILURE. Paste output.**

Run: `cd apps/cli && node --import tsx --test src/compare/v2-mapping.test.ts`
Expected: FAIL — `no field def named lims_facility_code` (etc.).

- [ ] **Step 3: Add the defs** — append to `V2_REQUEST_FIELDS` in `v2-mapping.ts`:

```ts
  {
    // ⛔ THE MULTI-PANEL DEFECT. v1's grain is (RequestID, OBRSetID) — one row per
    // ORDERED PANEL — and v2 AGREES: 02-openldr_external.sql:276 has
    // `obr_set_id INTEGER -- HL7 OBR set ID (for multi-panel requests)` under
    // UNIQUE (request_id, obr_set_id, facility_id). CDR is the outlier: V2LabRequest
    // has no obr_set_id, toV2 emits ONE record per DISA lab, and
    // external-persistence.service.ts:632 pins it to `?? 1`.
    // Measured: 76,002 of 174,261 rows are OBR > 1 (43.6%); 60,140 of 98,259
    // requests (61.2%) have 2+ distinct panels. Expected RED on every row — that
    // is the finding. The FIX is its own slice, and that slice must emit
    // obr_set_id: emitting one record per panel WITHOUT it is WORSE than the bug,
    // because all panels collide on (request_id, 1, facility_id) and the
    // ON CONFLICT DO UPDATE silently overwrites the last.
    field: "obr_set_id",
    v1Column: "OBRSetID",
    getV2: () => null,
    getV1: (r) => r.OBRSetID,
    comparator: stringCi,
  },
  {
    // MEASURED, and it is GREEN by design — this def exists to PROVE the mapping,
    // not to accuse. The four v1 facility columns disambiguate exactly (TDS):
    //   RequestingFacilityCode 'DISA0JJAA'  TestingFacilityCode   'TDS'
    //   LIMSFacilityCode       '0JJAA'      ReceivingFacilityCode 'TDS'
    // LIMSFacilityCode is RequestingFacilityCode minus v1's "DISA" prefix, and is
    // DISA's own Facility.Code — exactly what V2 emits. So: same concept, compared
    // WITHOUT the prefix strip its sibling needs. If this reds, the bug is here.
    field: "lims_facility_code",
    v1Column: "LIMSFacilityCode",
    getV2: (p) => lr(p).requesting_facility_code?.concept_code ?? null,
    getV1: (r) => r.LIMSFacilityCode,
    comparator: stringCi,
  },
  {
    // ⚠ NOT a duplicate of `priority` — I assumed it was; measurement killed that.
    // They are orthogonal: D x R 154,888 / E x R 19,260 / D x U 87 / E x U 14 /
    // D x S 12. CDR has no counterpart. Expected RED.
    field: "request_type",
    v1Column: "RequestTypeCode",
    getV2: () => null,
    getV1: (r) => r.RequestTypeCode,
    comparator: stringCi,
  },
  {
    // v1 173,915 of 174,261 (99.8%). CDR has no registered_by. Expected RED.
    field: "registered_by",
    v1Column: "RegisteredBy",
    getV2: () => null,
    getV1: (r) => r.RegisteredBy,
    comparator: stringCi,
  },
  {
    // v1 171,670 of 174,261 (98.5%). ⚠ NOT free text — I suspected PHI; measurement
    // killed that: the values are numeric codes ('17', '18', '2421', '06050100').
    // Meaning undocumented. CDR has no counterpart. Expected RED.
    field: "ordering_notes",
    v1Column: "OrderingNotes",
    getV2: () => null,
    getV1: (r) => r.OrderingNotes,
    comparator: stringCi,
  },
  {
    // v1 78,289 of 174,261 (44.9%) — real instrument codes (ALINA, ALINK, 75PCR,
    // MSKAN). Genuine provenance, not noise. CDR has no counterpart. Expected RED.
    field: "analyzer_code",
    v1Column: "LIMSAnalyzerCode",
    getV2: () => null,
    getV1: (r) => r.LIMSAnalyzerCode,
    comparator: stringCi,
  },
  {
    // v1 46,381 of 174,261 (26.6%). CDR has no counterpart. Expected RED.
    field: "vendor_code",
    v1Column: "LIMSVendorCode",
    getV2: () => null,
    getV1: (r) => r.LIMSVendorCode,
    comparator: stringCi,
  },
  {
    // v1 36,374 non-zero of 174,261 (20.9%). ⚠ MEASURED WITH <> 0, not <> '': a
    // numeric 0 casts to '0' and would have read as 100% populated. CDR has no
    // counterpart. Expected RED on the populated rows; the zero rows are v1's
    // "empty" convention (types.ts:160) and score match against CDR's null.
    field: "collection_volume",
    v1Column: "CollectionVolume",
    getV2: () => null,
    getV1: (r) => (r.CollectionVolume === 0 ? null : r.CollectionVolume),
    comparator: stringCi,
  },
  {
    // ⛔ THE HIGHEST-VALUE NEW DEF: real logic, never graded. toV2 DOES detect
    // rejection (detectDisaRejection, v2-transform.ts:669) but carries only the
    // FACT — `result_status: rejection.rejected ? "X" : null` (:350). It drops the
    // CODE and the REASON. v1 has both on 4,518 rows (2.6%). Expected RED there;
    // the other 169,743 are '' and correctly match CDR's null.
    field: "rejection_code",
    v1Column: "LIMSRejectionCode",
    getV2: () => null,
    getV1: (r) => r.LIMSRejectionCode,
    comparator: stringCi,
  },
  {
    field: "rejection_desc",
    v1Column: "LIMSRejectionDesc",
    getV2: () => null,
    getV1: (r) => r.LIMSRejectionDesc,
    comparator: stringCiLoose,
  },
```

- [ ] **Step 4: Run — PASS. Then the full suite.**

```bash
cd apps/cli && node --import tsx --test src/compare/v2-mapping.test.ts
cd apps/cli && node --import tsx --test $(find src -name "*.test.ts" | tr '\n' ' ')
```
Expected: all green; total rises from 173.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/compare/v2-mapping.ts apps/cli/src/compare/v2-mapping.test.ts
git commit -m "feat(compare): 10 new request-level V2<->v1 defs

obr_set_id is the multi-panel defect (61.2% of TDS requests carry 2+ panels);
rejection_code/desc is the highest-value one -- toV2 runs detectDisaRejection and
carries only result_status='X', dropping the code and reason on 4,518 rows.

lims_facility_code is expected GREEN and exists to PROVE the mapping rather than
accuse: measured, LIMSFacilityCode is RequestingFacilityCode minus v1's DISA
prefix and equals DISA's Facility.Code, which is what V2 emits. Asserting a defect
there would have repeated the patient_class mistake."
```

---

## Task 6: The 6 new result-level defs — `rpt_flag` is the acceptance

**Files:** `apps/cli/src/compare/v2-mapping.ts`, `apps/cli/src/compare/v2-result-mapping.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `v2-result-mapping.test.ts`:

```ts
// v2-transform.ts:497 hardcodes `rpt_flag: null` while v1's LIMSRptFlag carries a
// real flag on 8,372 of 643,855 rows (1.3%). A SECOND stub of the same shape as
// abnormal_flag -- but 13x smaller, and on a DIFFERENT value set: L/H/L-/H+ here
// vs N/L/H/LL/HH for the HL7 one. They are different fields; do not map one onto
// the other.
test("ACCEPTANCE: the rpt_flag stub vs a populated v1 LIMSRptFlag reports only_v1", () => {
  assert.equal(fieldStatus({ rpt_flag: null }, { LIMSRptFlag: "L-" }, "rpt_flag"), "only_v1");
});

// The pair-guard. v1 is '' on 635,483 of 643,855 rows -- 98.7%. Without this, the
// test above is satisfied by a comparator that reds every row, and the report
// would claim ~643,855 losses instead of the true ~8,372: a 77x fabrication.
test("PAIR-GUARD: the rpt_flag stub vs an EMPTY v1 flag is a match", () => {
  assert.equal(fieldStatus({ rpt_flag: null }, { LIMSRptFlag: "" }, "rpt_flag"), "match");
});

// CDR emits rpt_units from the codebook; v1 has LIMSRptUnits on 7.1%. Genuinely
// comparable -- this one may well be GREEN.
test("rpt_units compares CDR's codebook units against v1's", () => {
  assert.equal(fieldStatus({ rpt_units: "g/dL" }, { LIMSRptUnits: "g/dL" }, "rpt_units"), "match");
});

// v1 splits the range NUMERICALLY (SILoRange/SIHiRange); CDR emits rpt_range as a
// STRING from the codebook. No V2 counterpart for the numeric halves.
test("si_lo_range is only_v1 — CDR has no numeric range field", () => {
  assert.equal(fieldStatus({}, { SILoRange: 3.5 }, "si_lo_range"), "only_v1");
});

// A numeric 0 is v1's EMPTY convention, not a value (types.ts:160). Without this,
// 611,191 zero rows would report as losses.
test("si_lo_range vs v1's zero is a match — 0 is v1's empty for numerics", () => {
  assert.equal(fieldStatus({}, { SILoRange: 0 }, "si_lo_range"), "match");
});
```

- [ ] **Step 2: Run — CONFIRM FAILURE. Paste output.**

- [ ] **Step 3: Add the defs** — append to `V2_RESULT_FIELDS`:

```ts
  {
    // ★ v2-transform.ts:497 hardcodes `rpt_flag: null`. v1's LIMSRptFlag: 8,372 of
    // 643,855 non-empty (1.3%) — L 5,337 / H 2,194 / L- 666 / H+ 145.
    // ⚠ A DIFFERENT FIELD from HL7AbnormalFlagCodes (N/L/H/LL/HH): these are the
    // LIMS-native and HL7-normalised flags. Do NOT map one onto the other.
    // ⚠ Expect ~8,372 red, NOT ~107,602 (that would mean it was mapped onto
    // abnormal_flag) and NOT ~643,855 (the ''-empty rule broken).
    field: "rpt_flag",
    v1Column: "LIMSRptFlag",
    getV2: (r) => r.rpt_flag,
    getV1: (r) => r.LIMSRptFlag,
    comparator: stringCi,
  },
  {
    // v1 45,461 of 643,855 (7.1%). CDR emits rpt_units from the codebook
    // (v2-transform.ts:497 `rpt_units: nz(parm?.units ?? null)`), so this is a real
    // two-sided comparison and may be GREEN.
    field: "rpt_units",
    v1Column: "LIMSRptUnits",
    getV2: (r) => r.rpt_units,
    getV1: (r) => r.LIMSRptUnits,
    comparator: stringCiLoose,
  },
  {
    // v1 32,664 non-zero of 643,855 (5.1%). v1 splits the reference range into
    // NUMERIC lo/hi; CDR emits rpt_range as a STRING from the codebook. No V2
    // counterpart for the numeric halves. ⚠ 0 is v1's empty convention for
    // numerics (types.ts:160) — mapping it to null keeps 611,191 rows from
    // reporting as losses.
    field: "si_lo_range",
    v1Column: "SILoRange",
    getV2: () => null,
    getV1: (r) => (r.SILoRange === 0 ? null : r.SILoRange),
    comparator: stringCi,
  },
  {
    // v1 50,761 non-zero of 643,855 (7.9%). Same shape as si_lo_range.
    field: "si_hi_range",
    v1Column: "SIHiRange",
    getV2: () => null,
    getV1: (r) => (r.SIHiRange === 0 ? null : r.SIHiRange),
    comparator: stringCi,
  },
  {
    // ⚠ DISTINCT from LIMSCodedValue, which is already graded as `coded_value`.
    // v1 49,410 of 643,855 (7.7%). No known V2 counterpart — CDR's coded_value maps
    // to LIMSCodedValue. Expected RED; if the report shows this tracking
    // coded_value exactly, that is evidence they are the same concept and the
    // mapping needs revisiting.
    field: "si_coded_value",
    v1Column: "CodedValue",
    getV2: () => null,
    getV1: (r) => r.CodedValue,
    comparator: stringCi,
  },
  {
    // v1 49,409 non-zero of 643,855 (7.7%) — -1 x 37,185 / 1 x 12,205 / 3 x 10 /
    // 2 x 9. It tracks CodedValue's 49,410 almost exactly, which SUGGESTS a
    // qualifier ('<' / '>'), but that is a HYPOTHESIS, not a mapping.
    // ⚠ Do NOT map it to a V2 field on the strength of that correlation — measure
    // first. Graded against null so the report shows its true size.
    field: "result_semiquantitive",
    v1Column: "ResultSemiquantitive",
    getV2: () => null,
    getV1: (r) => (r.ResultSemiquantitive === 0 ? null : r.ResultSemiquantitive),
    comparator: stringCi,
  },
```

- [ ] **Step 4: Run — PASS. Then the full suite + the coverage guard.**

```bash
cd apps/cli && node --import tsx --test $(find src -name "*.test.ts" | tr '\n' ' ')
```
Expected: **all green, including `v1-coverage.test.ts`** — this is the moment the guard goes from RED
to GREEN, and the count is now honest: **60 of 60** and **28 of 28**.

⚠ **If the coverage guard still lists uncovered columns, STOP and report the names.** Do not add them
to `not_carried` to make it pass — that is a decision, and it is not yours.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/compare/
git commit -m "feat(compare): 6 new result-level defs — coverage guard GREEN at 60/60 and 28/28

rpt_flag is a second hardcoded stub (v2-transform.ts:497) against v1's 8,372 real
flags -- a DIFFERENT field from abnormal_flag (L/H/L-/H+ vs N/L/H/LL/HH), so the
two must never be mapped onto each other.

The guard now grades v1's real 60/28 columns instead of the 26/13 our SELECT
happened to fetch."
```

---

## Task 7: Run at scale — the honest inventory

**No production code. This is the deliverable.**

- [ ] **Step 1: Retire the old type-based guard**

Delete the two superseded tests from `v2-mapping.test.ts` (`"every v1 request column has a field def,
an exception, or is bookkeeping"` and `"the coverage list matches the def/exception tables — no
phantom columns"`) and the hand-maintained `V1_REQUEST_COLUMNS` literal above them. They assert over
the TS type — **the exact 43% blind spot this slice removed** — and leaving them in means two guards
disagreeing about what "covered" means.

⚠ Keep the phantom check in spirit: `v1-coverage.test.ts`'s `"no v1 column is in two buckets"` and the
snapshot-based coverage tests already subsume it.

- [ ] **Step 2: Run a large batch**

```bash
cd apps/cli && node --import tsx src/index.ts compare-batch --limit 500 --v2 --results --summary-only --country tanzania 2> batch-summary.json
```
⚠ Adjust `--limit` to what completes in reasonable time and **report the number used** — a sample size
is part of the finding. ⚠ **Report the `--country` used**: without it the doc-panel set is empty and
you are grading a different payload.

- [ ] **Step 3: Check the numbers that falsify the work**

| field | expected | if it differs |
|---|---|---|
| `rpt_flag` | ~1.3% red | ~16.7% ⇒ mapped onto `abnormal_flag`. ~98.7% ⇒ the `''` rule is broken. **Gate bug, not a finding.** |
| `abnormal_flag` | ~16.7% red | ~100% ⇒ the `''` rule is broken |
| `patient_class` | **match** | red ⇒ the `''` rule is broken. **Do NOT report it as an export defect.** |
| `lims_facility_code` | **match** | red ⇒ the facility mapping is wrong **here**, not in the export |
| `obr_set_id` | **100% only_v1** | anything else ⇒ the def is not reading the payload |

- [ ] **Step 4: Write the findings up**

Create `docs/superpowers/specs/2026-07-17-mapping-gate-findings.md` in `openldr_ce`. Per field:
match / mismatch / only_v2 / only_v1, and where a mismatch is systematic, **the observed rule**.

**Separate the report into three sections — collapsing them is how `patient_class` nearly became a
fix slice for data v1 never had:**
1. **Real export defects** — `abnormal_flag`, `rpt_flag`, `result_type`, `analysis_at`,
   `result_status`, `tested_by`, `authorised_by`, `rejection_code`/`desc`, `obr_set_id`.
2. **Expected green (mapping proofs)** — `patient_class`, `lims_facility_code`. Green here is a
   RESULT, not an absence of one.
3. **Not carried / not fetched** — the 25 columns, and the standing caveat that **TDS is 1 site of
   22**.

⚠ **State the coverage honestly:** the guard now covers **60/60 and 28/28**, but **only for TDS**.
⚠ **State what this run CANNOT see:** typed patient identifiers (DISA `NID` is 0/40 — only a registry
site exercises them), and anything `not_carried`.

- [ ] **Step 5: Report `collected_datetime ↔ SpecimenDateTime`**

The 20-lab sample showed **2 match / 18 only_v1** against a prediction of ~97%. **Report the rate at
scale.** ⚠ **If it holds at ~10%, the D4 prediction is FALSIFIED and the fix slice follows the data,
not the plan.**

- [ ] **Step 6: Commit the findings** (in `openldr_ce`).

⚠ **Do NOT fix anything.** Each fix is its own slice, justified by this report.

---

## Self-Review

**Spec coverage:** §1→T1+T2+T7. §2 (RULE 0)→the measurements are embedded in every def comment.
§3.1→T3+T5. §3.1b/c/d (`not_carried`)→T2. §3.2 (`measured_empty` empty)→T2 Step 1. §3.3→T4+T6.
§4 (multi-panel)→T5's `obr_set_id`. §5.1→T3+T4. §5.2 (snapshot)→T1. §5.3 (five buckets)→T2.
§5.4→T5+T6. §6 (PHI)→T3 Step 1's explicit exclusion. §8 acceptance→T6 Step 4 + T7 Step 3.
§9 decisions→T2's tables carry decider+date. §10 follow-ups→**deliberately not implemented**.

**Deliberately NOT in this plan:**
- **Patient identity** — deferred to last by decision; `patient_guid = requestId` is SETTLED
  (commercial blocker). §10.1 stays a spec note.
- **Typed identifiers** — a CE **ingest-contract** concern, not a CDR one. DISA has no identifier to
  carry (`NID` 0/40), so it changes nothing here. Belongs with [[fhir-bundle-wire-contract]].
- **`obr_set_id` on `V2LabRequest`** — T5 MEASURES it; the fix is its own slice.

**Test-free tasks, deliberately:** T7 (the measurement run is the deliverable).

⚠ **Known weakness, stated rather than hidden:** the snapshot is generated from **TDS**. If another
country's v1 has a different schema, the guard passes here and is wrong there. The count assertion
catches a *truncated regeneration*, **not a genuinely different deployment**. Nobody has checked
whether Zambia's v1 has 60 columns — **that is a real open question, not a rhetorical one.**
