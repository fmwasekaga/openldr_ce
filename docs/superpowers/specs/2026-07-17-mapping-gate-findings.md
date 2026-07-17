# Mapping Gate Findings — the CDR export graded against v1

**Gate:** `cdr-toolchain` @ `4f087ef`, coverage guard green at **60/60** and **28/28** v1 columns.

**PRIMARY RUN — random sample (2026-07-17):**
```
compare-batch --where "abs(checksum([LabNo])) % 500 = 0" --limit 250 \
              --v2 --results --summary-only --country tanzania
211 labs selected | 158 graded (53 absent from v1) | 469 paired observations
```
**Superseded run — biased sample:** `--limit 200` → 195 graded, 1,487 obs. Kept only for contrast.

> **This report MEASURES. It fixes nothing.** Each fix is its own slice, justified from here.

---

## 0. ⛔ READ FIRST

### 0.1 Why the sample had to be re-drawn — and the proof it worked

`REGDAT4.LabNumbers` hardcodes `ORDER BY [LabNo] OFFSET n FETCH NEXT limit`
(`compare-batch.ts:202`), so **`--limit N` always returns the N numerically-lowest LabNos** — the
oldest records at one site. `--where` cannot reorder it, so the sample is drawn with a deterministic
spread instead: `abs(checksum([LabNo])) % 500 = 0` → **211 labs spanning `TDS0010710`–`TDS0138648`**
of the full `TDS0010001`–`TDS0139520` range. Reproducible, unlike `NEWID()`.

**Two independent confirmations that the first run was badly biased and this one is not:**

| | biased (200 oldest) | **random (211 spread)** | population |
|---|---|---|---|
| documentation rows excluded | **0** | **341** | 36.6% of TDS results |
| labs absent from v1 | 5/200 = **2.5%** | **53/211 = 25.1%** | **24%** DISA-only (spec §1) |

⇒ **The documentation-panel scope rule is now PROVEN on real data** — it fired 341 times. It was
unit-tested only before.
⇒ The random sample reproduces the known 24% DISA-only rate; the biased one under-reported it **10×**.

⚠ **Every number below is the RANDOM sample unless labelled otherwise.** Where the two disagree, the
biased one was wrong — and several did disagree materially (§4, §5).

### 0.2 Still true, and still limiting

- **TDS is 1 site of 22**, and v1 is multi-LIMS. Nothing here generalises to Zambia or Mozambique.
- **`only_v1` on a field CDR has no slot for means "CE does not model this", NOT "CDR loses data".**
  For `request_type` / `registered_by` / `ordering_notes` that is a **scope question**, not a bug.
  **Do not open fix slices from §4 without deciding scope first** — this is the `patient_class` trap
  in a new costume.
- **`abnormal_flag`'s denominator:** the graded population EXCLUDES documentation rows, so the
  comparable figure is **25.9%** (105,775 / 408,010), **not** the all-rows 16.7%.

---

## 1. The headline: the old gate cannot see any of this

On the **same 211 labs**, the DISA↔v1 gate reports:

```
156/211 labs perfect        835/864 observations match   (~96% green)
```

The V2↔v1 gate on the identical labs reports **`result_type` wrong on 469 of 469 (100%)**.
**That gap is the blind spot, measured.** The old gate grades the disalab *decoder*; nothing has ever
graded the *export*. Both samples agree on this: 100% wrong, twice.

---

## 2. The plan's five falsification checks — ALL HELD, on BOTH samples

Named in advance precisely so the run could refute the work. It did not — and the random sample is
the stronger test, because it is the one that could have broken them.

| check | predicted | biased | **random** | verdict |
|---|---|---|---|---|
| `abnormal_flag` red | **25.9%** (doc-excluded pop.) | 17.3% | **140/469 = 29.9%** | ✅ |
| `rpt_flag` red | ~1.3% | 1.9% | **10/469 = 2.1%** | ✅ |
| `patient_class` | **all match** | 195/195 | **158/158 match** | ✅ **not a defect** |
| `lims_facility_code` | **all match** | 195/195 | **158/158 match** | ✅ mapping proven |
| `obr_set_id` | **all only_v1** | 195/195 | **158/158 only_v1** | ✅ defect confirmed |

⚠ **The `abnormal_flag` prediction used the WRONG DENOMINATOR** — I wrote ~16.7%, which is
107,602/643,855 across **all** rows. But the gate excludes documentation rows, so the comparable
population is **105,775 / 408,010 = 25.9%**. Measured **29.9%**. ⇒ **consistent with 25.9%, and the
apparent "miss" against 16.7% was my arithmetic, not the gate.** The biased sample's 17.3% looked
closer to the wrong number purely by coincidence.

⇒ **The `''`-is-empty rule is correct on live data.** Had it broken, `abnormal_flag` would read
~100% and `rpt_flag` ~98%. Neither did, on either sample.

⇒ **`patient_class` and `lims_facility_code` are the load-bearing greens** — 158/158 each. Both were
queued as defects at some point. Both are correct. Green here is a **result**, not an absence of one.

---

## 3. Real export defects

### 3.1 Confirmed stubs — CDR hardcodes `null` against populated v1

**RANDOM sample — 158 labs / 469 paired observations.**

| field | v1 | CDR | measured |
|---|---|---|---|
| **`result_type`** | `HL7ResultTypeCode` | derived, wrong | **469 mismatch — 100%** |
| **`analysis_at`** | `AnalysisDateTime` 99.0% | `null` (`v2-transform:337`) | **158 only_v1 — 100%** |
| **`abnormal_flag`** | 25.9% (doc-excluded) | `null` (`:496`) | **140 only_v1 (29.9%)** |
| **`rpt_flag`** | `LIMSRptFlag` 1.3% | `null` (`:497`) | **10 only_v1 (2.1%)** |
| **`authorised_at`** | 91.2% | `null` (`:338`) | **149 only_v1 (94.3%)**, 9 greened by the conditional rule |
| **`authorised_by`** | 91.1% | — | **149 only_v1** |
| **`tested_by`** | `TestedBy` 96.4% | — | **81 MISMATCH + 70 only_v1** — see §5b |
| `age_years` | 93.4% | computed only when DOB + received exist | **105 only_v1**, 52 match |
| `age_days` | 93.4% | ditto | **105 only_v1, 37 mismatch**, 15 match |
| `result_value` | 98.5% | | **144 mismatch** (30.7%) |
| `rpt_range` | 16.7% | codebook string vs v1's numeric split | **114 only_v1, 28 mismatch** |
| `panel_code` | 100% | primary panel | **19 mismatch** — the multi-panel grain (§3.2) |

⚠ **`result_type` at 100% mismatch is the single biggest finding** — 469/469 here, 1,487/1,487 on the
biased sample. Every observation's type code disagrees, on every sample. The old gate called these
same observations ~96% matched.

⚠ **`authorised_at` shifted from 29 only_v1 (biased) to 149 (94.3%).** The conditional rule greened
**166** rows in the biased sample and only **9** here — i.e. the 200 oldest labs were ~85%
NON-FINAL, while the random sample is **94.3% final**, matching the measured population (F = 90.6%).
**A third proof of the bias** — and consistent with the oldest LabNos being `INSTRUMENT VALIDATION`
QC records, which are never finalised.

### 3.1b ⛔ NEW — `detectDisaRejection` appears to fire on 89% of labs; v1 says 0.6%

`result_status` on the random sample: **1 match / 141 MISMATCH / 16 only_v1**.

CDR emits `result_status: rejection.rejected ? "X" : null` (`v2-transform.ts:350`) — the **only**
non-null value it can produce is `"X"`. So **141 mismatches mean CDR called 141 of 158 labs rejected
(89%)** while v1 records them as `F`. And on the same labs `rejection_code` is **157/158 match (both
empty)** — **v1 recorded an actual rejection on ONE lab.**

⇒ **`detectDisaRejection` is a massive false-positive**, and it is not cosmetic: a rejected request
means "no result" to downstream consumers, and it changes `panel_code` sourcing
(`v2-transform.ts:283-287`).

**DIAGNOSED — the detector contradicts its own comment** (`compare/result-mapping.ts:647-670`):

```ts
// RJREA is the coded reject REASON ... — the meaningful signal. RJREM is a free-text
// remark that is frequently padding ("F"), so it is only a fallback for the reason text.
   ...
const rejected = condition !== null || reasons.size > 0 || memos.size > 0;
//                                                         ^^^^^^^^^^^^^^ RJREM
```

The comment states RJREM is **frequently padding (`"F"`)** and therefore **"only a fallback for the
reason TEXT"**. The code then makes `memos.size > 0` a **rejection TRIGGER**. ⇒ **any lab whose RJREM
is padded is marked rejected.** The author identified the exact hazard in prose and then fell into
it one line later.

⚠ **`s.Condition` is the other candidate** — any non-empty `Condition` also triggers. **Which of the
two dominates is NOT yet measured**, so the fix slice must count `RJREM`-padding vs `Condition`
before changing the predicate. The mechanism is confirmed; the proportions are not.

⚠ The biased sample showed only 10 mismatches (5%) vs 141 (89%) here — **another field the old
sample would have let through.**

### 3.2 `obr_set_id` — CDR cannot represent a multi-panel request

**195/195 `only_v1`.** `V2LabRequest` has no `obr_set_id`; v2's contract does
(`02-openldr_external.sql:276`, `UNIQUE (request_id, obr_set_id, facility_id)`), and ingest pins it
`?? 1` (`external-persistence.service.ts:632`). **61.2% of TDS requests carry 2+ panels.**
⚠ **The fix MUST emit `obr_set_id`.** Emitting one record per panel without it is *worse than the
bug*: all panels collide on `(request_id, 1, facility_id)` and `ON CONFLICT DO UPDATE` silently
overwrites.

### 3.3 `testing_facility_code` — 195/195 MISMATCH: CDR names the WRONG FACILITY

⚠ **CORRECTED 2026-07-17. An earlier version of this section called this "a gate bug — fix the def
before reporting it upstream". THAT WAS WRONG, and acting on it would have deleted a real defect by
weakening the gate — the `allowDisaEmpty` pattern exactly.** Checked before "fixing" it:

| | |
|---|---|
| `DEFAULT_SITE` | **only coding-system ids** (`site-config.ts:30-38`) — there is **no lab code in it**, which is what the wrong call assumed |
| `config.ts` | no site/lab code either |
| `buildFacilityConcept` | uses `facility.Code` — **the REQUESTING clinic** |
| proof it is the clinic | **`lims_facility_code` matched 195/195** against that same concept, and v1's `LIMSFacilityCode` is the requesting facility |

**Measured across ALL TDS requests:**
```
TestingFacilityCode 'TDS' : 172,092 rows (98.8%)   <- ONE constant: the lab
                       '' :   2,169 rows (1.2%)
distinct requesting facilities (LIMSFacilityCode) : 3,349
```
⇒ **One testing lab serving 3,349 requesting clinics.** CDR puts **one of the 3,349 clinics** into
the `testing_facility_code` slot. v2 *has* that slot; CDR fills it with the wrong facility.

⚠ **The code comment that caused this has the relationship BACKWARDS**
(`v2-transform.ts:316-321`): *"DISA doesn't carry a separate requesting-facility code distinct from
the testing lab… Emit the same concept for both; v2 consumers can infer requesting == testing from
the equality."* **DISA carries the REQUESTING facility.** The **testing lab is the DISA instance
itself** — which is precisely why v1 has `TDS` and `DEFAULT_SITE` does not. And v1 proves the two are
distinct: it stores both, differently, on every row.

⇒ **The def is CORRECT. The export is wrong. `requesting_facility_code` matching 195/195 is not
evidence the def is broken — it is evidence CDR emits the clinic in both slots.**

**The fix (its own slice):** the testing facility is a property of the DISA *deployment*, not of any
record — one instance is one lab. So it belongs in `SiteConfig` (e.g. `testing_facility_code: "TDS"`),
**not** derived from the LabNo prefix. ⚠ Do **not** infer it from `LabNumber.slice(0,3)`: that is an
undocumented coincidence of this site's numbering, and CDR must run in Zambia and Mozambique.

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

## 5. D4 — `collected_datetime ↔ SpecimenDateTime`: read the SHAPE, not the rate

⚠ **My third call on this field, and the first two were both driven by sample artefacts.** The rate
is wildly unstable; the **shape** is not, and the shape is the finding:

| sample | match | **mismatch** | only_v1 | my call at the time |
|---|---|---|---|---|
| 20 labs | 2 = 10% | **0** | 18 | *"looks falsified"* ❌ |
| 195 oldest | 174 = 89.2% | **0** | 21 | *"prediction holds, do not re-open"* ❌ |
| **211 random** | **88 = 55.7%** | **0** | **70 = 44.3%** | see below |

⇒ **`mismatch` is ZERO on all three samples.** When DISA has a `CollectedDateTime`, it **always**
equals v1's `SpecimenDateTime` — 0 disagreements in 264 comparisons across three samples.
**`collected` is never WRONG; it is often ABSENT.**

⇒ **That CONFIRMS `SpecimenDateTime = collected ?? taken`**, which is what D4 actually claimed. The
def deliberately tests `collected` **alone** (strict, no candidate array), so the `only_v1` column is
not a defect — **it is a direct measurement of the fallback rate: 44.3%.** v1 fell back to `taken` on
70 of 158 requests.

⚠ **Both of my earlier verdicts were wrong for the same reason: I read the match RATE off one sample
and pronounced.** The rate moves 10% → 89.2% → 55.7% depending on which labs you draw. The
zero-mismatch shape held every time and was the real signal from the start.

⇒ **Actionable:** the fallback is **44.3%**, not the ~11% the biased run implied. Any fix to
`effectiveDateTime` (`fhir-transform:184`, currently inverted) must implement `collected ?? taken`
— **on nearly half the corpus the fallback IS the value.**

---

## 5b. What the biased sample HID — and one defect it hid entirely

| field | biased (195) | **random (158)** | what changed |
|---|---|---|---|
| **`tested_by`** | 1 match / **0 mismatch** / 194 only_v1 | 7 match / **81 MISMATCH** / 70 only_v1 | ⛔ **81 real disagreements appeared from nothing.** CDR emits a `tested_by` that CONTRADICTS v1 on 51% of labs. The biased sample showed **zero**. **A new defect, invisible before.** |
| `ordering_notes` | 26 match / 169 only_v1 | **0 match / 158 only_v1** | 100% — the 26 "matches" were empty-vs-empty in old records |
| `analyzer_code` | 175 match / 20 only_v1 | **67 match / 91 only_v1 (57.6%)** | the biased run implied ~10% populated; the real rate tracks the measured 44.9% |
| `vendor_code` | 192 / 3 | **120 / 38 (24.1%)** | tracks the measured 26.6% |
| `collection_volume` | **195 match / 0** | **136 / 22 (13.9%)** | biased run said "always empty" — it is not |
| `section_code` | 0 / 14 mismatch / 181 | **0 / 119 mismatch / 39** | mostly MISMATCH, not absence |
| `numeric_value` | 1,083 only_v1 (72.8%) | **321 only_v1 (68.4%)** | consistent — the big one is real |
| `obx_sub_id` | 336 mismatch (22.6%) | **56 mismatch (11.9%)** | halved, still real |

⚠ **`tested_by` is the lesson.** A field showing **0 mismatches** on 195 labs showed **81** on 158.
Absence of a signal in a biased sample is not evidence of absence — and it is exactly the kind of
false green that would have shipped.

⇒ **`si_coded_value` and `result_semiquantitive` scored IDENTICALLY again** (430 match / 39 only_v1,
both). **Third independent observation** of that correlation. Still not a mapping — it says they
travel together, not what either means.

---

## 6. What this run CANNOT see

1. **Typed patient identifiers** — DISA `NID` is 0/40. Only a registry country exercises them.
2. **Any `not_carried` column** (25 of 88) — by decision, not by measurement.
3. **Any site but TDS** — 1 of 22, and v1 is multi-LIMS.
4. **Whether the 53 DISA-only labs (25.1%) matter** — v1 never ingested them; they are v1's scope
   gap, not CDR's, and nothing here grades them.

✅ **Resolved since the first run:** the documentation-panel scope rule is proven (341 exclusions),
and the sample bias is gone.

---

## 7. Recommended next slices, in blast-radius order

1. **`testing_facility_code`** (§3.3) — CDR names the requesting clinic as the testing lab, on
   **195/195**. Add `testing_facility_code` to `SiteConfig`; do **not** derive it from the LabNo.
   ⚠ **This was listed here as "fix the DEF — a gate bug". That was WRONG** (see §3.3): the def is
   correct and the export is not. **Fixing the def would have deleted the finding.**
2. **`result_type`** (§3.1) — **469/469 wrong (100%)**, on both samples, invisible to the old gate.
3. **`detectDisaRejection`** (§3.1b) — CDR calls 89% of labs rejected; v1 says 0.6%. **DIAGNOSED**: `rejected` includes `memos.size > 0` while the comment two lines up says RJREM is padding and should only supply reason TEXT. ⚠ Measure RJREM-padding vs `Condition` before changing the predicate.
4. **`tested_by`** (§5b) — **81 mismatches (51%)**, and the biased sample showed **zero**. CDR
   contradicts v1, it does not merely omit. **Newly visible; not diagnosed.**
5. **`obr_set_id`** (§3.2) — 61.2% of requests; must emit the column, not just split records.
6. **Investigate `numeric_value`** (§3.5) — **68.4% only_v1**, undiagnosed, the largest volume.
7. **`abnormal_flag`** (§3.1) — the original driver; **29.9%** (vs a 25.9% doc-excluded population),
   real, and blocks the two AMR reports.
8. **`effectiveDateTime` = `collected ?? taken`** (§5) — the fallback fires on **44.3%**, not the
   ~11% the biased run implied. `fhir-transform:184` is currently inverted.

✅ **Done:** re-run on a random sample (was #3 in the first draft). It changed §5, §5b and the
`abnormal_flag` denominator, and it proved the scope rule.
