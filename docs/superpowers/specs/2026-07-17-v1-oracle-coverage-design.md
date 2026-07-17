# v1 Oracle Coverage — the gate grades the FETCH, not v1

**Status:** design, not started. **Blocks:** T7 of the mapping gate
(`docs/superpowers/plans/2026-07-17-cdr-v1-mapping-gate.md`).
**Repo:** `cdr-toolchain`, branch `slice/observation-timestamps`.

---

## 1. The problem

The V2↔v1 gate (`08ddbe1`, `41719b6`) ships a **coverage guard**: *"every v1 column has a field def,
an exception, or is bookkeeping."* **That claim is false.**

It asserts over `OpenLdrV1Request` / `OpenLdrV1LabResult` — which are **not v1**. They are the subset
that `REQUEST_COLUMNS` / `LAB_RESULT_COLUMNS` bother to `SELECT` (`openldr.ts:69-80`, `:215-222`).

| | declared in TS | real columns in v1 | **coverage** |
|---|---|---|---|
| `Requests` | 26 (+`allPanelCodes`, derived) | **60** | **43%** |
| `LabResults` | 15 (2 joined from `Requests`) | **28** | **46%** |

Measured against `INFORMATION_SCHEMA`, 2026-07-17.

**This is the same error as `count(col)`, the blob layer, and the multi-LIMS population: trusting a
derived artifact instead of the source. A TypeScript interface is not a schema.** Fifth occurrence.

⇒ **The gate cannot report an inventory while claiming completeness over 43% of the oracle.** T7's
whole deliverable is that inventory, so this comes first.

---

## 2. RULE 0 — what would make this FALSE, and what the check found

**The falsifier:** *"the uncovered columns are empty on DISA, so covering them adds nothing."*
Checked directly (D7: `count(nullif(ltrim(rtrim(cast(col as nvarchar(max)))),''))`, scoped to
`RequestID LIKE 'TZDISATDS%'`).

**It came back MIXED — and the check found FOUR errors in my own claims, including in the probe
itself.** Recorded because each is a live trap for the implementer:

| my claim | verdict |
|---|---|
| `LIMSRptFlag` is *"a SECOND stub of the same shape as `abnormal_flag`"* | ⛔ **overstated 13×.** `abnormal_flag` is 16.7% (107,602); `LIMSRptFlag` is **1.3% (8,372)**. Real, but small. |
| `DateTimeValue` *"may be the per-result timestamp"* | ⛔ **FALSE.** It is the parsed **VALUE** of a date-typed observation — `EQSED` *"Expiration Date"*, `TPD` *"Transportation Date"*, `HL7ResultTypeCode='D'`, `LIMSRptResult='01/03/2013'`. ⇒ **"v1 has NO per-result timestamp" STANDS** — see [[disa-timestamp-stub-and-amr-zero-rows]]. |
| `Note` is free text | ⛔ **FALSE.** It is a **bit**: `0` × 575,210, `1` × 68,645. |
| 12 columns are *"100.0% populated"* | ⛔ **FALSE — my probe had the `count()` bug in a new costume.** A numeric `0` casts to `'0'`, which is non-empty. v1's own convention is *"numerics default to 0"* (`types.ts:160`). Re-measured with `<> 0`: `WorkUnits`, `Deceased`, `TargetTimeDays`, `TargetTimeMins` are **all-zero — DEAD**. |

⚠ **The lesson for the implementer: "non-empty" is type-dependent.** For a VARCHAR it is `<> ''`; for
a numeric/bit it is `<> 0`. Using one rule for both produces confident nonsense — twice now.

---

## 3. Measured — DISA/TDS. This drives the scope.

### 3.1 `Requests` — uncovered, POPULATED (of 174,261)

| column | non-empty | note |
|---|---|---|
| **`OBRSetID`** | **76,002 rows are `> 1` (43.6%)** | ⛔ **the multi-panel defect — §4** |
| `RequestTypeCode` | 174,261 (100%) | `D` 154,987 / `E` 19,274 |
| `ReceivingFacilityCode` | 174,261 (100%) | constant `TDS` |
| `LIMSFacilityCode` | 174,261 (100%) | real facility codes (`0JJAA`, `BAGAE`, …) |
| `RegisteredBy` | 173,915 (99.8%) | ⚠ CDR has **no** `registered_by` |
| `OrderingNotes` | 171,670 (98.5%) | ⚠ CDR has **no** counterpart |
| `EncryptedPatientID` | 88,115 (50.6%) | ⚠ **PHI — see §6** |
| `LIMSAnalyzerCode` | 78,289 (44.9%) | |
| `LIMSVendorCode` | 46,381 (26.6%) | |
| `CollectionVolume` | 36,374 non-zero (20.9%) | ⚠ **kept** — `CostUnits` was dropped, this was not; do not pattern-match them together |
| **`LIMSRejectionCode`/`Desc`** | 4,518 (2.6%) | ⛔ `toV2` has a whole `detectDisaRejection` path (`v2-transform.ts:669`) and **nothing grades it** |

⛔ **Not carried (§3.1b):** ~~`WorkUnits`~~, ~~`Deceased`~~, ~~`TargetTimeDays`~~,
~~`TargetTimeMins`~~ (all **0 non-zero**), ~~`CostUnits`~~ (20.9% — dropped on **scope**).

### 3.1b ⛔ NOT CARRIED TO CE — a product decision (user, 2026-07-17)

> *"DateTimeValue, Note, WorkUnits, Deceased, TargetTime all not necessary as they barely got used,
> some of these fields are so old, I don't see the need to carry them over to the new ce"*

**Dropped deliberately.** The measurements support it:

| column | measured | why dropping is safe |
|---|---|---|
| `Requests.WorkUnits` | **0 non-zero** of 174,261 | dead |
| `Requests.Deceased` | **0 non-zero** | dead |
| `Requests.TargetTimeDays` | **0 non-zero** | dead |
| `Requests.TargetTimeMins` | **0 non-zero** | dead |
| `LabResults.WorkUnits` | **227 non-zero** (0.04%) | noise |
| `LabResults.Note` | 68,645 (10.7%) | a **bit** (0/1), meaning undocumented; legacy |
| `LabResults.DateTimeValue` | 33,004 (5.1%) | **redundant** — see below |
| `Requests.CostUnits` | 36,374 non-zero (**20.9%**) | ⚠ **not "barely used" — see below** |
| `LabResults.CostUnits` | 127,140 non-zero (**19.7%**) | ⚠ ditto |

⚠ **`CostUnits` is `not_carried` on SCOPE, not on population** (user, 2026-07-17, asked explicitly
rather than inferred). Unlike the rest of this table it is **~20% populated** — the *"barely got
used"* rationale does **not** apply. The decision is that **billing/cost units are out of CE's scope
regardless of population**. Recorded this way so a future reader does not "correct" it by pointing at
the 127,140 rows and assuming an oversight — the number was known when the call was made.

**`DateTimeValue` is a typed projection, not data.** For 30,198 of its 33,004 rows the same value is
already in `LIMSRptResult` as text (`'01/03/2013'` ↔ `2013-03-01`), which CDR carries as
`result_value`. **Checked the exception rather than assumed it:** 2,806 rows have `DateTimeValue`
with an EMPTY `LIMSRptResult` — and **all 2,806 are one observation, `TPT` *"Tranportation Time"*
(v1's own typo) under panel `COL`**. Logistics, not a clinical result.
⇒ Dropping `DateTimeValue` loses **2,806 rows of transport-time metadata and nothing else**.

⚠ **This is a DECISION, not a measurement — do not merge it with `measured_empty` (§3.2).** They
expire differently: a measurement is falsified by the next site's data; a decision is only reversed
by a person. Conflating them is how *"we have no evidence"* silently becomes *"we decided"*.

**Net effect: 9 columns dropped** — `WorkUnits` ×2, `Deceased`, `TargetTimeDays`, `TargetTimeMins`,
`Note`, `DateTimeValue`, `CostUnits` ×2.

### 3.2 `Requests` — uncovered, EMPTY on TDS

`LOINCPanelCode`, `AdmitAttendDateTime`, `HL7SpecimenSourceCode`, `HL7SpecimenSiteCode`,
`LIMSSpecimenSiteCode`, `LIMSSpecimenSiteDesc`, `HL7EthnicGroupCode`, `ReferringRequestID`,
`LIMSPreReg_RegistrationDateTime`, `LIMSPreReg_ReceivedDateTime`,
`LIMSPreReg_RegistrationFacilityCode`, `WorkUnits`, `Deceased`, `TargetTimeDays`, `TargetTimeMins`
— all **0**. `Newborn` **6**, `Repeated` **3** (noise).

⚠ **"Empty on TDS" is NOT "empty".** This laptop is **1 site of 22**. A column at 0% here may be
90% in Zambia or Mozambique. ⇒ **Record the measurement; do NOT delete the column from the
model.** See [[disa-organism-classifier]] for the last time a single-site sample misled by orders
of magnitude.

### 3.3 `LabResults` — uncovered (of 643,855)

| column | non-empty | note |
|---|---|---|
| `SIHiRange` | 50,761 non-zero (7.9%) | ⚠ CDR emits `rpt_range` as a **string**; v1 splits lo/hi **numerically** |
| `CodedValue` | 49,410 (7.7%) | ⚠ **distinct from `LIMSCodedValue`**, which IS covered |
| `ResultSemiquantitive` | 49,409 non-zero (7.7%) | `-1` × 37,185, `1` × 12,205, `2`/`3` × 19. Tracks `CodedValue` almost exactly. Likely the `<` / `>` qualifier — **measure before mapping** |
| `LIMSRptUnits` | 45,461 (7.1%) | CDR emits `rpt_units`; ungraded |
| `SILoRange` | 32,664 non-zero (5.1%) | |
| **`LIMSRptFlag`** | **8,372 (1.3%)** | `L` 5,337 / `H` 2,194 / `L-` 666 / `H+` 145. ⇒ `v2-transform.ts:497` `rpt_flag: null` **is a real defect, at 8,372 rows** |
| `LOINCCode` | **2** | dead |
| ~~`CostUnits`~~ | 127,140 (19.7%) | ⛔ **not carried — §3.1b** (scope, not population) |
| ~~`Note`~~ | 68,645 (10.7%) | ⛔ **not carried — §3.1b** |
| ~~`DateTimeValue`~~ | 33,004 (5.1%) | ⛔ **not carried — §3.1b** |
| ~~`WorkUnits`~~ | 227 (0.04%) | ⛔ **not carried — §3.1b** |

⚠ **`LIMSRptFlag`'s value set (`L`/`H`/`L-`/`H+`) DIFFERS from `HL7AbnormalFlagCodes`
(`N`/`L`/`H`/`LL`/`HH`).** They are the LIMS-native and HL7-normalised flags — **two different
fields**. Do not map one onto the other.

---

## 4. ⛔ The defect this uncovers: CDR cannot represent a multi-panel request

**v1 and v2 AGREE on the grain. CDR is the outlier.**

| | |
|---|---|
| `02-openldr_external.sql:276` | `obr_set_id INTEGER -- HL7 OBR set ID (for multi-panel requests)` |
| `:336` | `UNIQUE (request_id, obr_set_id, facility_id)` |
| `lab_results.request_id` | `UUID REFERENCES lab_requests(id)` ← the **only** place the key is switched |
| `external-persistence.service.ts:632` | `request?.obr_set_id ?? 1` |
| `:586` | `ON CONFLICT (request_id, obr_set_id, facility_id) DO UPDATE` |

The natural key is **retained at transport and in the v2 DB**; the UUID PK is a surrogate for FK
joins. **`V2LabRequest` has no `obr_set_id`** (`types.ts:30-57`) and `toV2` emits **one record per
DISA lab** with one primary panel.

**Measured:** `OBRSetID > 1` on **76,002 of 174,261 rows (43.6%)**; **60,140 of 98,259 requests
(61.2%)** carry 2+ distinct `LIMSPanelCode`.

⇒ For 61.2% of TDS requests, v1's non-first OBR rows have **no v2 counterpart**.

⚠ **THE TRAP:** fixing CDR to emit one record per panel **without also emitting `obr_set_id`** is
**worse than the bug** — all panels default to `1`, collide on `(request_id, 1, facility_id)`, and
**silently overwrite each other**. The `ON CONFLICT` makes it a `DO UPDATE`, so it looks like a
successful ingest.

⚠ The old gate hid this behind the `allPanelCodes` **candidate array** — *"a match on either wins"*
turning a structural defect green. **This is the single best justification for banning them.**

**Scope note:** this design **measures**; the CDR fix is its own slice. But §5 must fetch `OBRSetID`
or the gate cannot see it at all.

---

## 5. Design

**Principle: the gate must grade the ORACLE, not our SELECT.**

### 5.1 Widen the fetch + row types

Add to `REQUEST_COLUMNS` / `OpenLdrV1Request` the **populated** §3.1 columns, and to
`LAB_RESULT_COLUMNS` / `OpenLdrV1LabResult` the §3.3 ones. **`OBRSetID` is mandatory** (§4).

⚠ **`fetchRequestByRequestId` returns `rows[0]` — the lowest OBRSetID** (`openldr.ts:110`). Once
`OBRSetID` is fetched, that silent choice becomes visible and must be **named**, not left implicit.

### 5.2 Make the coverage guard honest

Derive the expected column list from the **DB**, not from the interface. Two options — **pick in
the plan, do not silently choose**:

| option | guard | cost |
|---|---|---|
| **A** — a checked-in `v1-schema.json` snapshot, generated by a script from `INFORMATION_SCHEMA`, asserted in a unit test | catches drift at test time, no DB needed in CI | must be regenerated when v1 changes; **a stale snapshot re-creates today's bug quietly** |
| **B** — assert against live `INFORMATION_SCHEMA` in an integration test | cannot go stale | needs a live v1; won't run in CI |

**Recommendation: A**, plus the generator script committed beside it, plus a test asserting the
snapshot's column COUNT (60/28) so a truncated regeneration fails loudly.

### 5.3 Classify every column, explicitly

Every v1 column lands in exactly one bucket, each carrying its **measurement**:

1. **def** — graded (§3.1/§3.3 populated, with a V2 counterpart)
2. **exception** — structural gap, with evidence (e.g. `OBRSetID` at result level → the UUID FK)
3. **bookkeeping** — `DateTimeStamp`, `Versionstamp`, `LIMSDateTimeStamp`, `LIMSVersionstamp`
   (+`LIMSVersionStamp` — ⚠ **`LabResults` spells it with a capital S**; `Requests` does not)
4. **`measured_empty`** — **NEW.** 0% on TDS, carrying the count and the date. **Not "ignore":** a
   claim that expires the moment another site's data lands.
5. **`not_carried`** — **NEW (§3.1b).** A deliberate product decision that CE does not model this
   legacy field. Carries the decision, the decider, the date, and the measurement.

⚠ **Buckets 4 and 5 must NOT be merged, however similar they look in a report.** They mean opposite
things and expire differently:

| | claim | falsified by | if wrong |
|---|---|---|---|
| **`measured_empty`** | *"we observed no data — on ONE of 22 sites"* | **the next site's data** | a real field is silently uncovered |
| **`not_carried`** | *"CE deliberately does not model this"* | **a person changing their mind** | nothing; it is a decision |

**Conflating them is how *"we have no evidence"* becomes *"we decided"* without anyone deciding.**

⚠ **`measured_empty` is the bucket most likely to rot into the next `allowDisaEmpty`.** It must
record *"0 of 174,261 on TDS, 2026-07-17"*, never *"n/a"*.
⚠ **`not_carried` must name WHO decided and WHEN** — otherwise a later reader cannot tell a decision
from a guess, and re-litigates it.

⇒ **Neither bucket is graded, so neither can produce red.** That is correct for both — but it also
means a mistake in either is **invisible in the report**. They are the two buckets to review by
hand, not by test.

### 5.4 New defs that follow from §3

- **`registered_by` ← `RegisteredBy` (99.8%)** — ⚠ **CDR has no such field.** Expect `only_v1`.
- **`ordering_notes` ← `OrderingNotes` (98.5%)** — ⚠ no CDR counterpart. Expect `only_v1`.
- **`rejection_code`/`rejection_desc` ← `LIMSRejectionCode`/`Desc` (2.6%)** — CDR *has* the data
  (`detectDisaRejection`). **The highest-value new def: real logic, never graded.**
- **`rpt_flag` ← `LIMSRptFlag` (1.3%, 8,372 rows)** — a confirmed stub, correctly sized.
- **`rpt_units` ← `LIMSRptUnits` (7.1%)**.

---

## 6. ⛔ `EncryptedPatientID` — do NOT fetch it reflexively

50.6% populated, and **PHI**. The gate prints values into diff rows and batch summaries
(`v2-diff.ts` → `valueForOutput`), which land in logs and committed findings docs.

⇒ **Default: do NOT add it to the SELECT.** If coverage demands it be *accounted for*, classify it
as an exception (*"PHI; deliberately not fetched"*) with that reason. **Coverage is not a licence to
widen a PHI blast radius**, and a findings doc is exactly the wrong place for a patient identifier.

---

## 7. Out of scope

- **Fixing** any stub — including `obr_set_id`. Each fix is its own slice, justified by the report.
- Non-TDS sites (not on this laptop).
- The DISA↔v1 table (`mapping.ts`). Untouched; its 3 unaudited *"v1 data loss"* comparators
  (`wardComparator`, `facilityNameComparator`, `icd10Comparator`) remain unexamined — **named so
  they are not lost**, per the mapping gate's self-review.

---

## 8. Acceptance

1. The coverage guard asserts against a **DB-derived** list of **60** / **28** columns and passes.
2. Every column is in exactly one of the **five** buckets, each with a measurement.
3. `OBRSetID` is fetched, and the `rows[0]` choice is explicit.
4. The gate reports `rpt_flag` red at **~8,372** rows — **not** ~107,602 (that would mean it was
   mapped onto `abnormal_flag`) and **not** ~635,483 (the `''` rule broken).
5. `EncryptedPatientID` is accounted for **without** being fetched.
6. No regression: 173 tests, 172 pass, 1 pre-existing skip; the DISA↔v1 batch output stays
   byte-identical.
7. `not_carried` (§3.1b) columns are **absent from the SELECT** and produce **no red** — dropping
   them must cost nothing at runtime, not merely be tolerated by the gate.

---

## 9. Decisions taken

| # | decision | by | date |
|---|---|---|---|
| 1 | Drop 7 legacy fields — `WorkUnits` ×2, `Deceased`, `TargetTimeDays`, `TargetTimeMins`, `Note`, `DateTimeValue` — as `not_carried`. *"barely got used… so old, I don't see the need to carry them over to the new ce"* | user | 2026-07-17 |
| 2 | Drop `CostUnits` ×2 as `not_carried` — **on scope, not population**. Asked explicitly because at ~20% the stated rationale did not reach it; the answer was that billing/cost units are out of CE's scope regardless. | user | 2026-07-17 |

⚠ **Decision 2 was ASKED, not inferred.** Extending decision 1 to a field its author did not name is
exactly how `patient_class` nearly became a fabricated defect — in the opposite direction. If a
future field looks like it "obviously" belongs in `not_carried`, **that is the moment to ask, not to
assume.**
