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
| `RequestTypeCode` | 174,261 (100%) | `D` 154,987 / `E` 19,274. ⚠ **NOT a duplicate of `priority`** — I suspected it was; falsified: orthogonal (`D`/`E` × `R`/`U`/`S`) |
| `LIMSFacilityCode` | 174,261 (100%) | real facility codes (`0JJAA`, `BAGAE`, …) |
| `RegisteredBy` | 173,915 (99.8%) | ⚠ CDR has **no** `registered_by` |
| `OrderingNotes` | 171,670 (98.5%) | ⚠ CDR has **no** counterpart. ⚠ **NOT free text** — I suspected PHI; falsified: numeric codes (`17`, `18`, `2421`, `06050100`) |
| `LIMSAnalyzerCode` | 78,289 (44.9%) | real instrument codes (`ALINA`, `ALINK`, `75PCR`, `MSKAN`) — genuine provenance |
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

### 3.1c Legacy sweep — 15 more dropped (user, 2026-07-17)

> *"lets do the clean up now… for now lets clean up and we will slowly add them back bit by bit"*

| column(s) | measured (TDS) | why | **revisit?** |
|---|---|---|---|
| `LOINCPanelCode`, `LabResults.LOINCCode` | **0**, and **2** | ⛔ **CE resolves LOINC through its own terminology service.** Carrying v1's empty LOINC columns imports a problem CE already solved | no |
| `LIMSPreReg_RegistrationDateTime`, `LIMSPreReg_ReceivedDateTime`, `LIMSPreReg_RegistrationFacilityCode` | **0** | pre-registration workflow, never used | no |
| `AdmitAttendDateTime` | **0** | | no |
| `ReferringRequestID` | **0** | | no |
| `HL7EthnicGroupCode` | **0** | also **sensitive** — dropped on principle as well as population | no |
| `HL7SpecimenSourceCode`, `HL7SpecimenSiteCode`, `LIMSSpecimenSiteCode`, `LIMSSpecimenSiteDesc` | **0** | specimen SITE never populated (specimen *source* IS carried — §1 defs) | ⚠ **YES** |
| `Newborn`, `Repeated` | **6**, **3** | noise, not zero | no |
| `ReceivingFacilityCode` | 174,261 — **constant `'TDS'`** | not zero: a **constant**, derivable from site config | ⚠ **YES** |

⚠ **`revisit: YES` is a first-class marker, not a footnote.** The user's words were *"some of them may
need to be revisited like specimen-site and ReceivingFacilityCode… we will slowly add them back bit
by bit"*. Without a marker in the model, *"add them back"* becomes archaeology through a git log.
**A `not_carried` entry that is expected to return is a different thing from one that is gone.**

⚠ **Two of these are NOT measured-zero and the distinction must survive:** `Newborn`/`Repeated` are
**noise** (6 and 3 rows — real data, just negligible), and `ReceivingFacilityCode` is a **constant**
(100% populated with `'TDS'`). Filing either as "empty" would be a **false measurement** — the exact
`count(col)` error in prose form.

### 3.1d `EncryptedPatientID` — dropped (user, 2026-07-17)

⚠ **CORRECTED. An earlier draft treated `EncryptedPatientID` and `patient_guid` as the same thing.
They are not — and v2's schema already models them as THREE separate columns.** The user's
correction, verified against `02-openldr_external.sql`:

| v2 column | purpose | populated by CDR? |
|---|---|---|
| `patients.id` UUID PK | **DB linkage** — what `lab_requests.patient_id` FKs to. The database's own business. | n/a — generated |
| `patients.patient_guid` VARCHAR(255) | *"external patient identifier **from source**"*, under `UNIQUE (patient_guid, facility_id)` | ⚠ **yes — with `requestId`** |
| `patients.encrypted_patient_id` VARCHAR(128) | *"Encrypted/hashed ID for **de-identified analytics**"* — track a patient **without exposing names**. **This is v1's `EncryptedPatientID`'s real home.** | ⛔ **NO — `V2Patient` has no such field** |

**So the decision is narrow: CE does not carry v1's `EncryptedPatientID` VALUE.** It is v1's own hash,
computed by v1's ingest; importing it would inherit another system's derivation. **`not_carried`.**

⚠ **What this decision is NOT.** It is not a claim that the field was redundant — my framing of it as
*"a stand-in for missing names"* was **wrong**, and measuring killed it: it is a working pseudonymous
patient key (88,115 rows → **44,829 distinct**, one spanning **116 requests**). And it is **not** a
statement about `patient_guid`, which is a different concern entirely.

#### The two gaps it leaves — both real, both OUT OF SCOPE here

**(a) `encrypted_patient_id` is never populated.** v2 built the column *and* persists it
(`external-persistence.service.ts:499`, `:518`). CDR's `V2Patient` has no such field, so it is
**always NULL for DISA data** — a purpose-built de-identified-analytics capability, unused.

**(a2) Patient identifiers are FLATTENED — typed ids are silently dropped.** (user, 2026-07-17:
*"for countries with a registry, Patient is supposed to have its national id number captured…
something like idType and IdCode… could be License with code 12345678. If it's not there then I
forgot to add it"*)

**It is not there — but it does not need inventing. It already exists and is being discarded.**

| layer | identifier model | verdict |
|---|---|---|
| CDR → FHIR (`fhir-transform.ts:51-61`) | builds `Patient.identifier[]`: `urn:openldr:folder-no`, and `urn:openldr:national-id` **with `type.coding = [{ system: ".../v2-0203", code: "NI" }]`** | ✅ **typed, plural, standards-based ALREADY** |
| FHIR → v2 (`hl7-fhir.schema.js:368-382`) | `patientNationalId()` scans `identifier[]` and returns **the FIRST** whose `type.coding[0].code` ∈ `NI`/`SS`/`NN`/`SSN` (or whose system string contains *"national-id"*) — **as one flat string** | ⛔ **lossy** |
| `V2Patient` / `patients` table | `national_id: string \| null` — **one slot, untyped** | ⛔ **lossy** |

**Three distinct losses at the flattening step:**
1. **`identifier[]` is a LIST; v2 keeps ONE.** Every additional identifier is dropped.
2. **The TYPE is discarded.** Once it is `national_id`, nothing records whether it was a national
   ID, an SSN, a passport or a license.
3. ⛔ **Any type OUTSIDE `NI`/`SS`/`NN`/`SSN` is SILENTLY DROPPED.** The user's own example — a
   **License (`DL`)** with code `12345678` — **matches nothing and is lost**. So are `PPN`
   (passport), `HC` (health card), `MR` (medical record).

⇒ **`idType`/`idCode` is exactly FHIR's `Identifier.type.coding.code` + `Identifier.value`, on the
HL7 `v2-0203` code system CDR already cites.** ⇒ **The fix is to STOP FLATTENING, not to invent a
parallel model.** CE is FHIR-native and can carry `identifier[]` with types as-is — inventing
`idType`/`idCode` fields would re-solve, in a bespoke way, a problem the standard already solves and
CDR already emits correctly.

⚠ **DISA cannot exercise this today** — `NID` measured **0 of 40**. So this is invisible on TDS and
would only surface at a site with a real registry. **A gate scoped to TDS will never catch it.**

**(b) `patient_guid = requestId` — a COMPROMISE, but a DELIBERATE one; CE inherits it.**

⚠ **Read the rationale before "fixing" it.** (user, 2026-07-17): *"it was meant to be a **snapshot
not a registry** — it's very hard for some countries to track users especially if there is no
national id, so this at least helps a bit."*

⇒ **~98,259 Patient resources for ~44,829 real people is a KNOWN CONSEQUENCE of a defensible
stance**, not an oversight. Where no national registry exists, a per-request snapshot is honest: it
does not claim an identity it cannot establish. **Do not "correct" it into a registry by default** —
a wrong cross-visit merge is worse than no merge, because it silently fuses two people's results.
`v2-transform.ts:194-197`: *"DISA has no native patient GUID — use the request_id… This means no
cross-visit dedup downstream; that's accepted."* With `UNIQUE (patient_guid, facility_id)`, **every
request creates a new patient row** — CE would hold ~98,259 "patients" for ~44,829 real ones. And it
does not stop at v2: `fhir-transform.ts:332` does `patientId = fhirId(payload.patient.patient_guid)`,
so **CE's FHIR `Patient.id` is per-request too.** The compromise propagates all the way through.

⇒ **User: *"that was v2, ce might do it differently — the goal is to improve the process, not build on
top of a compromise."*** ⇒ **CE must NOT inherit `patient_guid = requestId` by default.**

**Follow-up slice (§10.1), named so it is not lost:** define CE's patient identity **properly** —
`patient_guid` (source identity) and `encrypted_patient_id` (de-identified tracking) are **separate
questions with separate answers**, and neither is *"copy what v2 did"*.
⚠ Constraints that slice must respect, measured: DISA has **no** patient identifier — `FolderNo`
**17/40 (42.5%)**, `NID` **0/40**; and names are 100% present but **polluted** — the first four
samples are `INSTRUMENT VALIDATION` (QC records, not patients). **Any identity scheme must exclude QC
first**, and a deterministic hash over dirty identity fields will happily mint a stable id for a
non-person.

**Net effect: 25 columns `not_carried`** — 9 (§3.1b) + 15 (§3.1c) + `EncryptedPatientID`.

### 3.2 `measured_empty` — the bucket is now EMPTY

Every column that would have landed here was swept into `not_carried` by §3.1b–d as a **scope
decision**. Bucket 4 stays defined because the next site's data will need it.

⚠ **This is the most important line in the document.** *"Empty on TDS"* is **NOT** *"empty"* — this
laptop is **1 site of 22**, and a column at 0% here may be 90% in Zambia or Mozambique. Those 15
columns are dropped **because CE chose not to model them**, ***NOT*** **because they are unpopulated.**

⇒ **If another site shows data in a `not_carried` column, that does NOT make the decision wrong** —
it makes it a decision worth re-reading, which is what `revisit` is for. **Do not "correct" a
`not_carried` entry by pointing at a population count.** See [[disa-organism-classifier]] for the
last time a single-site sample misled by orders of magnitude.

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
5. **`not_carried`** — **NEW (§3.1b–d).** A deliberate product decision that CE does not model this
   legacy field. Carries the decision, the decider, the date, the measurement, and:
   ```
   revisit?: string   // set when the field is EXPECTED BACK, with what would bring it
   ```
   ⚠ **`revisit` is required for anything dropped "for now".** The user's plan is explicit —
   *"we will slowly add them back bit by bit"* — and a bucket that cannot express "gone" vs
   "parked" turns that plan into archaeology through a git log. Day-one `revisit` entries:
   the 4 specimen-site columns and `ReceivingFacilityCode` (§3.1c).

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

## 6. PHI — `EncryptedPatientID` (resolved) and the standing rule

**`EncryptedPatientID` is `not_carried` (§3.1d)** — so it is never SELECTed and the PHI question is
moot for it. The reasoning is recorded there because it is the opposite of what it looks like: the
field is a **pseudonym**, and **CE stores real names, DOB and phone — CE is more identifying than
v1.**

**The standing rule survives it.** The gate prints values into diff rows and batch summaries
(`v2-diff.ts` → `valueForOutput`), which land in logs and in committed findings docs.

⇒ **Coverage is not a licence to widen a PHI blast radius.** Any future column carrying patient
identity is `not_carried` or an exception (*"PHI; deliberately not fetched"*) — **never fetched
merely to make a coverage guard go green.** A findings doc committed to git is exactly the wrong
place for a patient identifier.

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
| 3 | Drop the 15-column legacy sweep (§3.1c) as `not_carried`, **with `revisit` on the 4 specimen-site columns and `ReceivingFacilityCode`**. *"for now lets clean up and we will slowly add them back bit by bit"* | user | 2026-07-17 |
| 4 | Drop v1's `EncryptedPatientID` **value** as `not_carried` — **and open a separate slice to define CE's patient identity properly** (§3.1d). ⚠ Not dropped as redundant; that premise was falsified. ⚠ **`EncryptedPatientID` ≠ `patient_guid`** — v2 models them as separate columns (+`id` for linkage); an earlier draft conflated them. *"the goal is to improve the process not build on top of a compromise"* | user | 2026-07-17 |
| 5 | Standardise on **`LIMSVersionStamp`** (capital S) in **CE's own schema only**. ⚠ `types.ts`'s `V1Request.LIMSVersionstamp` / `V1LabResult.LIMSVersionStamp` **must keep mirroring v1's inconsistency** — those types write into v1's real tables, so "fixing" the typo there breaks the write path. | user | 2026-07-17 |

**Running total: 25 of 88 columns `not_carried`; 8 bookkeeping; the rest def / exception.**

⚠ **Decisions 2 and 4 were ASKED, not inferred — and 4 came back opposite to the framing that
prompted it.** Extending a decision to a field its author did not name is exactly how `patient_class`
nearly became a fabricated defect, inverted. **If a field looks like it "obviously" belongs in
`not_carried`, that is the moment to ask.**

---

## 10. Follow-up slices — named so they are not lost

1. **Define CE's patient identity — do not inherit v2's compromise** (from §3.1d). ⚠ **Three
   separate concerns; do not collapse them** (this is the mistake this spec already made once):
   - **DB linkage** — solved. `patients.id` UUID PK / CE's own resource id. Nobody needs to design this.
   - **`patient_guid`** — *"external patient identifier from source"*. **DISA has none**, so v2 used
     `requestId`: *"no cross-visit dedup downstream; that's accepted"* (`v2-transform.ts:194-197`).
     ⇒ one patient row **per request** (~98,259 for ~44,829 real people), and via
     `fhir-transform.ts:332` **CE's FHIR `Patient.id` inherits it**.
     ⚠ **This is a SNAPSHOT-not-a-registry stance, not an accident** — see §3.1d(b). Where no
     national registry exists it is the honest answer: it never claims an identity it cannot
     establish. **The improvement is to stop it being the ONLY option — not to force merging.**
     A wrong merge silently fuses two people's results; that is worse than no merge.
   - **Typed identifiers** (§3.1d(a2)) — **the highest-leverage piece, and it needs no invention.**
     CDR already emits `Patient.identifier[]` with `type.coding` on HL7 `v2-0203`; v2 flattens it to
     one untyped `national_id` and **silently drops any type outside `NI`/`SS`/`NN`/`SSN`** (a
     License `DL`, a passport `PPN`). **Stop flattening.** Where a country HAS a registry, this is
     what makes real identity possible — without imposing it on countries that do not.
     ⚠ **Invisible on TDS** — DISA `NID` is **0 of 40**. Only a registry site exercises it.
   - **`encrypted_patient_id`** — de-identified analytics tracking. v2 has the column and persists
     it; **CDR never populates it**. A separate question: does CE want this capability at all?
   ⚠ Measured constraints: `FolderNo` **42.5%**, `NID` **0%**, names 100% but **polluted** —
   `INSTRUMENT VALIDATION` QC records appear as "patients". **Exclude QC before keying anything**;
   a deterministic hash over dirty fields mints a stable id for a non-person.
   ⚠ **Privacy note, inverted from the obvious:** `EncryptedPatientID` is a *pseudonym* while CE
   stores real names, DOB and phone — **CE is MORE identifying than v1**. Any "we de-identified it"
   claim about CE must reckon with that.
2. **`obr_set_id` on `V2LabRequest`** (from §4) — CDR cannot represent a multi-panel request (61.2%
   of TDS). ⚠ Emitting one record per panel WITHOUT `obr_set_id` is **worse than the bug**: all
   panels collide on `(request_id, 1, facility_id)` and silently overwrite.
3. **Add back `revisit` columns bit by bit** (from §3.1c) — specimen-site ×4, `ReceivingFacilityCode`.
