# CDR ↔ v1 Mapping Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `compare-batch` compare the **V2 export payload** against v1 — strictly, over every v1 column — so the gate can no longer report green while the export silently drops data.

**Architecture:** Add a **second** field-def table (`toV2()` ↔ v1) beside the existing DISA↔v1 one. The old gate keeps guarding the decoder (layer 1); the new one guards the export (layer 2). No candidate arrays on the V2 side; escape hatches replaced by an evidence-bearing exception registry with expected counts.

**Tech Stack:** TypeScript. **`node:test`, NOT vitest.** Run from `apps/cli`.

**Spec:** `docs/superpowers/specs/2026-07-17-cdr-v1-mapping-gate-design.md` (`dafc41f7`)

**Repo:** `D:\Projects\Repositories\cdr-toolchain`, branch `slice/observation-timestamps` (reverted baseline `d23f6a4`, clean, **129 tests / 128 pass / 1 pre-existing skip**).

---

## ⛔ AMENDED 2026-07-17 AFTER EXECUTING TASK 1 — READ THIS FIRST

**Task 1 ran. Verdict: the `1900-01-01` sentinel hypothesis is KILLED** — by a third outcome neither
the spec nor this plan anticipated:

```
1900-01-01 rows by site:  TZLABMATE = 10,759   <- ALL of them (a DIFFERENT LIMS)
TDS (the DISA site):      0 sentinel rows, in ANY date column, of 174,261
```

⇒ **The sentinel is irrelevant to DISA.** `allowDisaEmpty`'s cause is **STILL UNKNOWN**.

**And it exposed a bigger error: v1 is MULTI-LIMS, so every percentage in the spec was the wrong
population** (measured across all 3.6M rows, ~22 sites, ≥2 vendors). Re-scoped to DISA, **every
stub's case is STRONGER** — `HL7AbnormalFlagCodes` is **100.0% (643,855/643,855)**, not 92.1%.

> ⛔ **THAT CLAIM IS ITSELF FALSIFIED (2026-07-17, during T4).** `HL7AbnormalFlagCodes` is
> **16.7% (107,602/643,855)** — the `100.0%` was `count()` counting 536,253 empty strings. And
> *"every stub's case is STRONGER"* is **false**: `patient_class`'s case **collapsed to zero**.
> **See "T4's measurements changed T5–T7" below — that section supersedes this one.**

### Revised task list — supersedes everything below

| task | status |
|---|---|
| **T1** sentinel investigation | ✅ **DONE — KILLED.** No code. |
| **T2** sentinel normaliser | ⛔ **CANCELLED** — the sentinel is a LabMate artifact; DISA has none. **Do not build it.** |
| **T3** delete `allowDisaEmpty` | ⛔ **CANCELLED** — its cause is unknown, so deleting it is unjustified. ⚠ **Reduced to: fix its FALSE comment** (`mapping.ts:165-172` claims *"an obvious literal default like 2013-02-06"* — that is **11 rows of 3,602,986**). The hatch **stays**; the comment must say the cause is **unknown**. |
| **T4** wire `toV2()` in | ✅ **DONE — `bf13bbd`.** Both sketches resolved (see §T4 below). |
| **T5** V2↔v1 field defs | ⚠ **AMENDED 2026-07-17 — see "T4's measurements changed T5-T7" below.** |
| **T6** result-level gate | ⚠ **AMENDED — the acceptance number is `abnormal_flag` vs 107,602 rows (16.7%), NOT 100.0% of 643,855.** |
| **T7** run at scale | ⚠ **AMENDED — `patient_class` is NOT a stub to report.** Must scope to DISA. |
| **T8 (NEW)** investigate `allowDisaEmpty`'s real cause | ⬜ **added.** On TDS, `ReceivedDateTime` is **88.7%** populated with **no sentinel**. When DISA's `ReceivedInLabDateTime` **and** `RegisteredDateTime` are both empty, where does v1's value come from? **Needs the DECODER, not SQL.** |

### ⛔ T4's measurements changed T5–T7 — READ BEFORE T5 (2026-07-17, spec `9388e764`)

Executing T4 falsified **three of this plan's own numbers**. Root cause: **`count(col)` counts
NON-NULL, and v1 writes `''` — not NULL — for an absent string.** Every `100.0%` in the spec's
"corrected for DISA" table was counting a mostly-empty column. **Third instance of this class**,
after the DISA blob layer and the multi-LIMS population.

**⇒ D7 (NEW): for any v1 VARCHAR, `count(col)` is meaningless. Use
`count(nullif(ltrim(rtrim(col)),''))`.** The datetime/numeric columns were safe (no empty-string
form), which is why only the string rows moved.

| v1 column (DISA/TDS) | plan/spec said | **REAL (non-empty)** | consequence |
|---|---|---|---|
| `HL7AbnormalFlagCodes` | 100.0% (643,855) | **16.7% — 107,602** | `abnormal_flag` **is still a real defect**; magnitude overstated **6×** |
| **`HL7PatientClassCode`** | 100.0% | **0.0% — empty on ALL 174,261** | **`patient_class` is NOT a defect** — CDR's `null` already matches v1 |
| `AuthorisedBy` | 100.0% | **91.1% — 158,807** | still real |
| `HL7ResultStatusCode` | 100.0% | **100.0%** ✅ | survives |
| `LIMSRptFlag` | 100.0% | **n/a** | **not a column on `OpenLdrV1LabResult`** — drop it |

⚠ **`patient_class` is the important one.** T7 originally listed it among the stubs to report as red
(now corrected there too). **Do not report it.** Had the gate asserted *"v1 is 100% populated ⇒ red"*, it would have **fabricated a
defect** and sent a fix slice to invent data v1 never had — the *inverse* of the bug this gate exists
to catch, and worse, because it manufactures work rather than hiding it.

⇒ **The comparator MUST treat v1's `''` as EMPTY.** `isEmpty` (`comparators.ts:8-12`) already does.
Then `V2 null` ↔ `v1 ''` = **match** (both absent) and `V2 null` ↔ `v1 'N'` = **only_v1** — the honest
107,602-row finding, with **no false red on the other 536,253**. **Verify this rather than assume it:
T5 step 1 must include a test pinning `V2 null ↔ v1 '' ⇒ match`.**

### ⛔ v1 KEEPS documentation observations — 36.6% (measured in T4)

```
VLID 218,181 + EIDID 17,664 = 235,845 of 643,855 v1 TDS result rows (36.6%)
```
Questionnaire rows — *"Is the client pregnant?"*, *"Drug Adherance"*, *"Reason for HVL Testing"*.
CDR routes them to the **forms feed** (`config/tanzania.yaml`), so their absence from the lab payload
is **intentional — not loss**.

⇒ **T6 MUST exclude v1 rows under documentation panels from pairing** — as a **COUNTED scope rule**
reported as its own number (`v1_results_documentation_excluded`), **never a silent drop**. Precedent:
`labs_pending_in_v1` (`compare-batch.ts:57-65`) — the §3.3b conditional-rule pattern already in the
codebase. **Without it, 235,845 rows score `only_v1` and drown every real finding.**

⚠ **Only excluded when `--country tanzania` is passed** — `OPENLDR_COUNTRY` is unset on this laptop,
so the default doc config is **EMPTY**. T4 added `--country` to `compare-batch` for exactly this.
**T7 must state which country the run used** — it changes the payload being graded.

### ⚠ `src/compare/` HAS ZERO TESTS

`find src -name "*.test.ts"` → **13 files, none under `compare/`**. The whole compare gate
(`mapping.ts`, `diff.ts`, `comparators.ts`, `result-diff.ts`) is untested; the 149-test suite is the
export side. So T5/T6's tests are the **first** tests this subsystem has ever had — there is no
existing harness to copy conventions from, and no safety net under any refactor of it.

### ⚠ D6 — SCOPE EVERY v1 QUERY TO DISA

**v1 is multi-LIMS.** Every v1 query — in the gate, in any probe, in any measurement — **MUST** filter
`RequestID LIKE 'TZDISAT%'`. Without it, the gate compares **DISA payloads against LabMate rows**.

**The baseline** (user: *"focus on data that both CDR and v1 have"*):
```
INTERSECTION: 98,259 requests   (every v1 TDS request exists in DISA)
DISA-only:    31,149            (v1 never ingested them — v1's SCOPE, not a CDR defect)
v1 TDS results: 643,855 rows
```

---

## ⛔ Read before Task 1

1. **This slice MEASURES. It does NOT fix any stub.** *"once the mapping is good, everything else
   will fall in place"* — the red is the deliverable.
2. **⚠ SPEC CORRECTION (resolved here).** Spec §3.2 says to move the `taken ?? collected` precedence
   into `v2-transform` as `specimen_datetime`. **That is a FIX, and §6 says fixing is out of scope —
   the spec contradicts itself.** Resolution: **this slice does NOT add `specimen_datetime`.** It
   asserts `V2.collected_datetime ↔ v1.SpecimenDateTime` **strictly** and lets the red derive the
   rule (D4). `specimen_datetime` is the **first fix slice**, justified by this gate's report.
3. **DISA stores BLOBS, not columns.** Never verify a DISA fact with `select count(col)`.
4. **Run tests from `apps/cli`** — `tsx` does not resolve from the repo root; you would get
   `ERR_MODULE_NOT_FOUND` and mistake it for a real failure.
5. **`pnpm dev -- <cmd>` breaks commander** — flags are silently ignored. Use
   `node --import tsx src/index.ts <cmd>`.
6. **No `Co-Authored-By` trailer.** The user is the sole contributor.

---

## File Structure

- Modify: `apps/cli/src/compare/comparators.ts` — sentinel normalisation
- Create: `apps/cli/src/compare/v2-mapping.ts` — the V2↔v1 field defs + exception registry
- Create: `apps/cli/src/compare/v2-diff.ts` — the V2↔v1 diff engine
- Modify: `apps/cli/src/commands/compare-batch.ts` — load codebook; run the V2 gate; report it
- Create: `apps/cli/src/compare/comparators-sentinel.test.ts`
- Create: `apps/cli/src/compare/v2-mapping.test.ts`

---

## Task 1: Confirm or KILL the `1900-01-01` sentinel hypothesis

**No code. Investigation only. Report back before Task 2.**

**The claim (spec §3.3):** v1's `1900-01-01` is SQL Server's datetime zero = v1 writing *"empty"*.
⇒ the case `allowDisaEmpty` excuses (*"DISA empty but v1 has a date"*) is really
`DISA empty ↔ v1 empty-expressed-as-sentinel` — a representation mismatch, not data loss.

**What IS proven:** v1 uses the sentinel at scale — `ReceivedDateTime` **10,759**,
`SpecimenDateTime` **10,735**, `AnalysisDateTime` **18,464**, `RegisteredDateTime` 6,
`AuthorisedDateTime` 0 (of 3,602,986). And the hatch's cited justification — *"an obvious literal
default like 2013-02-06"* — is **11 rows of 3,602,986**. Noise.

**What is NOT proven — your job:** that for a specific request where **DISA's blob is empty**, v1
holds exactly `1900-01-01`. That needs the **decoder**, not SQL.

- [ ] **Step 1: Find candidate requests**

Query v1 for requests whose `ReceivedDateTime` is the sentinel:
```sql
select top 20 RequestID from OpenLDRData.dbo.Requests
where cast(ReceivedDateTime as date) = '1900-01-01'
```
DISA's `LabNo` = the v1 `RequestID` minus its site prefix (v1 `TZDISATDS0013541` ⇒ DISA `TDS0013541`).
⚠ **Verify that prefix rule against `apps/cli/src/compare/lab-number.ts` — do not assume it.**

- [ ] **Step 2: Decode the DISA side for those same requests**

Write a **throwaway** probe (delete it afterwards; do not commit) that, for each candidate LabNo,
runs `SpecimenRecpt.Fetch` and prints `ReceivedInLabDateTime`, `RegisteredDateTime`,
`CollectedDateTime`, `TakenDateTime`.

Model it on `fetchDisaSpecimen` in `apps/cli/src/commands/compare-batch.ts:86` (it does
`REGDAT4.All(WHERE [LabNo] = '...')` then `SpecimenRecpt.Fetch(regs[0], server)`, and **must**
`closePool()` in a `finally`). Connection string: same env/`.env` the CLI uses — see
`apps/cli/src/config.ts`.

- [ ] **Step 3: Report the verdict — do NOT proceed on an assumption**

For each candidate, report: `v1.ReceivedDateTime` and each DISA field.

| finding | meaning |
|---|---|
| DISA fields ALL empty while v1 = `1900-01-01` | ✅ **CONFIRMED** — sentinel = empty. Task 2 proceeds. |
| DISA has a REAL date while v1 = `1900-01-01` | ⛔ **KILLED** — v1 **LOST** the date. That is a v1 defect, not ours, and `allowDisaEmpty` was masking the wrong thing. **STOP and report.** |
| mixed | ⛔ **STOP and report the split with counts.** |

⚠ **If KILLED, `allowDisaEmpty`'s real cause is still unknown. Do NOT keep the hatch on the strength
of spec §3.3 — it would be exactly the "justified by an anecdote" failure that created it.**

- [ ] **Step 4: Report. No commit** (the probe is throwaway).

---

## Task 2: The sentinel normaliser

**Gated on Task 1 = CONFIRMED.**

**Files:**
- Modify: `apps/cli/src/compare/comparators.ts`
- Test: `apps/cli/src/compare/comparators-sentinel.test.ts` (create)

**Context:** `isEmpty` (`comparators.ts:8-12`) knows `null`/`undefined`/empty-string. It does **not**
know `1900-01-01`. So v1's sentinel reads as a real value ⇒ `asymmetric()` (`:14-21`) returns
`only_v1` ⇒ `allowDisaEmpty` converts that to a match. **Normalising the sentinel produces the same
match with an honest reason, and lets the hatch be deleted.**

- [ ] **Step 1: Write the failing test**

Create `apps/cli/src/compare/comparators-sentinel.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { datetime, isSqlDatetimeZero } from "./comparators.js";

// v1 writes SQL Server's datetime zero to mean "no date": measured in
// OpenLDRData.Requests — ReceivedDateTime 10,759 / SpecimenDateTime 10,735 /
// AnalysisDateTime 18,464 of 3,602,986.
test("isSqlDatetimeZero recognises v1's empty sentinel", () => {
  assert.equal(isSqlDatetimeZero(new Date(Date.UTC(1900, 0, 1, 0, 0, 0))), true);
});

// VACUITY GUARD: a normaliser that swallowed every date would make the
// "DISA empty vs a REAL v1 date" test below pass too. This pins the boundary.
test("isSqlDatetimeZero does NOT swallow real dates", () => {
  assert.equal(isSqlDatetimeZero(new Date(Date.UTC(2018, 4, 18))), false);
  assert.equal(isSqlDatetimeZero(new Date(Date.UTC(1900, 0, 2))), false);
  assert.equal(isSqlDatetimeZero(null), false);
});

test("DISA empty vs v1 sentinel is a MATCH, not only_v1", () => {
  const r = datetime(null, new Date(Date.UTC(1900, 0, 1)));
  assert.equal(r.status, "match");
});

// THE GUARD THAT MATTERS: DISA empty vs a REAL v1 date must still be only_v1.
// If this ever returns "match", the normaliser is too broad and we are silently
// matching real data against nothing — the exact class of bug this gate exists
// to catch.
test("DISA empty vs a REAL v1 date is still only_v1", () => {
  const r = datetime(null, new Date(Date.UTC(2018, 4, 18, 9, 0)));
  assert.equal(r.status, "only_v1");
});

test("v1 sentinel vs a REAL DISA date is a MISMATCH, not a match", () => {
  const r = datetime("05/18/2018 09:00", new Date(Date.UTC(1900, 0, 1)));
  assert.equal(r.status, "only_disa");
});
```

- [ ] **Step 2: Run it and CONFIRM IT FAILS**

Run: `cd apps/cli && node --import tsx --test src/compare/comparators-sentinel.test.ts`
Expected: FAIL — `isSqlDatetimeZero is not a function`. **Paste the output.**

- [ ] **Step 3: Implement**

In `apps/cli/src/compare/comparators.ts`, add above `isEmpty` (`:8`):

```ts
/**
 * v1 writes SQL Server's datetime zero (1900-01-01 00:00) to mean "no date" —
 * measured in OpenLDRData.Requests: ReceivedDateTime 10,759 / SpecimenDateTime
 * 10,735 / AnalysisDateTime 18,464 of 3,602,986 rows.
 *
 * Without this, the sentinel reads as a real value, every DISA-empty row scores
 * only_v1, and someone reaches for an escape hatch (that is exactly how
 * `allowDisaEmpty` was born, justified by "an obvious literal default like
 * 2013-02-06" — which is 11 rows of 3.6M).
 *
 * Deliberately EXACT: only 1900-01-01 00:00 itself. 1900-01-02, or 1900-01-01
 * with a real time, are real values. A broad "anything before 1901" rule would
 * silently match real data against empties.
 */
export function isSqlDatetimeZero(v: unknown): boolean {
  if (!(v instanceof Date) || Number.isNaN(v.getTime())) return false;
  return (
    v.getUTCFullYear() === 1900 &&
    v.getUTCMonth() === 0 &&
    v.getUTCDate() === 1 &&
    v.getUTCHours() === 0 &&
    v.getUTCMinutes() === 0 &&
    v.getUTCSeconds() === 0
  );
}
```

⚠ **Uses `getUTC*`** — `toWallClock` (`:187-196`) already documents why: *"mssql returns SQL DATETIME
values as UTC-component Date objects while disalab emits local-component formatted strings"*. Local
getters would make this host-TZ-dependent.

Then make `isEmpty` sentinel-aware (`:8-12`):
```ts
export function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (isSqlDatetimeZero(v)) return true; // v1's "no date"
  return false;
}
```

> **SKETCH — verify the blast radius before committing.** `isEmpty` is used by `asymmetric()` and by
> `wardComparator`/`facilityNameComparator`/`icd10Comparator`. Those take **strings**, so a Date
> sentinel cannot reach them — but **grep every `isEmpty` caller and confirm** rather than assume. If
> any caller would change behaviour, put the sentinel check in `asymmetric()` instead and say why.

- [ ] **Step 4: Run — PASS (5 tests). Then the full suite:**

`cd apps/cli && node --import tsx --test "src/compare/*.test.ts" && node --import tsx --test "src/export/*.test.ts"`
Expect the export suite unchanged: **129 tests / 128 pass / 1 skip**.
⚠ **If a compare test flips, STOP and report** — it may have been relying on the sentinel scoring
`only_v1`.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/compare/comparators.ts apps/cli/src/compare/comparators-sentinel.test.ts
git commit -m "feat(compare): recognise v1's 1900-01-01 as the empty-date sentinel"
```

---

## Task 3: Delete `allowDisaEmpty`

**Gated on Task 2.**

**Files:** `apps/cli/src/compare/mapping.ts`, `apps/cli/src/compare/diff.ts`

**Why now:** with the sentinel normalised, the hatch's only in-repo user (`received_at`, `:173`)
should no longer need it. **Deleting it is the proof.**

- [ ] **Step 1: Delete the flag from `received_at`** (`mapping.ts:~173`) and its stale comment
  (`:165-172`) — the comment cites *"a few rows even share an obvious literal default like
  2013-02-06"*, which is **11 rows of 3,602,986**. Replace it with a one-line note that v1's empty is
  the `1900-01-01` sentinel, now handled in the comparator.

- [ ] **Step 2: Delete `allowDisaEmpty` — all 5 sites (counted, not estimated)**

`grep -rn "allowDisaEmpty" apps/cli/src` → **5**:
| site | what |
|---|---|
| `compare/mapping.ts:41` | the `FieldDef` field — **delete** |
| `compare/mapping.ts:173` | `received_at`'s `allowDisaEmpty: true` — **delete** (step 1) |
| `compare/mapping.ts:170` | its stale comment — **delete** (step 1) |
| **`compare/diff.ts:85`** | **the CONSUMER** — `def.allowDisaEmpty === true && …` — **delete the branch** |
| `compare/result-diff.ts:484` | a **comment** referencing it — **update the prose** |

⚠ **`diff.ts:85` is the one that actually forgives.** Deleting the flag from the interface without
removing that branch would leave dead-but-live logic. **Re-grep after: the count must be 0.**

- [ ] **Step 3: Run a REAL batch and compare the `received_at` numbers before/after**

```bash
cd apps/cli && node --import tsx src/index.ts compare-batch --limit 300 --summary-only
```
⚠ **This is the acceptance test.** If `received_at`'s mismatch/only_v1 count **rises** after deleting
the flag, the sentinel does **not** fully explain it — **STOP and report the residue with counts.**
Do **not** re-add the hatch; that residue is a finding.

- [ ] **Step 4: Commit** (only if step 3 shows no regression)

```bash
git add apps/cli/src/compare/mapping.ts apps/cli/src/compare/diff.ts
git commit -m "refactor(compare): delete allowDisaEmpty — the sentinel explains it

Its stated justification ('an obvious literal default like 2013-02-06') is 11
rows of 3,602,986. The real cause is v1's 1900-01-01 empty sentinel, now handled
in the comparator."
```

---

## Task 4: Wire `toV2()` into `compare-batch` — ✅ DONE (`bf13bbd`)

**Outcome:** `--v2` off is **byte-identical** to the pre-task baseline (diffed on a real 20-lab
batch, normalising `elapsed_ms`); `--v2` on built **20/20** payloads. Suite: 149 / 148 pass / 1
pre-existing skip.

**Both SKETCHes resolved — from the code, not assumption. Both said "pass it":**
- **`auditReport`: PASS.** Not audit-only — `hasCorroboratedSpecimenMismatch` feeds
  `buildLabRequest` and swaps `specimen.system_id` to the anomaly namespace
  (`v2-transform.ts:309`). Omitting it would silently change a mapped field. Export builds it
  whenever quarantine is on, and **quarantine is ON by default** (`--no-quarantine` opts out), so
  the gate mirrors the default and always builds it.
- **`excludeObs`: PASS — and `--country` added.** v1 **does** keep documentation obs (36.6%; see
  above), but they are questionnaire rows CDR routes to the forms feed, so excluding them is
  correct. The doc-panel set comes from `config/<country>.yaml` and **`OPENLDR_COUNTRY` is unset**
  here ⇒ default set is EMPTY ⇒ without `--country` the gate grades a payload TZ never ships.

**Files:** `apps/cli/src/commands/compare-batch.ts`

**The dependency:** `compare-batch` has **no codebook and no site** (`grep codebook` → nothing).
`toV2` needs both.

⚠ **THE CRITICAL CONSTRAINT: the gate must call `toV2()` with the SAME opts as the real export, or it
gates a payload that never ships.** `export-batch.ts:530-534` uses:
```ts
toV2(specimen, {
  prefix: ctx.prefix,
  site: DEFAULT_SITE,
  codebook: ctx.codebook,
  auditReport,
  excludeObs: (o) => isDocumentationObs(o, ctx.codebook, ctx.docConfig),
})
```

- [ ] **Step 1: Load the codebook once per batch**

`loadCodebook(server)` is `apps/cli/src/export/codebook.ts:145` (async, hits the DB). **Load it once
before the lab loop, not per lab.** `DEFAULT_SITE` is `apps/cli/src/export/site-config.ts:30`.

> **SKETCH — `excludeObs` and `auditReport` are UNRESOLVED and you must decide + report.**
> - `excludeObs` filters documentation observations out of the export. **Does v1 keep them?** If v1
>   kept them and we exclude them, the result gate will show `only_v1` for every documentation obs —
>   **a false alarm that would drown the real findings.** Investigate against v1 before choosing, and
>   report which you picked.
> - `auditReport` is used by export-batch for quarantine. Determine whether `toV2` needs it for field
>   fidelity or only for the audit envelope. **If it changes any mapped field, the gate must pass it.**

- [ ] **Step 2: Build the V2 payload per lab**

Insert immediately after `const diff = diffRecord(disa, v1, { pocFormat });`
(`compare-batch.ts:261`), inside the existing `if (foundDisa && foundV1) {` block. `disa` is the
`SpecimenRecpt`; `v1` is the `OpenLdrV1Request`.

- [ ] **Step 3: Add a `--v2` flag** (default **off**) so the existing gate's behaviour is unchanged
  until asked for. Mirror the existing `--results` flag's shape (`compare-batch.ts:151`).

- [ ] **Step 4: Verify it runs and changes nothing yet**

```bash
cd apps/cli && node --import tsx src/index.ts compare-batch --limit 20 --summary-only
cd apps/cli && node --import tsx src/index.ts compare-batch --limit 20 --summary-only --v2
```
The first must be **byte-identical** to before this task. The second may report an empty V2 section.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/compare-batch.ts
git commit -m "feat(compare): build the V2 payload in compare-batch behind --v2"
```

---

## Task 5: The V2 ↔ v1 field-def table + exception registry

**Files:** `apps/cli/src/compare/v2-mapping.ts` (create), `apps/cli/src/compare/v2-diff.ts` (create),
`apps/cli/src/compare/v2-mapping.test.ts` (create)

**The contract — note what is ABSENT:**
```ts
export interface V2FieldDef {
  field: string;
  getV2: (p: V2Payload) => unknown;          // ONE source. NO candidate arrays.
  getV1: (r: OpenLdrV1Request) => unknown;   // ONE source.
  comparator: (v2: unknown, v1: unknown) => CompareResult;
}
```
⚠ **No `allowDisaEmpty`. No arrays.** If we cannot say which v1 column a V2 field maps to, **we do
not know the mapping** — that is the finding, not a licence to widen the assertion.

**The exception registry:**
```ts
export interface V2FieldException {
  field: string;
  reason: string;    // WHY V2 and v1 cannot agree
  evidence: string;  // the measurement/citation that PROVES it — not an assertion
  expected: number;  // the mismatch count we accept; a REGRESSION past this FAILS
}
```
⚠ **`expected` is what stops this becoming the next `allowDisaEmpty`.** A boolean forgives
everything, forever. A count forgives exactly what was measured and **fails when it grows**.

**Day-one exceptions** (each needs real `evidence`, measured — not copied from this plan):
- `taken_datetime` / `collected_datetime` — v1 has **no** separate column; it collapses both into
  `SpecimenDateTime`.
- `result_timestamp` — **v1 has NO per-result timestamp column at all.**
- `source_payload`, `source_test_code`, `obx_set_id` — CDR-internal, no v1 counterpart.

⚠ **`patient_class` is NOT an exception and NOT a def-with-expected-red.** v1's
`HL7PatientClassCode` is **empty on all 174,261 TDS rows**, and CDR emits `null`. **They agree.**
It gets an ordinary strict def and is expected to score **match** — via the `'' ⇒ empty` rule, not
via any tolerance. If it goes red, the `''`-handling is broken, not the export.

**A third mechanism — CONDITIONAL RULES (spec §3.3b) — is NOT an exception.** Do not conflate:

| | says | needs `expected`? |
|---|---|---|
| **exception** | *"we tolerate a mismatch"* | **yes** — a count, so a regression fails |
| **conditional rule** | *"the correct value DEPENDS ON STATE"* | **no** — it IS the mapping |

Day-one conditional rules (measured, spec §3.3b): `authorised_at` — empty is **correct** when
`HL7ResultStatusCode !== 'F'` (among F rows it is 99.95%). ⚠ **The 73 F-status rows with no
`AuthorisedDateTime` (0.05%) must be COUNTED, not smoothed away** — a conditional rule that absorbs
them becomes the next `allowDisaEmpty`.

**Field defs — cover EVERY v1 column except v1's own bookkeeping** (`DateTimeStamp`, `Versionstamp`,
`LIMSDateTimeStamp`, `LIMSVersionstamp`). ⚠ **Low population is a FACT to record, not a reason to
skip** — this laptop is 1 site of 22; a column at 7.8% here may be 90% elsewhere.
⚠ **Enumerate from `openldr.ts:6-66`, and note `LIMSRptFlag` is NOT among them** — the spec's table
invented it.

**The one that derives the mapping (D4):**
```ts
{
  // v1 collapses DISA's TakenDateTime and CollectedDateTime into one
  // SpecimenDateTime. STRICT on purpose: the old gate offered both as
  // candidates ("a match on either wins"), which is precisely why it could
  // never discover which one v1 means. Measured on 3 of 3 real requests,
  // v1.SpecimenDateTime equals CE's collectedDateTime exactly (13:30/10:00/
  // 09:00) while taken differs by up to 5 hours. Assert `collected` and let
  // the report prove or refute it at scale.
  field: "collected_datetime",
  getV2: (p) => p.lab_request.collected_datetime,
  getV1: (r) => r.SpecimenDateTime,
  comparator: datetime,
},
```

- [ ] **Step 1: Write the failing tests** — `v2-mapping.test.ts`:

| test | must fail when |
|---|---|
| a V2 field that is `null` while v1 is populated ⇒ **`only_v1`**, NOT match | someone reintroduces a candidate array or a hatch |
| **`V2 null` ↔ `v1 ''` ⇒ `match`** | the `''`-as-empty rule breaks ⇒ **536,253 rows of FALSE red** |
| **`V2 null` ↔ `v1 'N'` ⇒ `only_v1`** (the pair-guard for the row above) | the empty rule is too broad and swallows real flags — **107,602 rows of silently-hidden loss** |
| an exception with `expected: 3` **passes at 3** | — |
| the same exception **FAILS at 4** | `expected` is treated as "ignore" rather than "pin" |
| every non-bookkeeping v1 column has a def **or** an exception — asserted against an explicit list | a v1 column is silently uncovered |

⚠ **The two `''` tests are a PAIR and must be written together.** Either alone is vacuous: a
comparator that called everything empty would pass the first; one that called nothing empty would
pass the second. Only together do they pin the boundary — this is the same vacuity trap that made a
"mutation guard" pass on UTC hosts in the timestamps slice.

⚠ **The last one is the coverage guard.** Without it, "cover every column" degrades the first time
someone adds a v1 column. Enumerate the expected list **from `OpenLdrV1Request`/`OpenLdrV1LabResult`
in `apps/cli/src/openldr.ts:6-66`**, not from memory.

- [ ] **Step 2: Run — CONFIRM FAILURE. Paste output.**
- [ ] **Step 3: Implement `v2-mapping.ts` + `v2-diff.ts`.**

> **SKETCH — reuse, do not reinvent.** `diff.ts` already computes a `DiffSummary` from field defs;
> model `v2-diff.ts` on it. **Read it first.**

- [ ] **Step 4: Run — PASS. Then the full suite.**
- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/compare/v2-mapping.ts apps/cli/src/compare/v2-diff.ts apps/cli/src/compare/v2-mapping.test.ts
git commit -m "feat(compare): strict V2<->v1 field defs + evidence-bearing exception registry"
```

---

## Task 6: The result-level V2 gate — and the slice's ACCEPTANCE TEST

**Files:** `apps/cli/src/compare/v2-mapping.ts`, `apps/cli/src/compare/v2-diff.ts`

**This is the task that proves the whole slice.** `abnormal_flag` is hardcoded `null`
(`v2-transform.ts:495`) while v1's `HL7AbnormalFlagCodes` carries a real flag on
**107,602 of 643,855 DISA/TDS rows (16.7%)** — `N` 99,232 / `L` 6,003 / `H` 2,339 / `LL` 16 / `HH` 12.

⚠ **AMENDED — this figure was `100.0% / 643,855 of 643,855` and that was WRONG** (`count()` counted
536,253 empty strings; see D7 above). **The defect is real; its size is 6× smaller.** The other
536,253 rows are `''` and must score **match** against CDR's `null`.

⚠ **The v1 side is ALREADY fetched** — `OpenLdrV1LabResult.HL7AbnormalFlagCodes`
(`apps/cli/src/openldr.ts:62`). Nothing compares it. That is the bug.

**Pairing:** `V2Result` ↔ `v1.LabResults` by `(RequestID, OBRSetID, OBXSetID)`.
⚠ **`result-diff.ts` already solves the equivalent pairing** for DISA↔v1, including *"DISA reruns a
panel by adding a higher TESTINDEX row; v1's migration kept only the final iteration"*
(`result-diff.ts:341-342`). **Read it and reuse its pairing rather than inventing one.**

⛔ **THE DOCUMENTATION-PANEL SCOPE RULE — build this BEFORE the acceptance test, or the signal is
buried.** v1 keeps questionnaire rows the export deliberately routes to the forms feed:
**235,845 of 643,855 (36.6%)** under `VLID`/`EIDID`. Exclude v1 rows whose owning
`Requests.LIMSPanelCode` is in the run's documentation-panel set from pairing, and **report the count
as `v1_results_documentation_excluded`** — a counted scope rule, never a silent drop
(precedent: `labs_pending_in_v1`, `compare-batch.ts:57-65`).
⚠ **Use the SAME `docConfig.panels` the payload was built with** (T4 threads it through) — hardcoding
`VLID`/`EIDID` would desync from `config/<country>.yaml` and silently mis-scope the moment the
country changes. **And with no `--country` the set is EMPTY, so nothing is excluded** — that is
correct, because nothing was excluded from the payload either. The two must move together.

- [ ] **Step 1: THE ACCEPTANCE TEST — write it first**

```ts
// The whole slice exists because the gate never looked at the export.
// v2-transform.ts:495 hardcodes `abnormal_flag: null` while v1 carries a real
// flag on 107,602 of 643,855 DISA/TDS rows (16.7%). If this does NOT go red on a
// real batch, the gate is not reading the V2 payload — which IS the bug.
test("a stubbed V2 field vs a populated v1 column reports only_v1", () => {
  const r = compareV2Result(
    { abnormal_flag: null } as V2Result,
    { HL7AbnormalFlagCodes: "N" } as OpenLdrV1LabResult, // 'N' = 99,232 rows, the real modal flag
  );
  assert.equal(r.byField["abnormal_flag"]!.status, "only_v1");
});

// THE PAIR-GUARD. v1 stores '' (536,253 rows) for "no flag" — CDR's null AGREES.
// Without this, the test above is satisfied by a comparator that reds every row,
// and the report would show 643,855 red instead of the true 107,602.
test("a stubbed V2 field vs an EMPTY v1 column is a match", () => {
  const r = compareV2Result(
    { abnormal_flag: null } as V2Result,
    { HL7AbnormalFlagCodes: "" } as OpenLdrV1LabResult,
  );
  assert.equal(r.byField["abnormal_flag"]!.status, "match");
});
```
⚠ Use `'N'`, **not** `'R'` — the plan's original literal. The measured value set is
`N`/`L`/`H`/`LL`/`HH`; **`R` never occurs**, and a fixture with an impossible value is a small lie
that makes the test look like it pins reality when it doesn't.
⚠ **Adapt the shape to what you actually build in Task 5** — this is the intent, not a literal.

- [ ] **Step 2: Run — CONFIRM FAILURE.**
- [ ] **Step 3: Implement the result-level defs** — every `OpenLdrV1LabResult` column
  (`openldr.ts:50-66`) except bookkeeping.
- [ ] **Step 4: Run — PASS. Full suite.**
- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/compare/
git commit -m "feat(compare): result-level V2<->v1 gate

abnormal_flag is hardcoded null in v2-transform while v1 carries a real flag on
107,602 of 643,855 DISA/TDS rows (16.7%). Nothing compared it. Now it is red.
The other 536,253 rows are v1's '' and correctly score match."
```

---

## Task 7: Run at scale — produce the inventory

**No production code. This is the deliverable.**

- [ ] **Step 1: Run a large batch**

```bash
cd apps/cli && node --import tsx src/index.ts compare-batch --limit 500 --v2 --results --summary-only --country tanzania 2> batch-summary.json
```
⚠ Adjust `--limit` to what completes in reasonable time; **report the number you used** — a sample
size is part of the finding. ⚠ **`--country` is now load-bearing: report which one you ran with.**
Without it the doc-panel set is empty and you are grading a different payload (T4).

- [ ] **Step 2: Report per field**: match / mismatch / only_v2 / only_v1, and **where a mismatch is
  systematic, the observed rule.**

**Expect a wall of red** — `analysis_at`, `authorised_at`, `result_status`, `authorised_by`,
`abnormal_flag`, `age_days` are hardcoded `null` against **real, re-measured** v1 populations
(`abnormal_flag` **16.7%**, `authorised_by` **91.1%**, `analysis_at` **99.0%**,
`authorised_at` **91.2%**, `age_days` **93.4%**). **That is success.** It is the inventory we have
never had.

⛔ **`patient_class` is NOT in that list — REMOVED 2026-07-17.** v1's `HL7PatientClassCode` is
**empty on all 174,261 TDS rows**; CDR's `null` **agrees**. It must score **match**.
**If it comes back red, the bug is in the `''`-as-empty handling — do NOT report it as an export
defect and do NOT open a fix slice for it.**

⚠ **Report `abnormal_flag` as ~107,602 red of 643,855, not "100%".** If the run instead shows ~643,855
red, the `''` rule is broken (see T5's pair-guard) — **that is a gate bug, not a finding.**

- [ ] **Step 3: The load-bearing question — `collected` vs `taken`**

Report `collected_datetime ↔ SpecimenDateTime`'s match rate. The prediction (from 3 of 3 real
requests) is **~97%**. **If it is not, the prediction is wrong and the fix slice must follow the data,
not this plan.**

- [ ] **Step 4: Write the findings up** to
  `docs/superpowers/specs/2026-07-17-mapping-gate-findings.md` in `openldr_ce` — per-field rates,
  the derived rules, and every field where V2 is `null` and v1 is not.

⚠ **Do NOT fix anything.** Each fix is its own slice, justified by this report.

- [ ] **Step 5: Commit the findings** (in `openldr_ce`).

---

## Self-Review

**Spec coverage:** §3.1→T4+T5. §3.3→T1+T2+T3. §3.4→T5. §3.5→T7. §3.6→T5 step 1's coverage guard.
§4 testing→T2, T5, T6. §5 regressions→T2's vacuity guard, T3's before/after, T5's `expected`-pin,
T6's acceptance test.

⚠ **Spec §3.2 (`specimen_datetime`) is DELIBERATELY NOT IMPLEMENTED** — see "Read before Task 1" #2.
The spec contradicts itself (Design says fix; §6 says measure-only). Resolved as: **this slice
measures; `specimen_datetime` is the first fix slice.**

⚠ **Spec undercounted the escape hatches.** It names 2 (candidate arrays, `allowDisaEmpty`). Reading
`comparators.ts` found **5**: those two plus `wardComparator` (`:65-75`), `facilityNameComparator`
(`:88-103`) and `icd10Comparator` (`:112-122`), each converting `only_disa` → **match** with the
reason *"v1 data loss, not a toolchain bug"*; plus `datetime`'s midnight rule (`:156-166`).
**Those three are on the DISA↔v1 gate and are OUT OF SCOPE here** (the V2 gate is a new table with no
hatches) — **but they are unaudited claims of v1 data loss, and this plan does not check them.**
Named so they are not lost.

**Test-free tasks, deliberately:** T1 (investigation — its output is a verdict), T7 (the measurement
run is the deliverable).
