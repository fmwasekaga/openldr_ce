# CDR ↔ v1 ↔ CE — the field mapping

**Date:** 2026-07-17
**Status:** Measured against live DISA + live v1 + live CE. **BLOCKS the timestamps slice.**
**Why:** *"v1 was populated by disalab's tool so it means the data must exist in CDR somewhere."* — the user.

---

## 0. The method (and why it beat everything else I tried)

**v1 (`OpenLDRData`) is the ORACLE.** It was populated from the same DISA by DISA's own tooling.
⇒ **every populated v1 column is PROOF the data exists in DISA and CDR can reach it.**

Scale: **`Requests` = 3,602,986 rows. `LabResults` = 11,597,899 rows.**

I spent hours theorising which field *ought* to be the collection time. v1 had answered it 3.5
million times. **Ask the oracle first.**

---

## 1. ⛔ THE ROOT CAUSE — CDR discards the per-panel status header

`cdr-toolchain packages/disalab/src/lib/DisalabData/TESTDATA.ts:39`:
```ts
Core.FixString(_data, 80, _data.length).trim()   // <-- parses from byte 80 ONWARD
```

**`TESTDATA_STATUS` bytes 0–79 are NEVER DECODED.** That header carries the **per-OBR** status and
timing. Confirmed by a prior probe (`2026-07-16-disa-result-status-findings.md`):
- bytes **77–79** = reviewer initials ⇒ `F`/`R` (**98.99%** on 168k panels)
- **`uint16LE` at offset 23 is a YEAR**, read only on reviewed panels
- *"The exact byte layout of the review timestamp at **~21–26** is **not fully decoded** … **Needs
  work before `authorised_at` can be populated from it**."*
- *"`packages/disalab`'s `TESTDATA` decoder reads **only from offset 80 onward**"*

**⇒ ONE root cause explains most of the losses below.** v1 decodes this header; CDR throws it away.

**Proof it's per-OBR** — v1 for `TZDISATDS0123369`:
```
OBR1: analysis=2018-06-29 10:37 | authorised=2018-06-29 11:06 | status=F
OBR2: analysis=2018-06-29 11:00 | authorised=2018-06-29 11:06 | status=F
OBR3: analysis=2018-07-02 10:29 | authorised=2018-07-02 10:42 | status=F   <- the MSENS (AST)
```
`REGDAT4` is **per-request**, so a per-OBR time cannot come from there. It is in `TESTDATA_STATUS`.

---

## 2. ⛔ THE INVERSION — `effectiveDateTime` reads the wrong field

**`fhir-transform.ts:184` uses `lr.taken_datetime ?? lr.collected_datetime`. v1 uses the OPPOSITE
precedence.** Measured — v1's `SpecimenDateTime` vs CE's `Specimen.collection.collectedDateTime`:

| Request | v1 `SpecimenDateTime` | CE `collectedDateTime` | CE `taken` (via `dx.effective`) |
|---|---|---|---|
| TDS0010015 | 13:30 | **13:30** ✅ | 14:15 ✗ |
| TDS0120443 | 10:00 | **10:00** ✅ | 12:00 ✗ |
| TDS0123369 | 09:00 | **09:00** ✅ | 14:00 ✗ |
| TDS0118330 | **2018-05-18** | *(none)* | *(none)* — v1 fell back to `RTKNIDX5` |

**3 of 3 exact matches on `collected`.** DISA holds BOTH; they differ by up to **5 hours**.

⇒ **v1's rule: `SpecimenDateTime = CollectedDateTime ?? TakenDateTime (incl. the RTKNIDX5 fallback)`.**
⇒ `Observation.effectiveDateTime` AND `DiagnosticReport.effectiveDateTime` (`:184`) must follow it.
**`:184` is wrong today** — and I had been treating it as the reference to copy.

---

## 3. ⛔ THE SILENT FALLBACK BUG — `RTKNIDX5` has NEVER worked

`specimenrecpt.ts:235`: `r.TakenDateTime = rtknidx5[0]!.TAKENDATE as string | null;`
`TAKENDATE` is a SQL `datetime` ⇒ the driver returns a **`Date`**; `as string` is a **compile-time
cast only**. Then:

```
disaToIso(Date) => "Fri May 18 2018 03:00:00 GMT+0300 (East Africa Time)"
   -> fhirDateTime() matches no branch -> undefined -> field SILENTLY DROPPED
```

⚠ **`nz()`'s own comment names the hazard and causes it** (`v2-transform.ts:28-31`):
> *"mssql / disalab can return Date or numeric values for fields typed as string … **Coerce
> defensively so downstream helpers (.trim, regex matches) don't blow up mid-export**."*

**It was written to prevent a CRASH. It succeeded — by converting a crash into silent data loss.**

**Proof it matters:** v1 gets `SpecimenDateTime` for **97.1% of 3.6M**. `RTKNIDX5` is **106,212 rows,
100% populated**. TDS0118330 has `TAKENDATE=2018-05-18`; v1 has it; **CE has NULL**.

⚠ `TAKENDATE` is **date-only (midnight)** ⇒ the fix must emit **`"2018-05-18"`**, NEVER
`"2018-05-18T00:00:00+03:00"` — fabricating a collection *time* is the error we are removing.

---

## 4. THE MAPPING — request level

`V2LabRequest` (`apps/cli/src/export/types.ts:30-60`) is already **v1-shaped**. The fields exist;
several are **stubbed**.

| DISA source | v1 column (pop.) | CDR `V2LabRequest` | CE FHIR | CE column | verdict |
|---|---|---|---|---|---|
| `REGDAT4` blob `CollectedDatetime` (159-165) | **`SpecimenDateTime` (97.1%)** | `collected_datetime` ✅ `:351` | `Specimen.collection.collectedDateTime` | ⚠ **NOT PROJECTED** | ⛔ **§2 inversion + CE drops it** |
| `REGDAT4` blob `TakenDateTime` (615-619) → `RTKNIDX5.TAKENDATE` | *(v1's fallback)* | `taken_datetime` ⚠ `:350` | `DiagnosticReport.effectiveDateTime` | `diagnostic_reports.effective` | ⛔ **§3 fallback dead** |
| `REGDAT4` blob `ReceivedInLab ?? Registered` | `ReceivedDateTime` (95.8%) | `received_at` ✅ `:352` | `Specimen.receivedTime` | `specimens.received_time` | ✅ OK |
| `REGDAT4` blob `RegisteredDatetime` (126-134) | `RegisteredDateTime` (100%) | `registered_at` ✅ `:353` | `ServiceRequest.authoredOn` | `lab_requests.authored_at` | ✅ OK |
| **`TESTDATA_STATUS` ~21-26** | **`AnalysisDateTime` (84.7%)** | **`analysis_at: null`** `:354` | — | — | ⛔ **STUB** — comment claims *"disalab doesn't expose"*; **v1 proves it exists** |
| **`TESTDATA_STATUS` ~21-26** | **`AuthorisedDateTime` (79.6%)** | **`authorised_at: null`** `:355` | *(would be `Observation.issued`)* | — | ⛔ **STUB** — **this is the REAL `issued`, not `DATESTAMP`** |
| **`TESTDATA_STATUS` 77-79** | **`AuthorisedBy` (100%)** | **`authorised_by: null`** `:377` | — | — | ⛔ **STUB** (initials ARE decodable — 98.99%) |
| **`TESTDATA_STATUS` 77-79** | **`HL7ResultStatusCode` (96.8%)** | **`result_status`: `X`-or-null** `:369` | `DiagnosticReport.status` | `diagnostic_reports.status` | ⛔ **STUB** — only rejection works |
| ? | **`HL7PatientClassCode` (96.8%)** | **`patient_class: null`** `:363` | — | — | ⛔ **STUB** |
| ? | **`AgeInDays` (98.4%)** | **`age_days: null`** `:361` | — | — | ⛔ **STUB** |
| `REGDAT4` | `AgeInYears` (98.4%) | `age_years` ⚠ computed `:360` | `Patient.birthDate` | `patients.date_of_birth` | ⚠ derived, not read |
| `REGDAT4` | `HL7SexCode` (100%) | `sex` ✅ | `Patient.gender` | `patients.sex` | ✅ OK |
| `REGDAT4` | `ClinicalInfo` (96.9%) | `clinical_info` ✅ `:356` | ? | ⚠ **no CE column** | ⚠ lost at CE |
| `REGDAT4` | `ICD10ClinicalInfoCodes` (96.9%) | `icd10_codes` ✅ `:357` | ? | ⚠ **no CE column** | ⚠ lost at CE |
| `REGDAT4` | `Therapy` (96.9%) | `therapy` ✅ | ? | ⚠ **no CE column** | ⚠ lost at CE |
| `REGDAT4` | `HL7PriorityCode` (100%) | `priority` ✅ | `ServiceRequest.priority` | `lab_requests.priority` | ✅ OK |
| `REGDAT4` | `HL7SectionCode` (96.8%) | `section_code` ✅ `:364` | — | — | ⚠ used internally |
| `REGDAT4` | `RequestingFacilityCode` (99.8%) | `requesting_facility_code` ✅ | `ServiceRequest.requester.display` | ⚠ **no facility column** | ⚠ lost at CE |
| `REGDAT4` | `TestingFacilityCode` (100%) | `testing_facility_code` ✅ | ? | ⚠ **no CE column** | ⚠ lost at CE |
| `REGDAT4` | `LIMSRejectionCode/Desc` (96.8%) | *(drives `result_status='X'`)* | — | — | ✅ partial |
| — | `LOINCPanelCode` (96.9%) | `panel_code` ✅ | `ServiceRequest.code` | `lab_requests.panel_code` | ✅ OK |

## 5. THE MAPPING — result level

`v1.LabResults` = **11,597,899 rows**.

| v1 column (pop.) | CDR `V2Result` | CE FHIR | CE column | verdict |
|---|---|---|---|---|
| `LIMSObservationCode/Desc` (100%) | `observation_code` ✅ | `Observation.code` | `lab_results.observation_code/_desc` | ✅ OK |
| `LOINCCode` (92.1%) | *(via codebook)* | `code.coding[0]` | — | ✅ OK |
| **`HL7AbnormalFlagCodes` (92.1%)** | **`abnormal_flag: null`** `:514` | `Observation.interpretation` | `lab_results.abnormal_flag` | ⛔ **STUB — 92% of ~10.7M flags LOST.** CE has 31, via the isolate path only |
| **`LIMSRptFlag` (91.8%)** | **`rpt_flag: null`** `:516` | — | — | ⛔ **STUB** |
| `CodedValue`/`LIMSCodedValue` (92.1%) | `coded_value` ✅ | `valueCodeableConcept` | `lab_results.coded_value` | ✅ OK |
| `SIValue` (99.8%) | `numeric_value` ✅ | `valueQuantity.value` | `lab_results.numeric_value` | ✅ OK |
| `SIUnits` (92.2%) | `numeric_units` ✅ | `valueQuantity.unit` | `lab_results.numeric_units` | ✅ OK |
| `SIHiRange`/`SILoRange` (99.8%) | `rpt_range` ⚠ | `referenceRange` | ⚠ **no CE column** | ⚠ lost at CE |
| `LIMSRptResult` (100%) | `result_value` ✅ | `valueString` | `lab_results.text_value` | ✅ OK |
| `HL7ResultTypeCode` (99.7%) | `result_type` ✅ | *(derived)* | `lab_results.result_type` | ✅ OK |
| `Note` (100%) | ⚠ **no V2 field** | — | — | ⚠ **not carried** |
| `ResultSemiquantitive` (99.7%) | ⚠ **no V2 field** | — | — | ⚠ **not carried** |
| `OBXSetID` (100%) | `obx_set_id` ✅ | — | — | ✅ OK |
| `DateTimeValue` (**3.2%**) | *(value-typed)* | — | — | ✅ = OrderItem type 7/8 (a result whose VALUE is a date) |
| **⛔ NO per-result timestamp column EXISTS in v1** | `result_timestamp` ← `DATESTAMP` (T2) | `Observation.effectiveDateTime` | `lab_results.result_timestamp` | ⛔ **I INVENTED THIS.** v1 has no equivalent. |

---

## 6. ⛔ What this overturns in my own specs

| I claimed | Reality |
|---|---|
| *"`issued` ← `TESTDATA.DATESTAMP` (a release time)"* | **FALSE.** The real release time is **`AuthorisedDateTime`** (79.6%), in the **undecoded** blob header. `DATESTAMP` is a row-write stamp — for `TZDISATDS0123369`'s MSENS it lands **25 min AFTER** `AuthorisedDateTime`, and **37%** of `DATESTAMP`s are bulk-load artifacts (44,625 rows in a 3-hour window). |
| *"`fhir-transform:184` is the reference to copy"* | **FALSE.** `:184` has the **inversion** (§2). It is wrong today. |
| *"`abnormal_flag` is a separate stub, out of scope"* | **Technically true, materially wrong.** It is the **single largest loss**: 92.1% of 11.6M rows. |
| *"DISA has no per-result timestamp"* | **TRUE** — and v1 confirms it (no such column). The mistake was **substituting** `DATESTAMP` rather than concluding the field should be absent. |
| *"the timestamp is the bug"* | **It is ONE of ~8 stubs**, most sharing **one root cause** (§1). |

---

## 7. Recommended sequencing

1. **Fix the inversion (§2)** — `collected ?? taken`, in BOTH `:184` and the Observation. Cheap,
   high-value, no blob work. **v1-verified.**
2. **Fix the `RTKNIDX5` fallback (§3)** — Date-shape branch, emit **date-only**. Recovers the
   collection date where both blob fields are empty. **v1-verified** (97.1%).
3. **Decode `TESTDATA_STATUS` bytes 0–79** — its own slice. Unlocks `authorised_at` (⇒ the REAL
   `issued`), `analysis_at`, `result_status`, `authorised_by`, and plausibly `abnormal_flag`.
   Prior art: `2026-07-16-disa-result-status-findings.md` (year at offset 23; initials at 77-79).
4. **`abnormal_flag`** — biggest single win (92.1% of 11.6M). Confirm whether it is in the header or
   the OrderItem payload before scoping.
5. **CE-side gaps** — `clinical_info`, `icd10_codes`, `therapy`, facility codes, `referenceRange`
   have **no CE column**. Separate decision: does CE's read model want them?

---

## 8. Caveats

- **1 site of 22.** All population % are from this laptop's restore. The full dataset is on the
  user's Linux desktop. v1's 3.6M rows are the strongest evidence here, but re-measure before
  generalising nationally.
- `RTKNIDX5.TAKENDATE` is **date-only** — any fix must NOT fabricate midnight (§3).
- I have **not** verified where `AgeInDays`/`HL7PatientClassCode` live in DISA — only that v1 has
  them at 98.4%/96.8%. **SKETCH.**
- Whether `abnormal_flag` is in the blob header or the OrderItem payload is **UNVERIFIED**.
