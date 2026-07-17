# `obr_set_id` — CDR cannot represent a multi-panel request

**Status:** design, not started. **Repo:** `cdr-toolchain`, branch `slice/observation-timestamps`
(baseline `2fceb71`, 190 tests / 189 pass / 1 pre-existing skip).
**Evidence:** `docs/superpowers/specs/2026-07-17-mapping-gate-findings.md` §3.2 (`da9210c7`).

---

## 1. The problem

**v1 and v2 AGREE on the grain. CDR is the outlier.**

| | grain |
|---|---|
| **v1** | `(RequestID, OBRSetID)` — one row per ordered panel iteration |
| **v2** | the same: `UNIQUE (request_id, obr_set_id, facility_id)`; `obr_set_id INTEGER -- HL7 OBR set ID (for multi-panel requests)` (`02-openldr_external.sql:276,336`) |
| **CDR** | **the DISA lab.** `V2LabRequest` has **no `obr_set_id`**; `toV2` emits **ONE** record carrying **ONE** primary panel |

**Measured (DISA/TDS, 2026-07-17):**
```
multi-OBR requests                     60,472
  sibling OBRs differ in AnalysisDateTime   53,011  (87.7%)
  ...              HL7SectionCode           45,173  (74.7%)
  ...              TestedBy                 23,600  (39.0%)
  ...              AuthorisedDateTime       11,569  (19.1%)
  ...              HL7ResultStatusCode       7,845  (13.0%)
  ...              LIMSPanelCode            60,140  (99.5%)
requests with 2+ distinct panels       60,140 of 98,259  (61.2%)
V2<->v1 gate: obr_set_id                158/158 only_v1
```

⇒ **This is real data loss, not a cosmetic gap.** For **53,011** requests each panel was analysed at
a different time and CDR can carry only one `analysis_at`. For **7,845** the panels have **different
statuses** — one final, another rejected or pending — and CDR emits a single `result_status`, which
is **necessarily wrong for at least one panel**.

The **observations** survive (`lab_results` carries each one's own `source_test_code`). What is lost
is **per-panel request-level metadata**: when it ran, who ran it, which section, whether it is final.

⛔ **THE TRAP — the obvious fix is WORSE than the bug.** Emitting one record per panel **without also
emitting `obr_set_id`** makes every panel pin to `obr_set_id = 1`
(`external-persistence.service.ts:632`, `request?.obr_set_id ?? 1`) and collide on
`ON CONFLICT (request_id, obr_set_id, facility_id) DO UPDATE` (`:586`) — **N−1 panels silently
overwritten, arriving as a successful ingest.** Today CDR emits one *coherent* record; a half-fix
emits one *scrambled* one.

---

## 2. ⛔ RULE 0 — the load-bearing claim is verified on ONE lab

**Claim:** `TestResults[].TESTINDEX` **is** v1's `OBRSetID`, 1:1.

**Evidence so far — `TZDISATDS0047711`, n=1:**
```
DISA TestOrders : ["MRCSW","MRCSW","MRCSW","MICBM","MSENS"]
DISA TestResults: MRCSW#1  MRCSW#2  MRCSW#3  MICBM#4  MSENS#5
v1   Requests   : OBR 1 MRCSW | OBR 2 MRCSW | OBR 3 MRCSW | OBR 4 MICBM | OBR 5 MSENS
```

⚠ **n=1 is not a mapping.** This session already produced two confident calls off small samples that
the data later reversed (D4 at 10%→89.2%→55.7%; `tested_by` 0 mismatches→81). **T1 verifies this at
scale BEFORE anything is built.** If `TESTINDEX ≠ OBRSetID` on a material fraction, **this design is
void** and the fix follows the data instead.

**Falsifiers to check explicitly:**
- requests where DISA's `TESTINDEX` set ≠ v1's `OBRSetID` set;
- non-contiguous or non-1-based `OBRSetID`;
- `TESTINDEX` colliding across panels.

---

## 3. Superseded iterations — orders survive, results do not

Same lab, v1's `LabResults`:
```
OBR 3, OBX 1 : ORGS
OBR 4, OBX 1 : OXID | OBX 2 : INDOL | OBX 3 : MTXT
total: 4 rows
```
**v1 keeps OBR rows 1 and 2 (the superseded MRCSW reruns) with ZERO results under them.** OBR 5
(MSENS) likewise has an order and no results.

⇒ **`supersedePanelIterations` was RIGHT about results and must stay** — its comment ("v1 dropped
them") describes `LabResults`, not `Requests`.
⇒ **But it must stop erasing the ORDER.** The model is **N ServiceRequests / lab_requests, and only
the surviving iterations carry results.**

⚠ **Get this wrong in either direction:** resurrect results under OBR 1–2 (2 phantom result sets), or
drop OBR 1–2 entirely (2 real orders lost). **Both are silent.**

---

## 4. The source — CDR already decodes both ids

| id | source | already in CDR? |
|---|---|---|
| `obr_set_id` | `TestResults[].TESTINDEX` | ✅ `flattenDisa` decodes it as `DisaObs.panelIndex` (`result-mapping.ts:570-572`) |
| `obx_set_id` | position within `TestResults[].ORDER[]` | ✅ `buildLabResults` already counts it, **resetting per `panelCode#panelIndex` — i.e. per OBR** (`v2-transform.ts:433-441`) |

⇒ **No new blob decoding.** The OBX counter is already keyed on exactly the right thing. The ids are
in hand; the **cardinality** is the work.

⚠ `obx_set_id` currently mismatches v1 on **56 of 469** (11.9%). **Out of scope here** — but re-check
it after the cardinality change, since the counter's reset key becomes meaningful rather than
incidental.

---

## 5. Design

### 5.1 v2 payload — one `lab_request` per OBR

`V2LabRequest` gains **`obr_set_id: number`**. `toV2` emits **one record per `TESTINDEX`**, each
sourcing **its own** `panel_code`, `section_code`, `analysis_at`, `authorised_at`, `result_status`,
`tested_by` — not the primary panel's.

⚠ **`obr_set_id` is MANDATORY, not optional.** Optional means `?? 1` means collision means silent
loss (§1). **A record without it must not be emittable** — make the type require it.

### 5.2 FHIR — one OBR = one `ServiceRequest` + one `DiagnosticReport`

This is the **idiomatic** v2→FHIR mapping, not a workaround: OBR is the order, so it maps to
`ServiceRequest` + `DiagnosticReport`. Today `toFhir` builds **one of each per payload**
(`fhir-transform.ts:150,178`) — i.e. per lab.

⇒ A 5-OBR lab produces **5 ServiceRequests** and **DiagnosticReports for the surviving iterations
only** (§3). Each carries its own panel `code`, `status` and timings — which is precisely where the
87.7% / 13% divergence goes.

### 5.3 Where the set ids live

⚠ **FHIR has NO native field for OBR/OBX set ids.** The v2-to-FHIR IG treats Set IDs as
message-assembly mechanics and does not map them. But openldr v2 needs `obr_set_id` as a **business
key**, so it must be carried. **`identifier` is the right home** — these are source-system
coordinates, exactly what `identifier` is for — and **the pattern already exists in this codebase**
(`urn:openldr:request-id`, `urn:openldr:folder-no`, `urn:openldr:national-id`).

| id | resource | system |
|---|---|---|
| `obr_set_id` | `ServiceRequest.identifier`, mirrored on `DiagnosticReport.identifier` | `urn:openldr:obr-set-id` |
| `obx_set_id` | `Observation.identifier` | `urn:openldr:obx-set-id` |

**Rejected — an extension:** needs a StructureDefinition CE would have to publish, for data that is
not a clinical fact. **Rejected — array position** (`DiagnosticReport.result[]` order): positional
identity is fragile and unrecoverable once reordered.

### 5.4 Resource ids must not collide

`ServiceRequest.id = rootId` today — **one per payload**. N ServiceRequests need distinct ids
(`${rootId}-obr{n}`), and `Observation.basedOn` / `DiagnosticReport.result[]` must reference **the
right one**.

⚠ `fhir-transform.ts:334-337` centralises id derivation deliberately — *"so the id-derivation logic
lives in exactly one place and cannot drift."* **Keep that property.** It must become per-OBR
**without** scattering.

---

## 6. Blast radius — this changes CARDINALITY

Every consumer that assumes *one lab = one record* is affected. **Enumerate before building:**
- `toFhir` — resource graph + id derivation (§5.4)
- the **audit** — `auditFromSpecimen` is per-specimen; anomalies may now need an OBR
- **counters** — `payloads_built`, batch summaries, anything reporting "labs"
- the **V2↔v1 gate** — `diffV2Request` grades ONE payload against ONE v1 row
  (`fetchRequestByRequestId` returns the **lowest** OBRSetID, `openldr.ts:110`). **With N records it
  must pair per `obr_set_id`** — otherwise the gate's own numbers become meaningless and this slice
  cannot prove itself.
- **v2 ingest** — N records per lab is a volume change

---

## 7. Out of scope

- `obx_set_id`'s 11.9% mismatch (§4) — re-measure after, fix separately.
- `testing_facility_code`, `result_type`, `numeric_value`, `abnormal_flag` — separate slices.
- `detectDisaRejection`'s unfinished predicate. ⚠ **But this slice SHOULD close its knock-on:**
  `buildLabRequest` gates `orderedFallback` on `rejection.rejected` (`v2-transform.ts:283-287`), so
  11 observation-less labs lost their `panel_code` and would fail to migrate. **The fallback's real
  predicate is "no observations"**, and per-OBR emission makes that natural — each ordered panel
  names itself.
- Patient identity — deferred; `patient_guid = requestId` is SETTLED.

---

## 8. Acceptance

1. **T1 first:** `TESTINDEX ↔ OBRSetID` verified **at scale**, with the disagreement rate reported.
   **If it fails, STOP — this design is void.**
2. The gate reports `obr_set_id` **match**, not 158/158 `only_v1`, pairing per `obr_set_id`.
3. `analysis_at` / `result_status` / `tested_by` / `section_code` are sourced **per panel** — the
   53,011 / 7,845 / 23,600 / 45,173 divergences stop being crushed into one value.
4. Superseded iterations emit an **order with no results** (§3) — verified against a real multi-run
   lab such as `TZDISATDS0047711` (5 orders, results under OBR 3 and 4 only).
5. **A record cannot be emitted without `obr_set_id`** — enforced by the type, not a convention.
6. FHIR: N ServiceRequests with distinct ids, correct `basedOn`/`result[]` wiring, id derivation
   still in one place.
7. No regression: 190 tests / 189 pass / 1 pre-existing skip; DISA↔v1 gate output byte-identical.
