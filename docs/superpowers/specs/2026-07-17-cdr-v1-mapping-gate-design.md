# The CDR ↔ v1 mapping gate — Design

**Date:** 2026-07-17
**Status:** Design agreed in brainstorm. NOT implemented.
**Repo:** `cdr-toolchain` (the gate lives with the tool it guards)
**Blocks:** every CDR export fix — [[disa-timestamp-stub-and-amr-zero-rows]], the `abnormal_flag`
stub, and the timestamps slice (T1/T2 **reverted**, parked).

---

## 0. Why

**User, 2026-07-17 (verbatim):**

> *"the cdr tool (disa mapping) was created by me, and may have mistakes, if the data don't match
> 100% between CDR and v1 then we have an issue, a big issue. **How can countries migrate their data
> if am creating further mistakes.** I would rather revert and create a slice to hammer this out,
> once the mapping is good, everything else will fall in place."*

**CDR is a migration tool.** If it is lossy, Moz and Zambia migrate lossy data — and they will **not**
have v1 to catch it. Piecemeal fixes leave the next gap undiscovered until a national AMR report is
quietly wrong.

### 0.1 ⛔ The gate has never looked at the thing that makes the mistakes

```
grep -rn "toV2|toFhir|V2Payload|V2LabRequest|V2Result" \
  apps/cli/src/compare/ apps/cli/src/commands/compare-batch.ts apps/cli/src/commands/compare-results.ts
→ ZERO HITS
```
- request gate: `getDisa: (s: SpecimenRecpt)` — `compare/mapping.ts:26`
- result gate: `diffResults(disa: SpecimenRecpt, v1Rows: OpenLdrV1LabResult[])` — `compare/result-diff.ts:336-339`

**Both read the DISA DECODER. Neither has ever seen the export.**

| layer | code | gated today? |
|---|---|---|
| 1. DISA → `SpecimenRecpt` | `packages/disalab` | ⚠ yes — **13 permissive fields** |
| 2. `SpecimenRecpt` → `V2Payload` | `export/v2-transform.ts` | ⛔ **NO** |
| 3. `V2Payload` → FHIR | `export/fhir-transform.ts` | ⛔ **NO** |

⇒ **Every known defect lives in layers 2–3 and is structurally invisible.** The gate can report
**100% green while the export drops 92.1% of 11.6M abnormal flags.** It has been.

### 0.2 And where it does look, it is permissive by design

`compare/mapping.ts` — **exactly 13 fields**, two escape hatches:
1. **Candidate arrays** (`:20-27`) — *"a match on ANY of them counts"*. Used for
   `taken_at`/`collected_at` → `SpecimenDateTime` with the comment *"a match on either wins"*
   (`:147-149`). ⇒ **structurally cannot discover that v1 always means `collected`.** That is
   exactly how the inversion survived.
2. **`allowDisaEmpty`** (`:36-41`) — *"for fields where v1 stores data DISA's schema has no source
   for"*. **Often FALSE** — v1 got those from the blob. §3.3 dissolves it.

**The gate asserts "one of our guesses was close", not "the mapping is right."**

---

## 1. Decisions (user, in brainstorm)

| # | Decision |
|---|---|
| D1 | **Gate `toV2()` ↔ v1.** *"compare toV2 output, FHIR is just reshaping, no field logic"*. |
| D2 | **Strict by default. Every exception NAMED, JUSTIFIED, COUNTED** — with evidence, not a boolean. |
| D3 | **Cover EVERY v1 column** except v1's own bookkeeping. Low population is a **fact to record, not a reason to skip**. |
| D4 | **Let the RED derive the mapping.** A field reporting "collected 97.1% / taken 3%" *tells* us the rule. |
| D5 | ~~v1's `1900-01-01` is a SENTINEL~~ — **investigated 2026-07-17: KILLED.** All sentinel rows are `TZLABMATE` (a different LIMS); DISA's site has **zero**. `allowDisaEmpty`'s cause is **UNKNOWN** and the hatch **STAYS** for now. See §3.3. |
| D6 | **SCOPE EVERYTHING TO DISA.** v1 is **multi-LIMS** (~22 sites, ≥2 vendors). Every v1 query — in the gate and in any measurement — **MUST** filter `RequestID LIKE 'TZDISAT%'`, or it compares DISA payloads against LabMate rows. **Baseline = the 98,259-request intersection** (user: *"focus on data that both CDR and v1 have"*). |

**D1's consequence — the inversion is an ARCHITECTURE bug, not a ternary bug.**
`fhir-transform.ts:184`'s `lr.taken_datetime ?? lr.collected_datetime` **is field logic living in the
reshaping layer**. That is *why* it drifted from v1 and why no gate could see it.
⇒ **The precedence must MOVE into `v2-transform` as a `specimen_datetime` field mirroring v1's
`SpecimenDateTime`**, and FHIR maps it 1:1. Then the gate compares
`V2.specimen_datetime ↔ v1.SpecimenDateTime` directly. **Fixing the ternary in place would leave the
layer violation — and the blind spot — intact.**

---

## 2. Verified facts

Everything cited was read at the line or measured. **Unverified items are marked SKETCH.**

**v1 is the ORACLE.** Same DISA, populated by DISA's own vendor tool ⇒ **every populated v1 column
PROVES the data exists and CDR can reach it.**

⚠ **BUT v1 is MULTI-LIMS (D6).** Its **3,602,986** `Requests` / **11,597,899** `LabResults` span ~22
sites and ≥2 vendors (incl. `TZLABMATE`, **not DISA**). **Those totals are NOT the DISA population.**

**THE BASELINE — DISA (TDS), the intersection:**
```
v1 TDS:        174,261 rows (per-OBR) = 98,259 distinct RequestIDs
DISA REGDAT4:  129,408 LabNos
INTERSECTION:   98,259   <- every v1 TDS request exists in DISA
DISA-only:      31,149   <- v1 never ingested them (24%) — v1's SCOPE, not a CDR defect
v1 TDS results: 643,855 rows
```

**CORRECTED stub evidence — scoped to DISA (the numbers that justify this slice):**

| v1 column | ❌ all-sites (wrong) | ✅ **DISA/TDS** |
|---|---|---|
| **`HL7AbnormalFlagCodes`** | 92.1% | **100.0% — 643,855 / 643,855** |
| `LIMSRptFlag` | 91.8% | **100.0%** |
| `HL7ResultStatusCode` | 96.8% | **100.0%** |
| `HL7PatientClassCode` | 96.8% | **100.0%** |
| `AuthorisedBy` | 100% | **100.0%** |
| `AnalysisDateTime` | 84.7% | **99.0%** |
| `AuthorisedDateTime` | 79.6% | **91.2%** |
| `AgeInDays` | 98.4% | **93.4%** |
| `ReceivedDateTime` | 95.8% | **88.7%** |
| `SpecimenDateTime` | 97.1% | **83.1%** |

⇒ **Every stub's case is STRONGER once scoped correctly.** For DISA, v1 has an abnormal flag and a
result status on **100%** of rows while CDR hardcodes both `null`.

**The harness already exists** — `apps/cli/src/commands/compare-batch.ts:140`: *"Scan many records
end-to-end (DISA ↔ OpenLDR v1). Emits one NDJSON line per lab on stdout (summary stats), plus a
batch-summary to stderr at EOF."* Options `--where <sql>` / `--limit <n>` (default 100) /
`--offset <n>` (`:142-144`). Reports `labs_matched_perfectly` + per-field `mismatch`.
**Reuse it. Change only what it compares and how strictly.**

**The v1 side is ALREADY fetched and typed** — `apps/cli/src/openldr.ts:6-48` `OpenLdrV1Request`
(incl. `SpecimenDateTime`, `AnalysisDateTime`, `AuthorisedDateTime`, `HL7ResultStatusCode`,
`AgeInDays`, `HL7PatientClassCode`, `AuthorisedBy`) and `:50-66` `OpenLdrV1LabResult`
(**incl. `HL7AbnormalFlagCodes`, `:62`**).
⇒ **The data we need is already coming back from v1. The gate simply never compares it.** This makes
the slice far cheaper than the field count suggests.

**`V2LabRequest` is already v1-shaped** — `apps/cli/src/export/types.ts:30-60`: `taken_datetime`,
`collected_datetime`, `received_at`, `registered_at`, `analysis_at`, `authorised_at`,
`clinical_info`, `icd10_codes`, `therapy`, `priority`, `age_years`, `age_days`, `sex`,
`patient_class`, `section_code`, `result_status`, `requesting_facility_code`,
`testing_facility_code`, `requesting_doctor`, `tested_by`, `authorised_by`.
**The fields exist. Several are hardcoded `null`.**

**The known stubs** (`grep -n ": null,$" apps/cli/src/export/v2-transform.ts`), against v1:

*(line numbers re-verified against the **reverted baseline** `d23f6a4` — an earlier draft of this
table cited them from a pre-revert reading and was off by ~19 on every request-level row. **Re-grep
before editing; do not trust these if the file has moved on.**)*

| stub | line | v1 column | v1 populated |
|---|---|---|---|
| `abnormal_flag: null` | **495** | `HL7AbnormalFlagCodes` | **92.1%** of 11.6M |
| `rpt_flag: null` | **497** | `LIMSRptFlag` | 91.8% |
| `result_timestamp: null` | **499** | *(none — v1 has NO per-result timestamp)* | — |
| `analysis_at: null` | **335** | `AnalysisDateTime` | 84.7% |
| `authorised_at: null` | **336** | `AuthorisedDateTime` | 79.6% |
| `age_days: null` | **342** | `AgeInDays` | 98.4% |
| `patient_class: null` | **344** | `HL7PatientClassCode` | 96.8% |
| `result_status` = `X`-or-null | **350** | `HL7ResultStatusCode` | 96.8% |
| `authorised_by: null` | **358** | `AuthorisedBy` | 100% |

⚠ `:335`/`:336`/`:344` carry comments claiming *"disalab doesn't expose … on SpecimenRecpt"* / *"not
surfaced on SpecimenRecpt"*. **v1 proves the data exists** — the comments describe the decoder's
blind spot (§2 root cause), not DISA's contents. **Do not read them as evidence of absence.**

**The ROOT CAUSE of most of them** — `packages/disalab/src/lib/DisalabData/TESTDATA.ts:39`:
`Core.FixString(_data, 80, _data.length)` ⇒ **`TESTDATA_STATUS` bytes 0–79 are NEVER DECODED.**
That header holds the **per-OBR** status/timing. Prior probe
(`2026-07-16-disa-result-status-findings.md`): initials at **77–79** (98.99% on 168k panels), a
**year at offset 23**, and *"the review timestamp at ~21–26 is not fully decoded … Needs work before
`authorised_at` can be populated."*

**`isEmpty` does NOT know the sentinel** — `compare/comparators.ts:8-11` handles
`null`/`undefined`/empty-string only. **A `1900-01-01` Date is treated as a real value.** That is why
`allowDisaEmpty` was reached for (§3.3).

---

## 3. Design

### 3.1 A new gate layer: `toV2()` ↔ v1

Add a **second** field-def table comparing the **V2 payload** to v1 — near-1:1, because V2 was
modelled on v1.

```
V2FieldDef {
  field:      string                       // the V2 field name
  getV2:      (p: V2Payload) => unknown    // ONE source. No candidate arrays.
  getV1:      (r: OpenLdrV1Request) => unknown
  comparator: (v2, v1) => CompareResult
}
```

⚠ **Deliberately NOT `getDisa`.** The existing DISA↔v1 gate **stays** — it guards layer 1. This adds
layer 2. **Two gates, two purposes:** the old one says *"the decoder reads DISA correctly"*; the new
one says *"the export preserves it"*.

⚠ **No candidate arrays on `getV2`.** One V2 field ↔ one v1 column. If we cannot say which, **we do
not know the mapping** — and that is the finding, not a reason to widen the assertion.

> **SKETCH — the result-level shape is NOT settled.** `V2Result` ↔ `v1.LabResults` needs pairing by
> `(RequestID, OBRSetID, OBXSetID)`. `result-diff.ts` already solves the equivalent pairing for
> DISA↔v1 (incl. *"DISA reruns a panel by adding a higher TESTINDEX row; v1's migration kept only the
> final iteration"*, `:341-342`). **Read it and reuse its pairing rather than inventing one.**

### 3.2 Move the precedence out of FHIR (D1)

Per D1, **FHIR is pure reshaping**. So:

1. **Add `V2LabRequest.specimen_datetime`** — mirroring v1's `SpecimenDateTime`.
2. Resolve the precedence **in `v2-transform`**. Per the measured evidence, v1's rule is
   **`CollectedDateTime ?? TakenDateTime`** (v1 matched CE's `collectedDateTime` **3 of 3** exactly —
   13:30 / 10:00 / 09:00 — while `taken` differed by up to **5 hours**).
3. `fhir-transform` maps `specimen_datetime` → `effectiveDateTime` **1:1, no ternary**.
4. **`fhir-transform.ts:184` (DiagnosticReport) uses the same field** — its `taken ?? collected` is
   the same violation and is wrong today.
5. Keep `taken_datetime`/`collected_datetime` as raw passthroughs — they are faithful to DISA and the
   gate should assert them independently **if** a v1 column exists for them. **It does not** — v1
   collapses both into `SpecimenDateTime`. ⇒ they get an **explicit exception entry** (§3.4), not a
   silent pass.

⚠ **The gate then asserts `V2.specimen_datetime === v1.SpecimenDateTime` STRICTLY.** That single
assertion is what the old "either wins" could never make.

### 3.3 ⛔ KILLED — the sentinel hypothesis is WRONG. `allowDisaEmpty`'s cause is UNKNOWN.

**Task 1 executed 2026-07-17. Verdict: KILLED — by a third outcome neither the spec nor the plan
anticipated.**

```
1900-01-01 rows by site:  TZLABMATE = 10,759   <- ALL of them
TDS (the DISA site):      0 sentinel rows, in ANY date column, of 174,261
```

**Every sentinel row is `TZLABMATE` — a DIFFERENT LIMS. DISA's site has ZERO.**
⇒ **The sentinel is irrelevant to the DISA↔v1 gate.** It is LabMate's migration artifact.
⇒ **`allowDisaEmpty`'s real cause is STILL UNKNOWN.**
⇒ **Do NOT build the normaliser. Do NOT delete `allowDisaEmpty` on the strength of this section.**

**Why I got it wrong:** I measured `1900-01-01` across **all 3,602,986** v1 rows and attributed it to
DISA. v1 is **multi-LIMS**. Same error as *"only 21 labs have micro"* and *"collection time is
0.08%"* — **a population claim from the wrong population**, three times.

**What survives:** the hatch's *stated* justification is still false — *"an obvious literal default
like 2013-02-06"* is **11 rows of 3,602,986**. It was justified by an anecdote that does not hold.
**But "the justification is wrong" ≠ "the hatch is unnecessary."**

**The open question for a future task:** on TDS, `ReceivedDateTime` is **88.7%** populated with **no
sentinel**. So when DISA's `ReceivedInLabDateTime` **and** `RegisteredDateTime` are both empty, where
does v1's `ReceivedDateTime` come from? **That needs the DECODER, not SQL.** Until it is answered,
**`allowDisaEmpty` stays** — with its comment corrected to say the cause is unknown rather than
asserting a `2013-02-06` default.

<details><summary>Original §3.3 (WRONG — kept for the record)</summary>

### ~~Dissolve `allowDisaEmpty` — the sentinel (D5)~~

**Measured in v1** (`Requests`, n=3,602,986):

| v1 column | rows at `1900-01-01` |
|---|---|
| `ReceivedDateTime` | **10,759** |
| `SpecimenDateTime` | **10,735** |
| `AnalysisDateTime` | **18,464** |
| `RegisteredDateTime` | 6 |
| `AuthorisedDateTime` | 0 |

**`1900-01-01` is SQL Server's datetime zero** — v1's way of writing *"empty"*.
⇒ The case `allowDisaEmpty` excuses (*"DISA empty but v1 has a date"*) is **almost certainly
`DISA empty ↔ v1 empty-expressed-as-sentinel`** — a **representation mismatch, not data loss**.

**And the hatch's stated justification is factually wrong.** Its comment cites *"an obvious literal
default like 2013-02-06"* — measured: **11 rows of 3,602,986.** Noise, not a default.

⇒ **Fix: normalise the sentinel in the comparator** (`1900-01-01` → empty, alongside
`comparators.ts:8-11`'s `isEmpty`). Then DISA-empty ↔ v1-sentinel is a **legitimate MATCH**, and
**`allowDisaEmpty` is DELETED — dissolved by explanation, not justified as an exception.**

⚠ **HYPOTHESIS, NOT FACT — this is Task 1's job to confirm or kill.** I have proven v1 *uses* the
sentinel at scale. I have **NOT** proven that for a specific row where DISA's blob is empty, v1 holds
exactly `1900-01-01` — that needs the decoder, i.e. a real `compare-batch` run.
**If it is falsified, `allowDisaEmpty`'s real cause is still unknown and must be re-investigated —
do NOT keep the hatch on the strength of this section.**

**For the user's team, if it holds:** *"v1 encodes 'no date' as 1900-01-01; our gate read that as a
real date it couldn't explain, so it stopped checking the field. It wasn't a missing source — it was
a sentinel we hadn't decoded."*

</details>

### 3.4 Exceptions become evidence, not flags (D2)

Delete `allowDisaEmpty`. Replace with an explicit registry:

```
V2FieldException {
  field:     string
  reason:    string      // WHY v1 and V2 cannot agree
  evidence:  string      // the measurement/citation that PROVES it
  expected:  number      // the mismatch count we accept, so a REGRESSION still fails
}
```

⚠ **`expected` is what stops this becoming the next `allowDisaEmpty`.** A boolean forgives
*everything, forever*. A **count** forgives exactly what we measured and **fails when it grows**.

Known day-one entries (each needs `evidence` filled by measurement, not assertion):
- `taken_datetime` / `collected_datetime` — v1 has **no** separate column (it collapses to
  `SpecimenDateTime`). ⇒ compared only via `specimen_datetime`.
- `result_timestamp` — **v1 has NO per-result timestamp column at all.** ⚠ **I invented this field.**
  Its correct state is arguably "should not exist"; see §6.
- `source_payload` / `source_test_code` / `obx_set_id` — CDR-internal, no v1 counterpart.

### 3.5 What the gate REPORTS (D4)

Per-field, over a large sample: **match / mismatch / v2-empty-v1-present / v2-present-v1-empty**, and
**where a mismatch is systematic, the observed rule**.

**This is the point of the slice.** A field reporting *"v1.SpecimenDateTime matched V2.collected
97.1%, V2.taken 3%"* **derives** the mapping. That is precisely how `collected ?? taken` was found —
by measurement, after hours of me theorising.

⇒ **Run the report BEFORE fixing any stub.** The red is the inventory we have never had.

### 3.6 Scope (D3)

Every v1 column **except v1's own bookkeeping**: `DateTimeStamp`, `Versionstamp`,
`LIMSDateTimeStamp`, `LIMSVersionstamp` (CDR has no business reproducing v1's row stamps).

**Everything else is in**, including near-empty columns — `AdmitAttendDateTime` (1.6%),
`LIMSPreReg_*` (7.8%), `LIMSVendorCode` (7.8%), `DateTimeValue` (3.2%).
⚠ **Low population is a FACT to record, not a reason to skip: this laptop is 1 site of 22.** A column
at 7.8% here may be 90% elsewhere.

---

## 4. Testing

**Rule 7 — every assertion must be able to FAIL.** Name the mutation that reddens each.

| test | must fail when |
|---|---|
| the sentinel comparator: DISA empty ↔ v1 `1900-01-01` ⇒ **MATCH** | the normalisation is dropped |
| DISA empty ↔ v1 **a real date** ⇒ **MISMATCH** | ⚠ **vacuity guard** — a normaliser that treats *every* v1 date as empty would pass the row above |
| `V2.specimen_datetime === v1.SpecimenDateTime` strictly | the precedence regresses to `taken ?? collected` (**today's bug**) |
| a V2 field that is `null` while v1 is populated ⇒ **MISMATCH** | someone reintroduces a candidate array or an `allowDisaEmpty`-shaped escape |
| an exception with `expected: N` **fails at N+1** | `expected` is treated as "ignore" rather than "pin" |
| `abnormal_flag` (stubbed `null`) vs v1's 92.1% ⇒ **RED** | the gate is not actually reading `V2Result` |

⚠ **The last one is the acceptance test for the whole slice.** If a gate over a real batch does
**not** go red on `abnormal_flag`, **the gate is not looking at the export** — which is the entire
bug being fixed.

**Live proof — the only evidence that matters:**
```
node --import tsx src/index.ts compare-batch --limit 500 --summary-only
```
⚠ Run from `apps/cli`; `tsx` does not resolve from the repo root.
⚠ **`pnpm dev -- <cmd>` breaks commander's option parsing** — flags are silently ignored and defaults
used. Use `node --import tsx src/index.ts`.

**Expect a wall of red.** `analysis_at`/`authorised_at`/`result_status`/`authorised_by`/
`abnormal_flag`/`age_days`/`patient_class` are hardcoded `null` against v1 populations of **79–100%**.
**That is success, not failure** — it is the inventory.

---

## 5. Regression modes

- **The gate is added but reads `SpecimenRecpt` instead of the V2 payload** ⇒ green, blind, and we
  have rebuilt the original bug. **§4's `abnormal_flag` test is the guard.**
- **A candidate array creeps back** ⇒ "either wins" ⇒ the next inversion is invisible.
- **`expected` counts are set to today's mismatch without evidence** ⇒ `allowDisaEmpty` with extra
  steps. **Every exception needs `evidence`, not just a number.**
- **The sentinel normaliser is too broad** (treats any old date as empty) ⇒ silently matches real
  data against empties. §4's vacuity guard.
- **`specimen_datetime` added to V2 but FHIR still uses `taken ?? collected`** ⇒ the gate goes green
  while FHIR stays wrong — **the layer violation is exactly what allows this.** FHIR must map the new
  field.

---

## 6. Explicitly out of scope

- **Fixing any stub.** This slice **measures**. Each fix is its own slice, justified by the gate's
  report. *"once the mapping is good, everything else will fall in place."*
- **Decoding `TESTDATA_STATUS` bytes 0–79** (§2 root cause). Unlocks `authorised_at` (⇒ the real
  FHIR `issued`), `analysis_at`, `result_status`, `authorised_by`. **Its own slice**, and the gate
  will quantify the prize first. Prior art: `2026-07-16-disa-result-status-findings.md`.
- **`result_timestamp`'s existence.** v1 has no counterpart; I invented it. Whether V2 should carry
  it at all is a **design decision, not a mapping one**. Named, deferred.
- **The FHIR↔v1 layer.** Per D1, FHIR is pure reshaping ⇒ gating V2 suffices. ⚠ **That is only true
  if the reshaping stays pure** — §3.2 removes the one known violation. If field logic reappears in
  `fhir-transform`, this assumption breaks and layer 3 needs its own gate.
- **CE's projection (layer 4).** Separate repo, separate gate. ⚠ Real gaps exist:
  `clinical_info`, `icd10_codes`, `therapy`, facility codes and `referenceRange` have **no CE column**
  ([[cdr-v1-ce-field-mapping]] §4-5).

---

## 7. Known caveats

- ⚠ **1 site of 22.** Every population % is from this laptop's restore; the full dataset is on the
  user's **Linux desktop**. v1's 3.6M rows are the strongest evidence available here, but
  **re-measure before generalising nationally.**
- ⚠ **v1 is an oracle, not gospel.** It has its own migration quirks — the `1900-01-01` sentinel, and
  `DATESTAMP`'s 3 bulk-load days (**71,247 of 191,121 = 37%**, incl. **44,625 rows in a 3-hour
  window** on 2016-03-08). **A mismatch may be v1's defect.** That is what `evidence` on an exception
  is for — and why "100% or fail" needs the registry to stay honest.
- ⚠ **DISA stores BLOBS, not columns** ([[disa-stores-blobs-not-columns]]). Never verify a DISA fact
  with `select count(col)` — I built an entire wrong argument on `Taken_Date_Time` = 0.08% when the
  real value sits at **bytes 615-619**.
- **SKETCH — I have not read `compare-batch.ts` end to end**, only its options and description. The
  exact insertion point for a second field-def table is unverified.
- **SKETCH — `AgeInDays` / `HL7PatientClassCode` sources in DISA are unknown.** Only that v1 has them
  at 98.4% / 96.8%. The gate will say where they must come from.
