# Mapping Gate Findings — the CDR export graded against v1

**Run:** `compare-batch --limit 200 --v2 --results --summary-only --country tanzania`, 2026-07-17.
**Sample:** 200 labs selected; **195 graded** (5 absent from v1), **1,487 paired observations**.
**Gate:** `cdr-toolchain` @ `a6d15bd`, coverage guard green at **60/60** and **28/28** v1 columns.

> **This report MEASURES. It fixes nothing.** Each fix is its own slice, justified from here.

---

## 0. ⛔ READ FIRST — three things that would make this report lie

**1. The sample is BIASED, and not mildly.** `REGDAT4.LabNumbers` selects
`ORDER BY [LabNo] OFFSET 0 ROWS FETCH NEXT 200` — **the 200 numerically-first lab numbers**, i.e.
the oldest records at one site. Proof it is not representative: **`v1_results_documentation_excluded`
came back `0`**, yet `VLID`+`EIDID` are **235,845 of 643,855 TDS result rows (36.6%)** overall. A
representative 200-lab sample would contain ~70 of them. **It contains none.**
⇒ **Every percentage below is "the first 200 labs of TDS", NOT "TDS", and certainly not "DISA".**
⚠ The documentation-panel scope rule is therefore **still unproven on real data** — unit-tested only.

**2. TDS is 1 site of 22**, and v1 is multi-LIMS. Nothing here generalises to Zambia or Mozambique.

**3. `only_v1` on a stubbed field means "CDR emits nothing", NOT "CDR loses data".** For
`request_type` / `registered_by` / `ordering_notes` etc. CDR has **no such field at all** — that is a
scope question for CE, not a bug to fix. **Do not open fix slices from section 3 without deciding
scope first.** This is the `patient_class` trap in a new costume.

---

## 1. The headline: the old gate cannot see any of this

On the **same 195 labs**, the DISA↔v1 gate reports:

```
195/195 labs perfect        1,518/1,519 observations match
```

The V2↔v1 gate on the identical labs reports **`result_type` wrong on 1,487 of 1,487 (100%)**.
**That gap is the blind spot, measured.** The old gate grades the disalab *decoder*; nothing has ever
graded the *export*.

---

## 2. The plan's five falsification checks — ALL HELD

The plan named these in advance precisely so the run could refute the work. It did not.

| check | predicted | measured | verdict |
|---|---|---|---|
| `abnormal_flag` red | ~16.7% | **257/1,487 = 17.3%** | ✅ |
| `rpt_flag` red | ~1.3% | **29/1,487 = 1.9%** | ✅ |
| `patient_class` | **all match** | **195/195 match** | ✅ **not a defect** |
| `lims_facility_code` | **all match** | **195/195 match** | ✅ mapping proven |
| `obr_set_id` | **all only_v1** | **195/195 only_v1** | ✅ defect confirmed |

⇒ **The `''`-is-empty rule is correct on live data.** Had it been broken, `abnormal_flag` would read
~100% and `rpt_flag` ~98.7%. Both landed within a point of the predicted population.

⇒ **`patient_class` and `lims_facility_code` are the load-bearing greens.** Both were fields I had
—or the spec had— queued as defects. Both are correct. Green here is a **result**, not an absence
of one.

---

## 3. Real export defects

### 3.1 Confirmed stubs — CDR hardcodes `null` against populated v1

| field | v1 | CDR | measured (195 labs / 1,487 obs) |
|---|---|---|---|
| **`result_type`** | `HL7ResultTypeCode` | derived, wrong | **1,487 mismatch — 100%** |
| **`analysis_at`** | `AnalysisDateTime` 99.0% | `null` (`v2-transform:337`) | **195 only_v1 — 100%** |
| **`abnormal_flag`** | `HL7AbnormalFlagCodes` 16.7% | `null` (`:496`) | **257 only_v1 (17.3%)** |
| **`rpt_flag`** | `LIMSRptFlag` 1.3% | `null` (`:497`) | **29 only_v1 (1.9%)** |
| `result_status` | `HL7ResultStatusCode` 100% | `"X"` only when rejected (`:350`) | **184 only_v1, 10 mismatch, 1 match** |
| `tested_by` | `TestedBy` 96.4% | — | **194 only_v1** |
| `age_years` / `age_days` | 93.4% | computed only when DOB+received exist | **183 only_v1 each; age_days 11 mismatch** |
| `authorised_at` | 91.2% | `null` (`:338`) | **29 only_v1** — the conditional rule correctly greened **166** non-final rows |
| `authorised_by` | 91.1% | — | **31 only_v1** |

⚠ **`result_type` at 100% mismatch is the single biggest finding.** Every observation's type code
disagrees. The old gate called these same 1,519 observations 1,518/1,519 matched.

### 3.2 `obr_set_id` — CDR cannot represent a multi-panel request

**195/195 `only_v1`.** `V2LabRequest` has no `obr_set_id`; v2's contract does
(`02-openldr_external.sql:276`, `UNIQUE (request_id, obr_set_id, facility_id)`), and ingest pins it
`?? 1` (`external-persistence.service.ts:632`). **61.2% of TDS requests carry 2+ panels.**
⚠ **The fix MUST emit `obr_set_id`.** Emitting one record per panel without it is *worse than the
bug*: all panels collide on `(request_id, 1, facility_id)` and `ON CONFLICT DO UPDATE` silently
overwrites.

### 3.3 `testing_facility_code` — 195/195 MISMATCH, and it is NOT a stub

CDR emits DISA's facility concept; v1's `TestingFacilityCode` is `'TDS'` — **the lab, not the
requesting facility**. CDR carries the *same* concept for both `requesting_facility_code` and
`testing_facility_code` by design (`v2-transform.ts:316-321`: *"DISA doesn't carry a separate
requesting-facility code distinct from the testing lab"*).
⇒ **The comparator is wrong, not the export**: `requesting_facility_code` matches 195/195 while
`testing_facility_code` mismatches 195/195 **on the same value**. v1's testing facility is the site
code, and CDR has it — in `DEFAULT_SITE`, not in the facility concept. **Fix the def before
reporting this upstream.**

### 3.4 `rejection_code` / `rejection_desc` — real, but rare here

**1 of 195 `only_v1`.** The sample holds one rejected request; TDS overall has 4,518 (2.6%). CDR runs
`detectDisaRejection` and carries only `result_status="X"`, dropping the code and reason. **Small
here, real at scale — and never graded until now.**

### 3.5 `numeric_value` — 1,083 of 1,487 `only_v1` (72.8%)

v1 has `SIValue` where CDR emits no `numeric_value`. **The largest single volume of red in the run**
and it was **not** predicted. `numeric_value` is only populated for DISA type-codes 1/2
(`isNumericTypeChar`), so CDR is likely typing far fewer observations as numeric than v1 did. ⚠ **Not
diagnosed — needs its own investigation** before any fix.

### 3.6 `obx_sub_id` — 336 of 1,487 mismatch (22.6%)

CDR hardcodes `obx_sub_id: 0` (*"Always 0 for DISA — DISA OrderItems are flat"*,
`types.ts:64-66`). v1 disagrees on 336 rows. **Either the comment is wrong or v1's migration
invented sub-ids.** Unresolved.

---

## 4. Scope questions, NOT defects

CDR has **no field at all** for these. `only_v1` here means *"CE does not model this"*, and whether it
should is a **decision**, not a bug.

| field | v1 | measured |
|---|---|---|
| `request_type` | `RequestTypeCode` 100% (`D`/`E`) | 195 only_v1 |
| `registered_by` | `RegisteredBy` 99.8% | 195 only_v1 |
| `ordering_notes` | `OrderingNotes` 98.5% (numeric codes) | 169 only_v1 |
| `analyzer_code` | `LIMSAnalyzerCode` 44.9% | 20 only_v1 (sample skew: only 10% populated here) |
| `vendor_code` | `LIMSVendorCode` 26.6% | 3 only_v1 |
| `si_lo_range` / `si_hi_range` | numeric range | 101 / 121 only_v1 |
| `si_coded_value` | `CodedValue` 7.7% | 14 only_v1 |

⚠ **`collection_volume` scored 195/195 match** — every row in this sample is `0`, v1's empty
convention. It is 20.9% populated at TDS overall. **The sample hid it entirely.**

### 4.1 `result_semiquantitive` — the hypothesis is now evidence

`result_semiquantitive` and `si_coded_value` scored **identically: 1,473 match / 14 only_v1**. They
co-occur exactly, as the 49,409-vs-49,410 population counts suggested. **That is now two independent
observations of the same correlation** — consistent with a `<` / `>` qualifier attached to a coded
value. ⚠ **Still not a mapping.** It says they travel together, not what either means.

---

## 5. D4 — `collected_datetime ↔ SpecimenDateTime`: the prediction SURVIVES

| sample | match rate |
|---|---|
| 20 labs (T6) | **2/20 = 10%** ⇒ looked falsified |
| **195 labs (this run)** | **174/195 = 89.2%** ⇒ **prediction holds** |

⚠ **I reported after the 20-lab run that D4 "looks falsified". That was wrong, and the error was
sample size, not the mapping.** The plan's instruction — *"if it is not ~97%, the fix slice must
follow the data"* — cuts both ways: the data now says `collected` is right. **Do not re-open D4.**

The residual **21 `only_v1`** are requests where DISA's `CollectedDateTime` is empty and v1 still has
a `SpecimenDateTime` — the `collected ?? taken` precedence question, at ~11%, not ~90%.

---

## 6. What this run CANNOT see

1. **Documentation panels** — `v1_results_documentation_excluded: 0`. The 36.6% scope rule never
   fired. **Unproven on real data.**
2. **Typed patient identifiers** — DISA `NID` is 0/40. Only a registry country exercises them.
3. **Any `not_carried` column** (25 of 88) — by decision, not by measurement.
4. **Any site but TDS** — 1 of 22.
5. **`collection_volume`, `analyzer_code` at their real rates** — the sample skews them to ~0.

---

## 7. Recommended next slices, in blast-radius order

1. **Fix the `testing_facility_code` DEF** (§3.3) — a gate bug producing 195/195 false red. **Do this
   before anyone reads section 3 as an export defect.**
2. **`result_type`** (§3.1) — 100% wrong, invisible to the old gate.
3. **Re-run T7 on a RANDOM sample** (§0) — every number here is drawn from the 200 oldest labs.
   Until then this is an inventory of one corner of one site.
4. **`obr_set_id`** (§3.2) — 61.2% of requests; must emit the column, not just split records.
5. **Investigate `numeric_value`** (§3.5) — 72.8% red, undiagnosed.
6. **`abnormal_flag`** (§3.1) — the original driver; 17.3%, real, and blocks the AMR reports.
