# Observation Timestamps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `Observation.effectiveDateTime` (collection time) and `Observation.issued` (release time) so `lab_results.result_timestamp` stops being NULL on 100% of rows, and fix the two AMR queries that silently return zero rows for any date range.

**Architecture:** `cdr-toolchain` un-stubs `V2Result.result_timestamp` from `DisaObs.datestamp` (already in scope) and re-points it to `Observation.issued`; `effectiveDateTime` gets the collection time via the same expression `fhir-transform.ts:184` already uses for `DiagnosticReport`. `openldr_ce` adds an additive `lab_results.issued` column and gives all five AMR queries one shared coalesce chain with a fail-open null escape.

**Tech Stack:** TypeScript. `cdr-toolchain` tests = **`node:test`** (NOT vitest). `openldr_ce` tests = **vitest**. Kysely migrations.

**Spec:** `docs/superpowers/specs/2026-07-17-observation-timestamps-design.md` (`b103766a`)

---

## ⛔ AMENDED 2026-07-17 MID-EXECUTION — `issued` IS DROPPED. READ THIS FIRST.

**Spec D1 (`issued ← TESTDATA.DATESTAMP`) was FALSIFIED by measurement.** ~37% of `DATESTAMP`s are
**bulk-load/migration artifacts**, not release times: **44,625 rows in a 3-HOUR window** on
2016-03-08 (~860× the ~52/day average); **71,247 of 191,121** across 3 such days. The live Candida
record `TZDISATDS0013541` is on that spike — registered 2013-10-04, `DATESTAMP` 2016-03-08. Full
evidence: **spec §0.0**.

**User decision: *"drop issued from the slice, effectiveDateTime only"*.**

### Revised task list — supersedes everything below

| task | status |
|---|---|
| **T1** `disaDatestampToIso` | ✅ **DONE + APPROVED** (`4aca20f2`, `0cd9b7cd`). **KEPT** though now consumer-less (user decision). |
| **T2** un-stub `result_timestamp` | ✅ **DONE + APPROVED** (`a58b8c31`). **KEPT.** ⚠ Until T4 lands, `effectiveDateTime` = `DATESTAMP` = the migration stamp — **T4 is what makes the branch correct again.** |
| **T3** `fhirInstant` | ⛔ **CANCELLED** — existed only to guard `issued`. |
| **T4** map the times | ⚠ **REDUCED** — `effectiveDateTime` ← collection ONLY. **Do NOT add an `issued` mapping.** |
| **T5** `lab_results.issued` migration | ⛔ **CANCELLED.** |
| **T6** project `issued` | ⛔ **CANCELLED.** |
| **T7** the chain | ⚠ **REDUCED** — chain is `coalesce(result_timestamp, s.received_time)`, which the **3 working queries ALREADY have** ⇒ they are **UNCHANGED**. Only the **2 broken** queries change (12 predicates + 6 new specimen joins). **The 36 coalesce edits are CANCELLED.** |
| **T8** live verification | ⚠ **REDUCED** — verify `has_effective` only; there is no `issued` column. |

⚠ **Naming trap:** the V2 payload's `V2Result.result_timestamp` and CE's `lab_results.result_timestamp`
column are **different things that share a name**. The CE column reads `Observation.effectiveDateTime`
(`relational/observation.ts:28`); after T4 it holds the **collection** time. The V2 field holds
`DATESTAMP` and, after T4, has **no reader**.

---

## ⚠ Read before Task 1

1. **DISA stores BLOBS, not columns.** Never verify a DISA fact with `select count(col)`. See
   `docs/superpowers/specs/2026-07-17-observation-timestamps-design.md` §3.1.
2. **The five `amr-*-parity.test.ts` files pin NOTHING** — all are `it.skip` + `expect(true).toBe(true)`.
   **Do not "update" them.** Treat the AMR SQL as untested.
3. **Two repos.** Tasks 1–4 are `D:\Projects\Repositories\cdr-toolchain`. Tasks 5–8 are
   `D:\Projects\Repositories\openldr_ce`. **Commit in each repo separately.**
4. **`pnpm dev -- <cmd>` breaks commander.** Use `node --import tsx src/index.ts <cmd>`.

---

## File Structure

**cdr-toolchain**
- Modify: `apps/cli/src/export/v2-transform.ts` — add `disaDatestampToIso`; un-stub `:499`
- Modify: `apps/cli/src/export/fhir-primitives.ts` — add `fhirInstant`
- Modify: `apps/cli/src/export/fhir-transform.ts` — thread collection time; re-point `:244`
- Create: `apps/cli/src/export/v2-transform-datestamp.test.ts`
- Create: `apps/cli/src/export/fhir-transform-timestamps.test.ts`
- Modify: `apps/cli/src/export/fhir-primitives.test.ts`

**openldr_ce**
- Create: `packages/db/src/migrations/external/009_lab_results_issued.ts`
- Modify: `packages/db/src/migrations/external/index.ts`
- Modify: `packages/db/src/schema/external.ts:38-54` (`LabResultsTable`)
- Modify: `packages/db/src/relational/observation.ts`
- Modify: `packages/reporting/src/seed/report-seeds.ts` (**15 SQL strings, 48 sites**)
- Create: `packages/db/src/relational/observation-issued.test.ts`

---

## Task 1: `disaDatestampToIso` — the timezone-safe extractor

**Repo:** `cdr-toolchain`

**Files:**
- Modify: `apps/cli/src/export/v2-transform.ts` (add next to `disaToIso`, `:42-50`)
- Test: `apps/cli/src/export/v2-transform-datestamp.test.ts` (create)

**Why this is its own task:** this is the single highest-risk line in the slice. It was **measured**
against live DISA, not reasoned:

```
SQL ground truth : 2019-01-23 15:56:42.257
toISOString()    : 2019-01-23T15:56:42.257Z   <- digits right, labelled UTC = WRONG
getUTC* components: 2019-01-23T15:56:42       <- matches ground truth ✓
getLocal* comps  : 2019-01-23T18:56:42        <- shifted +3 = WRONG
host TZ offset   : -180  (the dev laptop is UTC+3)
```

**The trap:** local getters would look *correct on this laptop* (it is UTC+3) and break on CI or any
other machine.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/src/export/v2-transform-datestamp.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { disaDatestampToIso } from "./v2-transform.js";

// Measured against DisalabData.TESTDATA: SQL `2019-01-23 15:56:42.257` is read by
// mssql/tedious (useUTC = its default) into a Date whose UTC components ARE the
// wall-clock digits DISA stored. We must return those digits, UNZONED.
test("disaDatestampToIso returns the stored wall-clock, unzoned", () => {
  const d = new Date(Date.UTC(2019, 0, 23, 15, 56, 42, 257));
  assert.equal(disaDatestampToIso(d), "2019-01-23T15:56:42");
});

// MUTATION GUARD: a full toISOString() returns "...42.257Z". fhirDateTime treats an
// already-zoned value as passthrough, so the `Z` would survive and silently declare
// Tanzania local time to be UTC — shifting every timestamp by the deployment offset.
test("disaDatestampToIso never emits a zone suffix", () => {
  const d = new Date(Date.UTC(2019, 0, 23, 15, 56, 42, 257));
  const out = disaDatestampToIso(d);
  assert.equal(out?.endsWith("Z"), false);
  assert.equal(/[+-]\d{2}:\d{2}$/.test(out ?? ""), false);
});

test("disaDatestampToIso returns null for null and for an invalid Date", () => {
  assert.equal(disaDatestampToIso(null), null);
  assert.equal(disaDatestampToIso(new Date(Number.NaN)), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:/Projects/Repositories/cdr-toolchain/apps/cli && node --import tsx --test src/export/v2-transform-datestamp.test.ts`
Expected: FAIL — `disaDatestampToIso is not a function` / not exported.

- [ ] **Step 3: Write the implementation**

In `apps/cli/src/export/v2-transform.ts`, immediately after `disaToIso` (which ends at `:50`):

```ts
/** TESTDATA.DATESTAMP reaches us as a JS Date: mssql/tedious builds it with
 *  `useUTC` (its default), so the Date's **UTC components are the wall-clock
 *  digits DISA stored** — DISA keeps unzoned local time. Measured against
 *  DisalabData.TESTDATA: SQL `2019-01-23 15:56:42.257` → getUTC* →
 *  `2019-01-23T15:56:42` (ground truth), while local getters gave `18:56:42`
 *  on a UTC+3 host.
 *
 *  Returns UNZONED wall-clock for `fhirDateTime` to stamp with the deployment
 *  offset (`OPENLDR_CE_TIMEZONE`).
 *
 *  Do NOT return the full `toISOString()`: its trailing `Z` makes fhirDateTime
 *  treat the value as already-zoned UTC and pass it through, silently shifting
 *  every clinical timestamp by the offset. Do NOT use local getters: they
 *  depend on the host TZ and would LOOK correct on a UTC+3 dev machine. */
export function disaDatestampToIso(d: Date | null): string | null {
  if (d === null || Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cli && node --import tsx --test src/export/v2-transform-datestamp.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd D:/Projects/Repositories/cdr-toolchain
git add apps/cli/src/export/v2-transform.ts apps/cli/src/export/v2-transform-datestamp.test.ts
git commit -m "feat(export): add disaDatestampToIso — timezone-safe DATESTAMP extraction"
```

---

## Task 2: Un-stub `V2Result.result_timestamp`

**Repo:** `cdr-toolchain`

**Files:**
- Modify: `apps/cli/src/export/v2-transform.ts:499`
- Test: `apps/cli/src/export/v2-transform-datestamp.test.ts` (extend)

**Context:** `buildLabResults(obs, codebook, site, isolates)` (`:416-421`) iterates `DisaObs[]` as `o`.
`DisaObs.datestamp: Date | null` **is already in scope** (`compare/result-mapping.ts:16`), populated
by `flattenDisa` via `coerceDatestamp(test.DATESTAMP)` (`compare/result-mapping.ts:574`).
`buildLabResults` is **private** — test through the public `toV2` (`v2-transform.ts:660`).

> ### ⚠ THIS TASK'S TEST INHERITS A DEFECT FOUND IN TASK 1 — READ FIRST
>
> The test below feeds `Date.UTC(...)` through `toV2` and asserts **those same digits**. That means a
> `getFullYear()/getHours()`-based (local-getters) implementation **passes on a UTC host** — the
> assertion cannot distinguish correct from broken unless the host is non-UTC. Task 1 shipped exactly
> this bug and it was caught only by *building the mutant*, not by reading.
>
> **Task 1's test file already pins `TZ` (commit `0cd9b7cd`)** — `process.env.TZ = 'Africa/Dar_es_Salaam'`
> (no DST ⇒ constant `-180`), plus a **loud** `TZ pin took effect` test asserting
> `getTimezoneOffset() === -180` so the suite fails rather than silently un-guarding.
>
> **You are appending to that same file, so you inherit the pin — but you MUST prove it covers your
> new test too:** introduce a local-getters mutant, show your test goes **RED under `TZ=UTC`**, revert,
> show GREEN. **Do not report this as done on a reasoned argument.** *(Note: an assertion that
> distinguishes UTC from local components on **every** host is impossible — on a UTC host they are
> identical for every input. Pinning is the only mechanism.)*

- [ ] **Step 1: Write the failing test**

Append to `apps/cli/src/export/v2-transform-datestamp.test.ts`. **Model the fixture on
`apps/cli/src/export/v2-transform-exclude.test.ts`** — read its `specimenFixture()` header comment
first; it documents exactly what `flattenDisa` reads (`.TESTCODE`, `.TESTINDEX`, `.DATESTAMP`,
`.ORDER[i].{Code,Type,Value,RawValue,IsResulted,Description}`).

```ts
import type { SpecimenRecpt } from "disalab";
import { toV2 } from "./v2-transform.js";
import { DEFAULT_SITE } from "./site-config.js";
import { stubCodebook } from "../test-helpers/stub-codebook.js";

function specimenWithDatestamp(datestamp: Date | null): SpecimenRecpt {
  const numericType = String.fromCharCode(1); // Real — passes the structural filters
  return {
    LabNo: "TDS0000001",
    TestResults: [
      {
        TESTCODE: "HIVVL",
        TESTINDEX: 1,
        DATESTAMP: datestamp,
        ORDER: [
          { Code: "HIVVC", Type: numericType, Value: "50", RawValue: "", IsResulted: true, Description: "HIV VL" },
        ],
      },
    ],
  } as unknown as SpecimenRecpt;
}

test("result_timestamp carries the panel's DATESTAMP as unzoned wall-clock", () => {
  const payload = toV2(specimenWithDatestamp(new Date(Date.UTC(2019, 0, 23, 15, 56, 42))), {
    codebook: stubCodebook(), site: DEFAULT_SITE,
  });
  assert.equal(payload.lab_results.length, 1);
  // MUTATION GUARD: the pre-fix stub returned null, so this equality (not a
  // truthiness check) is what pins the fix.
  assert.equal(payload.lab_results[0]!.result_timestamp, "2019-01-23T15:56:42");
});

test("result_timestamp is null when the panel carried no DATESTAMP", () => {
  const payload = toV2(specimenWithDatestamp(null), { codebook: stubCodebook(), site: DEFAULT_SITE });
  assert.equal(payload.lab_results[0]!.result_timestamp, null);
});
```

> **SKETCH — verify before running:** `toV2`'s `ToV2Opts` (`v2-transform.ts:617`) and
> `stubCodebook`'s signature. Copy the exact construction from
> `v2-transform-exclude.test.ts`'s own `toV2(...)` call rather than trusting the shape above.
> If `DEFAULT_SITE` is not exported from `./site-config.js`, take whatever that test imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && node --import tsx --test src/export/v2-transform-datestamp.test.ts`
Expected: FAIL — `expected '2019-01-23T15:56:42', got null` (the stub).

- [ ] **Step 3: Write the implementation**

In `apps/cli/src/export/v2-transform.ts`, replace the stub at `:499`:

```ts
      result_timestamp: null,
```
with:
```ts
      // Un-stubbed: the panel iteration's TESTDATA.DATESTAMP. This is a RELEASE
      // time, so fhir-transform maps it to Observation.issued (NOT
      // effectiveDateTime, which is the collection time — see R4).
      result_timestamp: disaDatestampToIso(o.datestamp),
```

**Do not touch `abnormal_flag: null` on `:496`** — it is a separate stub, out of scope (spec §7).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cli && node --import tsx --test src/export/v2-transform-datestamp.test.ts`
Expected: PASS.

Then the full suite: `cd apps/cli && node --import tsx --test "src/export/*.test.ts"`
Expected: PASS. ⚠ If a compare/audit test breaks, **stop and report** — `result_timestamp` may have
been relied upon as always-null.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/export/v2-transform.ts apps/cli/src/export/v2-transform-datestamp.test.ts
git commit -m "fix(export): un-stub result_timestamp from TESTDATA.DATESTAMP"
```

---

## Task 3: `fhirInstant` — refuse to emit a partial `issued`

**Repo:** `cdr-toolchain`

**Files:**
- Modify: `apps/cli/src/export/fhir-primitives.ts` (add after `fhirDateTime`, which ends ~`:95`)
- Test: `apps/cli/src/export/fhir-primitives.test.ts`

**Why:** CE types `Observation.issued` as `fhirInstant` (`packages/fhir/src/resources/observation.ts:28`),
whose `INSTANT_RE` (`packages/fhir/src/datatypes/primitives.ts:7`) demands a **fully zoned**
timestamp. `fhirDateTime` happily returns date-only for a timeless source — and CE would then
**reject the entire resource**, not just the field.

- [ ] **Step 1: Write the failing test**

Append to `apps/cli/src/export/fhir-primitives.test.ts`:

```ts
import { fhirInstant } from "./fhir-primitives.js";

test("fhirInstant stamps the offset onto unzoned wall-clock", () => {
  assert.equal(fhirInstant("2019-01-23T15:56:42", "+03:00"), "2019-01-23T15:56:42+03:00");
});

// MUTATION GUARD: this is the whole point of the helper. `fhirDateTime` would
// return "2019-01-23" here; CE's fhirInstant would reject the WHOLE resource.
test("fhirInstant OMITS a date-only value rather than emitting a partial instant", () => {
  assert.equal(fhirInstant("2019-01-23", "+03:00"), undefined);
});

test("fhirInstant passes an already-zoned instant through", () => {
  assert.equal(fhirInstant("2019-01-23T15:56:42Z", "+03:00"), "2019-01-23T15:56:42Z");
});

test("fhirInstant returns undefined for null/empty", () => {
  assert.equal(fhirInstant(null, "+03:00"), undefined);
  assert.equal(fhirInstant("", "+03:00"), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && node --import tsx --test src/export/fhir-primitives.test.ts`
Expected: FAIL — `fhirInstant is not a function`.

- [ ] **Step 3: Write the implementation**

In `apps/cli/src/export/fhir-primitives.ts`, after `fhirDateTime`:

```ts
/** FHIR `instant` — a FULLY ZONED timestamp. CE types Observation.issued as
 *  fhirInstant (packages/fhir/src/resources/observation.ts:28) and its
 *  INSTANT_RE rejects date-only, which would fail validation for the ENTIRE
 *  resource — not just this field. So when we only know a date, emit nothing.
 *  Built on fhirDateTime so the zone-stamping rule lives in exactly one place. */
export function fhirInstant(
  raw: string | null | undefined,
  tzOffset: string,
): string | undefined {
  const dt = fhirDateTime(raw, tzOffset);
  if (dt === undefined) return undefined;
  return INSTANT_RE.test(dt) ? dt : undefined;
}
```

If `INSTANT_RE` is not already declared in this file, add it beside the other regexes:

```ts
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
```

> **SKETCH — verify:** `fhirDateTime` already contains this exact regex inline (its "Already zoned"
> branch). **Extract it to a shared `const` rather than writing a second copy** — two copies of a
> validation regex is how they drift.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cli && node --import tsx --test src/export/fhir-primitives.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/export/fhir-primitives.ts apps/cli/src/export/fhir-primitives.test.ts
git commit -m "feat(export): add fhirInstant — omit rather than emit a partial instant"
```

---

## Task 4: Map `effectiveDateTime` (collection) + `issued` (release)

**Repo:** `cdr-toolchain`

**Files:**
- Modify: `apps/cli/src/export/fhir-transform.ts` — `observationResource` (`:211-214` signature,
  `:244` the bug) and its call site (`:339-341`)
- Test: `apps/cli/src/export/fhir-transform-timestamps.test.ts` (create)

**The bug:** `:244` is `effectiveDateTime: fhirDateTime(r.result_timestamp, opts.tzOffset)` — it puts
the **result** time into the **collection** field. Per R4, `effective[x]` is the *"physiologically
relevant time… the time of the procedure or of specimen collection"*; `issued` is when the result
*"was made available to providers"*.

**The fix already exists in this file:** `:184` uses `lr.taken_datetime ?? lr.collected_datetime` for
`DiagnosticReport.effectiveDateTime`. **Reuse that expression — do not invent a second rule.**

**Plumbing:** `observationResource(r, patientRef, rootId, specimenId, index, opts)` does not receive
the request. The call site (`:339-341`) has `payload.lab_request` in scope. This file states its own
idiom at `:334-337`: *"Derived once here and threaded through every builder… so the logic lives in
exactly one place and cannot drift."* **Follow it: derive `collectedAt` once beside `specimenId`.**

- [ ] **Step 1: Write the failing test**

Create `apps/cli/src/export/fhir-transform-timestamps.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { toFhir } from "./fhir-transform.js";

// Model the payload on the existing fixtures in fhir-transform.test.ts.
function payloadWith(takenDatetime: string | null, resultTimestamp: string | null) {
  return {
    lab_request: {
      request_id: "TDS0000001",
      taken_datetime: takenDatetime,
      collected_datetime: null,
      received_at: null,
    },
    patient: { patient_guid: "TDS0000001" },
    specimen: {},
    lab_results: [
      { observation_code: { code: "HIVVC" }, result_timestamp: resultTimestamp,
        numeric_value: 50, result_value: "50", text_value: null, coded_value: null,
        numeric_units: null, abnormal_flag: null, rpt_units: null, rpt_range: null,
        isolate_index: null, is_resulted: true, raw_result: {} },
    ],
    isolates: [],
  };
}

function observationOf(resources: unknown[]) {
  return resources.find(
    (x) => (x as { resourceType?: string; id?: string }).resourceType === "Observation" &&
           String((x as { id?: string }).id).includes("-obs-"),
  ) as Record<string, unknown>;
}

test("effectiveDateTime is the COLLECTION time, not the result time", () => {
  const out = toFhir(payloadWith("2019-01-20T08:00:00", "2019-01-23T15:56:42"), { tzOffset: "+03:00" });
  const obs = observationOf(out);
  // MUTATION GUARD: the pre-fix code returns the RESULT time here. Equality
  // against the COLLECTION value is what makes that regression red.
  assert.equal(obs["effectiveDateTime"], "2019-01-20T08:00:00+03:00");
});

test("issued is the RELEASE time (the panel DATESTAMP)", () => {
  const out = toFhir(payloadWith("2019-01-20T08:00:00", "2019-01-23T15:56:42"), { tzOffset: "+03:00" });
  assert.equal(observationOf(out)["issued"], "2019-01-23T15:56:42+03:00");
});

// The RTKNIDX5.TAKENDATE fallback is date-only (midnight). fhirDateTime accepts
// date-only; we must NOT fabricate a collection time we never had.
test("a date-only taken date stays date-only — no fabricated midnight", () => {
  const out = toFhir(payloadWith("2019-01-20", "2019-01-23T15:56:42"), { tzOffset: "+03:00" });
  assert.equal(observationOf(out)["effectiveDateTime"], "2019-01-20");
});

// CE types issued as fhirInstant; a date-only value would fail validation for
// the WHOLE resource.
test("a date-only DATESTAMP omits issued entirely", () => {
  const out = toFhir(payloadWith("2019-01-20T08:00:00", "2019-01-23"), { tzOffset: "+03:00" });
  assert.equal("issued" in observationOf(out), false);
});

test("no collection time omits effectiveDateTime rather than falling back to issued", () => {
  const out = toFhir(payloadWith(null, "2019-01-23T15:56:42"), { tzOffset: "+03:00" });
  assert.equal("effectiveDateTime" in observationOf(out), false);
});
```

> **SKETCH — verify before running:** `toFhir`'s exported name, its options type (`ToFhirOptions`),
> and the exact `V2Payload` field names. **Copy a working payload fixture from
> `apps/cli/src/export/fhir-transform.test.ts`** and edit the timestamps, rather than trusting the
> literal above.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && node --import tsx --test src/export/fhir-transform-timestamps.test.ts`
Expected: FAIL — `effectiveDateTime` is `"2019-01-23T15:56:42+03:00"` (the **result** time), and
`issued` is absent.

- [ ] **Step 3: Write the implementation**

**(a)** Widen the signature (`:211-214`):

```ts
function observationResource(
  r: V2LabResult, patientRef: string, rootId: string, specimenId: string | undefined,
  index: number, opts: ToFhirOptions, collectedAt: string | null,
): FhirResource {
```

**(b)** Replace `:244`:

```ts
    effectiveDateTime: fhirDateTime(r.result_timestamp, opts.tzOffset),
```
with:
```ts
    // R4: effective[x] is the "physiologically relevant time ... the time of the
    // procedure or of specimen collection" — NOT when the result was produced.
    // `issued` is when the result "was made available to providers". The old code
    // put result_timestamp in effectiveDateTime, conflating the two.
    effectiveDateTime: fhirDateTime(collectedAt, opts.tzOffset),
    // result_timestamp is TESTDATA.DATESTAMP — a RELEASE time. fhirInstant omits
    // a date-only value: CE types issued as fhirInstant and would otherwise
    // reject the whole resource.
    issued: fhirInstant(r.result_timestamp, opts.tzOffset),
```

Add `fhirInstant` to the existing import from `./fhir-primitives.js`.

**(c)** Derive once at the call site, beside `specimenId` (`:337`), following this file's stated
idiom:

```ts
  const specimenId = fhirId(`${rootId}-spec`);
  // Same expression as requestResources' DiagnosticReport.effectiveDateTime
  // (:184) — derived once so the collection-time rule cannot drift between
  // the report and its observations.
  const collectedAt = payload.lab_request.taken_datetime ?? payload.lab_request.collected_datetime;

  const observations = payload.lab_results.map((r, i) =>
    observationResource(r, patientRef, rootId, specimenId, i + 1, opts, collectedAt),
  );
```

> ⚠ **Check `isolateResource` / `astResource` too.** If either sets `effectiveDateTime` from
> `result_timestamp`, it has the identical bug and must get `collectedAt` as well. **Grep
> `effectiveDateTime` across this file before declaring the task done** — the spec counted the
> Observation builder only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/cli && node --import tsx --test src/export/fhir-transform-timestamps.test.ts`
Expected: PASS (5 tests).

Run the conformance gate:
`cd apps/cli && FHIR_CONFORMANCE=1 node --import tsx --test src/export/fhir-conformance.test.ts`
Expected: PASS.

Run the whole export suite: `cd apps/cli && node --import tsx --test "src/export/*.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/export/fhir-transform.ts apps/cli/src/export/fhir-transform-timestamps.test.ts
git commit -m "fix(export): effectiveDateTime = collection time; issued = release time"
```

---

## Task 5: `lab_results.issued` — migration

**Repo:** `openldr_ce`

**Files:**
- Create: `packages/db/src/migrations/external/009_lab_results_issued.ts`
- Modify: `packages/db/src/migrations/external/index.ts`

**Pattern:** copy `002_specimen_origin.ts` exactly — it is the same shape (one nullable text column).

- [ ] **Step 1: Write the migration**

Create `packages/db/src/migrations/external/009_lab_results_issued.ts`:

```ts
import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType } from './dialect';

// Observation.issued — when the result was released (R4: "made available to
// providers, typically after the results have been reviewed and verified").
// Distinct from result_timestamp, which reads Observation.effectiveDateTime =
// the COLLECTION time. Additive: result_timestamp is unchanged because the
// external warehouse is a public surface with no deprecation mechanism.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  await db.schema.alterTable('lab_results').addColumn('issued', sql.raw(textType(engine))).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('lab_results').dropColumn('issued').execute();
}
```

- [ ] **Step 2: Register it**

In `packages/db/src/migrations/external/index.ts`, add the import after `m008`:

```ts
import * as m009 from './009_lab_results_issued';
```

and the entry after `'008_patients_merge'`:

```ts
    '009_lab_results_issued': { up: (db) => m009.up(db, engine), down: m009.down },
```

- [ ] **Step 3: Add the column to the shared type**

In `packages/db/src/schema/external.ts`, add to `LabResultsTable` (currently `:38-54`), after
`result_timestamp`:

```ts
  result_timestamp: string | null;
  issued: string | null;
```

- [ ] **Step 4: Typecheck EVERY consuming package (Rule 8)**

Run: `pnpm turbo run typecheck --force`
Expected: PASS. ⚠ `LabResultsTable` is a **shared type** — vitest strips types and would stay green
over a type error. `turbo typecheck` is the only thing that sees it.

- [ ] **Step 5: Commit**

```bash
cd D:/Projects/Repositories/openldr_ce
git add packages/db/src/migrations/external/009_lab_results_issued.ts packages/db/src/migrations/external/index.ts packages/db/src/schema/external.ts
git commit -m "feat(db): add lab_results.issued (additive)"
```

---

## Task 6: Project `issued` into `lab_results`

**Repo:** `openldr_ce`

**Files:**
- Modify: `packages/db/src/relational/observation.ts`
- Test: `packages/db/src/relational/observation-issued.test.ts` (create)

**Precedent:** `packages/db/src/relational/diagnostic-report.ts:14` is `issued: str(r['issued'])`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/relational/observation-issued.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { projectObservation } from './observation';

describe('projectObservation timestamps', () => {
  it('projects issued into lab_results.issued', () => {
    const row = projectObservation(
      { id: 'o1', resourceType: 'Observation', issued: '2019-01-23T15:56:42+03:00' },
      { batchId: 'b1' },
    );
    expect(row.issued).toBe('2019-01-23T15:56:42+03:00');
  });

  // D2: result_timestamp keeps reading effectiveDateTime (the COLLECTION time),
  // despite its name. MUTATION GUARD against someone "helpfully" re-pointing it.
  it('keeps result_timestamp reading effectiveDateTime, NOT issued', () => {
    const row = projectObservation(
      { id: 'o1', resourceType: 'Observation',
        effectiveDateTime: '2019-01-20T08:00:00+03:00',
        issued: '2019-01-23T15:56:42+03:00' },
      { batchId: 'b1' },
    );
    expect(row.result_timestamp).toBe('2019-01-20T08:00:00+03:00');
    expect(row.issued).toBe('2019-01-23T15:56:42+03:00');
  });

  it('leaves issued null when absent', () => {
    const row = projectObservation({ id: 'o1', resourceType: 'Observation' }, { batchId: 'b1' });
    expect(row.issued).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db && pnpm vitest run src/relational/observation-issued.test.ts`
Expected: FAIL — `row.issued` is `undefined` (property does not exist).

- [ ] **Step 3: Write the implementation**

In `packages/db/src/relational/observation.ts`, add after `result_timestamp` in the returned object:

```ts
    result_timestamp: str(r['effectiveDateTime']),
    // Observation.issued — the RELEASE time. Mirrors diagnostic-report.ts:14.
    // result_timestamp above intentionally keeps reading effectiveDateTime (the
    // COLLECTION time) — it is misnamed, but the warehouse is a public surface.
    issued: str(r['issued']),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/relational/observation-issued.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/relational/observation.ts packages/db/src/relational/observation-issued.test.ts
git commit -m "feat(db): project Observation.issued into lab_results.issued"
```

---

## Task 7: One shared coalesce chain across all five AMR queries

**Repo:** `openldr_ce`

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts`

**The chain (D4), identical everywhere:**
```
coalesce(<obs>.result_timestamp, s.received_time, <obs>.issued)
```
Order = chronological proximity to the clinically relevant moment: collection → specimen received
(closest proxy) → release (last resort).

**The escape (fail-open) everywhere** — a record with **no** time stays **VISIBLE**:
```
where <chain> is null
   or (<chain> >= {{param.from}} and <chain> <= <to-concat>)
```

**Exact sites — counted with `grep -c`, do not re-estimate:**

| group | count | lines |
|---|---|---|
| `coalesce(oo.result_timestamp, s.received_time)` — **extend with `, oo.issued`** | **36** (9 blocks × 4) | `705-713`, `801-809`, `904-912`, `1015-1023`, `1094-1102`, `1188-1196`, `1310-1315`, `1359-1364`, `1415-1420` |
| bare `and o.result_timestamp >=` — **replace** | **6** | `178`, `198`, `217`, `603`, `618`, `633` |
| bare `o.result_timestamp <=` — **replace** | **6** | `179`, `199`, `218`, `604`, `619`, `634` |

**⚠ The two broken queries do NOT join `specimens`.** `q-amr-resistance` is `from lab_results o`
(`:176`); `q-amr-facility-summary` is `from lab_results o join patients p on o.patient_id = p.id`
(`:598-599`). Sharing the chain requires **6 new joins** (2 queries × 3 dialects):

```sql
left join specimens s on s.id = o.specimen_id
```

**⚠ Per-dialect `to`-concat — write each string explicitly, never find-and-replace:**

| dialect | form | example line |
|---|---|---|
| postgres | `({{param.to}} \|\| 'T23:59:59.999Z')` | `:713` |
| mssql | `({{param.to}} + 'T23:59:59.999Z')` | `:809` |
| mysql | `concat({{param.to}}, 'T23:59:59.999Z')` | `:912` |

- [ ] **Step 1: Extend the chain in the three working queries (9 strings, 36 sites)**

For **each** of the 9 blocks, replace every occurrence of:
```sql
coalesce(oo.result_timestamp, s.received_time)
```
with:
```sql
coalesce(oo.result_timestamp, s.received_time, oo.issued)
```

Verify the count is now zero:
```bash
grep -c 'coalesce(oo.result_timestamp, s.received_time)$' packages/reporting/src/seed/report-seeds.ts
grep -c 'coalesce(oo.result_timestamp, s.received_time, oo.issued)' packages/reporting/src/seed/report-seeds.ts
```
Expected: the second count is **36**.

- [ ] **Step 2: Fix `q-amr-resistance` (postgres, `:176-179`)**

Replace:
```sql
from lab_results o
where o.abnormal_flag in ('S', 'I', 'R')
  and o.result_timestamp >= {{param.from}}
  and o.result_timestamp <= ({{param.to}} || 'T23:59:59.999Z')
```
with:
```sql
from lab_results o
left join specimens s on s.id = o.specimen_id
where o.abnormal_flag in ('S', 'I', 'R')
  and (coalesce(o.result_timestamp, s.received_time, o.issued) is null
       or (coalesce(o.result_timestamp, s.received_time, o.issued) >= {{param.from}}
           and coalesce(o.result_timestamp, s.received_time, o.issued) <= ({{param.to}} || 'T23:59:59.999Z')))
```

- [ ] **Step 3: Repeat for `q-amr-resistance` mssql (`:198-199`) and mysql (`:217-218`)**

Identical, except the `to`-concat: mssql `({{param.to}} + 'T23:59:59.999Z')`, mysql
`concat({{param.to}}, 'T23:59:59.999Z')`. **Add the same `left join specimens s on s.id = o.specimen_id`
to both.**

- [ ] **Step 4: Repeat all three dialects for `q-amr-facility-summary` (`:603-604`, `:618-619`, `:633-634`)**

Same chain, same escape, same new join. ⚠ This query already has `join patients p on o.patient_id = p.id`
(`:599`) — **add the specimen join alongside it, do not replace it.**

- [ ] **Step 5: Verify no bare predicate survives**

```bash
grep -c 'and o.result_timestamp >=' packages/reporting/src/seed/report-seeds.ts
grep -c 'o.result_timestamp <=' packages/reporting/src/seed/report-seeds.ts
grep -c 'left join specimens s on s.id = o.specimen_id' packages/reporting/src/seed/report-seeds.ts
```
Expected: **0**, **0**, **6**.

- [ ] **Step 6: Write REAL tests for the chain — the spec demands three (§5)**

⚠ **The 5 `amr-*-parity.test.ts` files are `it.skip` + `expect(true).toBe(true)`. They pin nothing.
This SQL is currently UNTESTED — do not mistake a green suite for coverage.**

A real, in-code fixture already exists: **`scripts/lib/reports-parity-fixture.ts:86-91`** (it seeds
`634-6` rows). Use it against the dev Postgres (`openldr_target`, docker compose) — do **not** invent
a new fixture.

Create `packages/reporting/src/seed/amr-timestamp-chain.test.ts` covering exactly these three, each
with the mutation that turns it red:

| assertion | must fail when |
|---|---|
| a row with `result_timestamp` **and** `received_time` **and** `issued` all NULL is **RETURNED** | the `is null` escape is dropped |
| a row with **only `issued`** set (others NULL) is **RETURNED**, and its `iso_date` equals that `issued` | the chain omits `issued` |
| a row whose only time is **outside** `[from, to]` is **EXCLUDED** | ⚠ **vacuity guard** — without this, an `is null OR …` that always matches passes both tests above |

> **SKETCH — how to execute a seeded query in a test is UNRESOLVED.** The parity tests describe
> throwaway scripts that were **deleted**, so there is no working example in-repo. Options to
> investigate before writing: drive `runStoredQuery` (`packages/dashboards/src/custom-query-run.ts:62-65`)
> against the dev connector, or execute the dialect string directly via Kysely with
> `substituteParams` applied. **Report which you chose and why.**
> ⚠ `substituteParams` throws `unbound parameter` for any declared `{{param.x}}` absent from
> `values` — pass `from`, `to` **and** `facility` explicitly (see
> `amr-resistance-parity.test.ts:32-42`).

⚠ **These tests can only cover Postgres** (the dev DB). The **mssql and mysql** strings stay
unverified — Task 8 step 4 is the only check, and it too runs on Postgres. **Say so in the commit;
do not imply cross-dialect coverage you do not have.**

- [ ] **Step 7: Run the reporting suite**

Run: `cd packages/reporting && pnpm vitest run`
Expected: PASS. ⚠ `report-seeds.test.ts` may assert on SQL text — if it fails, read it; it may be
pinning the old predicate.

- [ ] **Step 8: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/amr-timestamp-chain.test.ts
git commit -m "fix(reporting): one shared coalesce chain + fail-open escape across all 5 AMR queries

Postgres-only coverage; the mssql/mysql strings remain unverified."
```

---

## Task 8: Live verification — the only evidence that matters

**Repos:** both. **Nothing here is unit-testable.**

**Why:** the parity tests are inert, the dev DB is Postgres (so mssql/mysql divergence is invisible),
and the whole bug class this slice fixes was *silent*.

- [ ] **Step 1: Record the BEFORE state**

```bash
docker exec -e PGPASSWORD=openldr openldr_ce-postgres-1 psql -U openldr -d openldr_target -c \
"select count(*) total, count(result_timestamp) has_effective, count(issued) has_issued from lab_results;"
```
Expected BEFORE: `total=135, has_effective=0, has_issued=0`.

- [ ] **Step 2: Re-ingest the 6 labs from DISA**

⚠ **Reprojection CANNOT fix existing rows** — the stored FHIR resources themselves lack the field, so
`reprojectAll` re-reads the same nothing. **Re-ingest is the only cure.**

Use the same `export-batch --ce-url` invocation the original ingest used (see
`docs/superpowers/specs/2026-07-16-cdr-fhir-ingest-to-ce-design.md`). Remember
`node --import tsx src/index.ts`, **not** `pnpm dev --`. `OPENLDR_CE_TIMEZONE` must be `+03:00`
(Tanzania) — it is **required, never defaulted**.

- [ ] **Step 3: Verify the AFTER state**

```bash
docker exec -e PGPASSWORD=openldr openldr_ce-postgres-1 psql -U openldr -d openldr_target -c \
"select count(*) total, count(result_timestamp) has_effective, count(issued) has_issued from lab_results;"
```
Expected AFTER: `has_issued = 135` (DATESTAMP is 191,121/191,121 in DISA) and `has_effective > 0`.

⚠ **If `has_effective` is 0, STOP — do not proceed.** That is spec §8's highest-risk unknown
realised: `SpecimenRecpt.TakenDateTime` from the `RTKNIDX5` fallback is a **SQL `datetime` via the
mssql driver**, and `disaToIso` (`v2-transform.ts:46`) **passes anything it does not recognise
straight through**, so a shape mismatch fails **silently**. Report the actual value, do not patch
around it.

- [ ] **Step 4: Verify the two broken reports now return rows**

```bash
docker exec -e PGPASSWORD=openldr openldr_ce-postgres-1 psql -U openldr -d openldr_target -c \
"select count(*) from lab_results o
 left join specimens s on s.id = o.specimen_id
 where o.abnormal_flag in ('S','I','R')
   and (coalesce(o.result_timestamp, s.received_time, o.issued) is null
        or (coalesce(o.result_timestamp, s.received_time, o.issued) >= '2013-01-01'
            and coalesce(o.result_timestamp, s.received_time, o.issued) <= '2020-01-01T23:59:59.999Z'));"
```
Expected: **> 0**. (The same shape returned **0** before this slice, for any range.)

- [ ] **Step 5: Verify no fabricated midnight**

```bash
docker exec -e PGPASSWORD=openldr openldr_ce-postgres-1 psql -U openldr -d openldr -t -A -c \
"select distinct resource->>'effectiveDateTime' from fhir.fhir_resources
 where resource->>'resourceType'='Observation' and resource ? 'effectiveDateTime' limit 10;"
```
⚠ If every value ends `T00:00:00+03:00`, the date-only path fabricated midnight — **that is a
defect** (Task 4, test 3), not a pass.

- [ ] **Step 6: Full gate**

Run: `pnpm turbo run typecheck test --force`
⚠ **Never pipe turbo through `tail`.** Ignore the known parallel-turbo flakes
(audit/studio-pages/users/db/marketplace/plugins/bootstrap store) — verify any suspect by running
that package's `vitest run` directly.

- [ ] **Step 7: Report — do not commit a claim you did not measure**

Paste the BEFORE and AFTER counts verbatim. If `has_effective` is 0, say so; the slice is **not**
done.

---

## Self-Review

**Spec coverage:** §4.1(a)→T1+T2. §4.1(b)→T4. §4.1(c)→T3. §4.1(d)→T4 test 3. §4.2→T5+T6.
§4.3→T7. §4.4→T8. §5 testing→T1-T4, T6, **T7 step 6**, T8. §6 regressions→T1's mutation guards, T4's
omit tests, T7's per-dialect explicitness, T8 step 5.

⚠ **Gap found and fixed during this self-review:** T7 originally changed 48 SQL sites with **no
test** — while spec §5 demands three (fail-open on NULL, `issued`-only in the chain, and the
out-of-range **vacuity guard**). Added as T7 step 6. **The whole point of this slice is a bug that
was silent; shipping its fix untested would have been the same mistake.**

**Test-free tasks, deliberately:** T5 (a migration — `turbo typecheck` is the gate) and T8 (live
verification, which is by definition not unit-testable).

**Counts (spec §3.6 → plan T7):** 36 / 6 / 6 / 6 new joins — **carried through identically**.

**Deliberately NOT covered (spec §7):** the `result_timestamp` rename; `abnormal_flag: null`
(`v2-transform.ts:496`); the Bundle profile; auditing other queries for bare null comparisons.

**Known SKETCH flags (3)** — each names what to verify: T2's `toV2`/`stubCodebook` fixture shape,
T3's `INSTANT_RE` extraction, T4's `toFhir`/`V2Payload` fixture shape. **All say: copy the adjacent
existing test rather than trust the literal.**
