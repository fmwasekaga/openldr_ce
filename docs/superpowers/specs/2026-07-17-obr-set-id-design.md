# `obr_set_id` — CDR cannot represent a multi-panel request

**Status:** design, not started. **Repo:** `cdr-toolchain`, branch `slice/observation-timestamps`
(baseline `2fceb71`, 190 tests / 189 pass / 1 pre-existing skip).
**Evidence:** `docs/superpowers/specs/2026-07-17-mapping-gate-findings.md` §3.2 (`da9210c7`);
**T1 measurements (2026-07-17), §2 below.**

> **⚠ THIS SPEC HAS BEEN REWRITTEN BY ITS OWN T1 GATE.** The first draft's load-bearing claim —
> *"`TestResults[].TESTINDEX` **is** v1's `OBRSetID`, 1:1"* — is **FALSE** (93.6% at scale). T1 ran
> before any code was written and **replaced the source of `obr_set_id`**. §1's argument (CDR cannot
> represent a multi-panel request; `obr_set_id` must be mandatory) **survives intact and is
> strengthened**. Everything downstream of the *source* changed. See §2.

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

**T1 found a WHOLE CLASS the first draft could not see** (§2.3): panels that were **ordered but never
resulted** have **zero `TestResults` rows** and still get a v1 OBR row (status `I`). CDR sources
everything from `TestResults`, so it cannot emit these **at all** — not "emits one value that's wrong"
but "emits nothing." This strengthens §1.

⛔ **THE TRAP — the obvious fix is WORSE than the bug.** Emitting one record per panel **without also
emitting `obr_set_id`** makes every panel pin to `obr_set_id = 1`
(`external-persistence.service.ts:632`, `request?.obr_set_id ?? 1`) and collide on
`ON CONFLICT (request_id, obr_set_id, facility_id) DO UPDATE` (`:586`) — **N−1 panels silently
overwritten, arriving as a successful ingest.** Today CDR emits one *coherent* record; a half-fix
emits one *scrambled* one.

---

## 2. ✅ T1 — RUN. The claim was FALSE; the data named the replacement.

### 2.1 What was claimed vs what is true

**Claimed (n=1, `TZDISATDS0047711`):** `TestResults[].TESTINDEX` **is** `OBRSetID`, 1:1.
**Measured (random spread, `abs(checksum([LabNo])) % 25 = 0`, 3,874 labs with a v1 counterpart):**

| candidate | 838 labs | **3,874 labs** |
|---|---|---|
| **A.** raw `TESTINDEX` — *the claim* | 96.2% | **93.6%** ❌ |
| **B.** dense rank of `TESTINDEX` | 98.7% | 98.3% |
| **C.** **1-based position in `TestOrders[]`** | 100.0% | **99.95%** ✅ |
| **D.** distinct ordered codes × result iterations | 99.64% | — |
| **E.** distinct ordered codes, one OBR each — *what `v1-transform.ts:256` does today* | 99.28% | — |

Graded on **panel-code SEQUENCE** (`TestOrders[i] == v1.LIMSPanelCode @ OBRSetID i+1`), not on count
— a count-only test passes on the wrong ordering. Count and sequence agreed everywhere, so no lab
had the right shape with the wrong order.

**Why the n=1 lab could not settle it:** on `TZDISATDS0047711` the orders are
`[MRCSW,MRCSW,MRCSW,MICBM,MSENS]` and the TESTINDEXes are `1,2,3,4,5` — **position and TESTINDEX are
identical there.** The lab is consistent with A *and* C; it cannot discriminate. The first draft
printed the `TestOrders` line as decoration and read the answer off the wrong column.

**Why A fails:** v1's `OBRSetID` is **always dense 1..N** — measured `not_1_based: 0`,
`non_contiguous: 0` on 838 labs. DISA's `TESTINDEX` is **not**: it has gaps (`HIVVL#2, HIVVL#4`) and
can start at 2 (`HIVVL#2 → OBR 1`). A is right only *coincidentally*, whenever TESTINDEX happens to
already be dense.

**Independent corroboration — the codebase already knew.** `v1-transform.ts:352` derives OBRSetID
from `TestOrders` (*"Panels not in TestOrders fall back to a high OBRSetID"*). Two sources, one
answer. ⚠ But `v1-transform` is **candidate E (99.28%)**, not C — see §7.

### 2.2 The `+100` second slot — settled at POPULATION scale

`TESTINDEX` is a **real column** on `TESTDATA` (`TESTDATA.ts:64`), **not** a blob field, so this was
measured over the whole DB rather than the 4 labs the sample happened to contain:

```
TESTDATA rows                                                191,121  (105,860 labs)
rows with TESTINDEX > 100                                        397  (0.21%, 375 labs)
rows with TESTINDEX > 200                                          0  (max = 113)
high rows with a base partner at idx-100, SAME LABNO+TESTCODE  397/397  (100%)
base partner missing                                               0
```

⇒ A high row is **always a second slot on an existing `(LABNO, TESTCODE)`**, never a standalone
panel, and the offset is **never applied twice**. `TestOrders` has no entry for it ⇒ **it is not its
own OBR.** Its results belong to OBR `base(TESTINDEX)`.

⚠ **The MEANING of `+100` is unknown** (rerun? amendment? archive copy?) — user: *"your guess is as
good as mine."* **It does not need to be known.** The design needs only *which OBR owns these rows*,
and the structure answers that on 397/397. **Do not encode a guessed semantic.** Observed shape: the
base row often holds **only `RJREA`/`RJREM` rejection padding** while the `+100` row holds the real
observations (`COL#1` padding / `COL#101` 6 obs) — **an observation, NOT a rule**, n=2.

### 2.3 The two classes that broke every naive rule

**(a) Ordered but never resulted — `TestResults` is EMPTY.**
```
TDS0109482  TestOrders: ["ROTEL"]  TestResults: 0 entries   v1: OBR 1 ROTEL status=I
TDS0130552  TestOrders: ["PCRIN"]  TestResults: 0 entries   v1: OBR 1 PCRIN status=I
```
⇒ **An OBR exists with no result set at all.** Any `TestResults`-sourced design is structurally blind
to these. An OBR **is an order** — `TestOrders` is the source.

**Measured over OBR positions (838 labs):** `1,428` positions, `1,421` with results,
**`7` ordered-but-unresulted (0.5%)** — and v1's status on those is **`I` on 7 of 7**. A clean,
single-valued class, not noise.

**(b) Repeated codes — and they do NOT behave uniformly.**
```
TDS0047711  orders [MRCSW,MRCSW,MRCSW,MICBM,MSENS]  iters MRCSW:1/2/3  -> v1 5 rows (3x MRCSW)
TDS0068941  orders [HIVVL,VLID,HIVVL,HIVVL]         iters HIVVL:1/3/4  -> v1 4 rows, INTERLEAVED
TDS0010004  orders [CD4,CD4]                        iters CD4:1/2      -> v1 1 row   ⚠
TDS0066034  orders [...,RPR,RPR]                    iters RPR:6/7      -> v1 6 rows  ⚠
```
`TDS0068941` **kills candidate D**: v1 preserves the interleaved sequence `[HIVVL,VLID,HIVVL,HIVVL]`;
D regroups by code and gets `[HIVVL,HIVVL,HIVVL,VLID]`.

### 2.4 ⛔ The 0.05% residual is **v1's staleness**, not a missing rule — do NOT encode it

The 2 remaining failures (`TDS0010004`, `TDS0066034`) look like "v1 collapses duplicate orders."
**A rule built on that hypothesis (`F`: drop duplicate orders with no result iteration) was written,
measured, and DISCARDED — it scored 3872/3874, IDENTICAL to plain C, because the machinery never
fires.** The hypothesis was falsified by the data it was invented to explain: both labs have **as many
iterations as orders**, so nothing is dropped.

**The timestamps give the real cause — v1 is a POINT-IN-TIME migration and DISA kept changing:**

| lab | v1 `AnalysisDateTime` | DISA iteration `DATESTAMP` |
|---|---|---|
| `TDS0066034` RPR | **18:26** | `RPR#6` **18:30:21**, `RPR#7` **18:34:59** — *after* v1 captured it |
| `TDS0010004` CD4 | **2014-10-13** | both CD4 rows carry a **2016-03-08** bulk restamp |

⇒ v1 recorded one RPR at 18:26; DISA re-ran it twice afterwards. **CDR emitting 2 OBRs is arguably
MORE correct than v1's 1** — CDR exports current DISA truth. Per [[cdr-v1-ce-field-mapping]] this is
an **exception with a counted `expected`**, not a conditional rule and not a defect. **Chasing 100%
here means encoding v1's lag as CDR behaviour.**

⚠ `codes_with_more_iterations_than_orders`: **2 of 3,874** — a shape no examined lab covers. The
rule is **UNVERIFIED** there. Do not assume; if it matters, measure it.

### 2.5 ⛔ RETRACTED — a claim I made this session and the data reversed

I claimed `collectOrderedPanels`'s **dedupe** (`panels.ts:13`) is a defect, reasoning from
`[MRCSW,MRCSW,MRCSW] → 3 v1 rows`. **Wrong reason.** `TDS0010004` (`[CD4,CD4] → 1 v1 row`) proves
multiplicity does **not** come from repeated order entries. There **is** a real defect there, but it
is candidate **E (99.28%)**: one OBR per *distinct code* never restores the multiplicity that real
reruns create. **~0.7% of labs, in the v1 path** — see §7.

### 2.6 The falsifiers, and what they returned

| falsifier | result |
|---|---|
| `TESTINDEX` set ≠ `OBRSetID` set | **6.4% of labs** ⇒ claim A dead |
| non-contiguous / non-1-based `OBRSetID` | **0 / 0** ⇒ v1 is always dense 1..N |
| `TESTINDEX` colliding across panels | **0** |
| per-index panel-code agreement | **274/274**, and per-rank **1413/1413** |

---

## 3. Superseded iterations — orders survive, results do not

Same lab (`TZDISATDS0047711`), v1's `LabResults`:
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

⚠ **T1 adds a constraint here.** `supersedePanelIterations` keys its winner on **`panelCode` alone**
(`result-mapping.ts:511`), so it collapses across what are now **separate OBRs**. Under per-OBR
emission its key must become **per-OBR**, or three MRCSW OBRs will fight over one winner. **Its
current behaviour is only accidentally right** because everything was crushed into one record anyway.

---

## 4. The source — CORRECTED by T1

| id | source | already in CDR? |
|---|---|---|
| `obr_set_id` | ⛔ ~~`TestResults[].TESTINDEX`~~ → **1-based position in `TestOrders[]`** (§2.1, 99.95%) | ⚠ `TestOrders` is decoded (`specimenrecpt.ts:239`, from `regdat4.Tests`) but **only ever read for `[0]`** (`mapping.ts:137`) or **deduped** (`panels.ts`) |
| result → OBR | rank linkage over `base(TESTINDEX)`, `base(i) = i > 100 ? i-100 : i` (§4.1) | `flattenDisa` has `TESTINDEX` as `panelIndex` (`result-mapping.ts:570-572`) |
| `obx_set_id` | position within `TestResults[].ORDER[]` | ✅ `buildLabResults` counts it, **resetting per `panelCode#panelIndex`** (`v2-transform.ts:433-441`) |

⇒ **No new blob decoding** — but the first draft's claim that *"the ids are in hand"* was **only half
true**: `obr_set_id`'s real source (`TestOrders` position) is decoded yet **never used as a sequence**.

⚠ **`TestOrders` is a flat `unknown[]` of codes** — position is the **only** linkage. It carries no
index of its own.

⚠ `obx_set_id` currently mismatches v1 on **56 of 469** (11.9%). **Out of scope here** — but re-check
it after the cardinality change, since the counter's reset key becomes meaningful rather than
incidental.

### 4.1 Linking a result set to its OBR — measured, but NOT discriminated

`TESTINDEX` is **not** the position (`HIVVL#2 → OBR 1`), so results link by **rank**. Two rules were
graded (838 labs, 1,425 result sets):

| rule | definition | result |
|---|---|---|
| **G** | rank of `base(TESTINDEX)` **globally** across the lab | **1425/1425 (100%)** |
| **P** | the *i*-th distinct `base(TESTINDEX)` of code `C` → the *i*-th occurrence of `C` in `TestOrders` | **1425/1425 (100%)** |

`labs_fully_linked: 838/838`. **`rules_disagree_on_position`: 0** — on real data the two are
**indistinguishable**, so **the measurement does NOT choose between them.**

⇒ **Prefer P, as a JUDGEMENT and not a finding.** G is unsafe in a shape the corpus happens not to
contain: a lab ordering `[A,B]` that resulted only `B` would rank `B` to position 1 and **file B's
results under A**. P cannot — it matches on code first. ⚠ **Do not cite "100%" as evidence for P over
G.** If P is chosen, the `[A,B]`-resulting-only-`B` case needs a **unit test**, since no live lab
exercises it.

### 5.1 v2 payload — one `lab_request` per OBR

`V2LabRequest` gains **`obr_set_id: number`**. `toV2` emits **one record per `TestOrders` position**
(**not** per `TESTINDEX` — §2.1), each sourcing **its own** `panel_code`, `section_code`,
`analysis_at`, `authorised_at`, `result_status`, `tested_by` — not the primary panel's.

**Emission rule (measured, §2):**
1. `obr_set_id` = 1-based index into `TestOrders[]`, **in sequence** (never regrouped — §2.3b).
2. `panel_code` = `TestOrders[obr_set_id - 1]`.
3. Results attach via `base(TESTINDEX)`; `+100` rows attach to their base OBR (§2.2).
4. A position with **no** result set still emits a request (§2.3a) — with **no** results under it.

⚠ **`obr_set_id` is MANDATORY, not optional.** Optional means `?? 1` means collision means silent
loss (§1). **A record without it must not be emittable** — make the type require it.

⚠ **`V2Payload` is single-`lab_request` today** (`lab_request: V2LabRequest`, one `lab_results[]`).
This is a **shape change to the payload**, not a field addition. See §6.

#### 5.1a ✅ DECIDED (user, 2026-07-17) — `lab_requests[]`, and **v2 is legacy**

The payload shape was a real fork, because `V2Payload` feeds **two** consumers that want opposite
things. **Verified, not assumed:**

| consumer | what it does today | file:line |
|---|---|---|
| **openldr-v2 ingest** | reads **`message?.lab_request`** — *singular* | `external-persistence.service.ts:534`, and `:117` `requests: message?.lab_request ? 1 : 0` |
| **CE / FHIR** | `toFhir(payload: V2Payload)` → **ONE** `ServiceRequest` + **ONE** `DiagnosticReport`, both `id: rootId` | `fhir-transform.ts:323-324,150,178` |

⚠ **These live in a THIRD repo** (`D:\Projects\Repositories\openldr-v2`) — **not** `openldr_ce`, **not**
`cdr-toolchain`. `obr_set_id` appears **nowhere in `openldr_ce`'s code**, only in docs.

**DECISION:** `V2Payload.lab_requests: V2LabRequest[]` (one payload per lab, N requests inside), and
**CE is the target; openldr-v2 is legacy** — a gate/comparison artifact, **not a live ingest
consumer**. ⇒ **openldr-v2 is OUT OF SCOPE. Do not edit it. Do not treat `?? 1` as a bug to fix
there.**

⇒ **§6's "v2 ingest — N records per lab is a volume change" was WRONG** and is superseded: it would
have been a **wire-contract break** in a third repo, not a volume change. That break is now moot,
because we are not feeding it.

⚠ **The rejected option is worth knowing:** `toV2` returning `V2Payload[]` (one per OBR) would need
**zero** v2-side change — `:632`'s `request?.obr_set_id ?? 1` starts working the instant we populate
it. It was rejected because it duplicates `patient` + `data_quality` N times and makes `toFhir` emit
N Bundles with **N duplicate Patients**, contradicting §5.2.

### 5.2 FHIR — one OBR = one `ServiceRequest` + one `DiagnosticReport`

This is the **idiomatic** v2→FHIR mapping, not a workaround: OBR is the order, so it maps to
`ServiceRequest` + `DiagnosticReport`. Today `toFhir` builds **one of each per payload**
(`fhir-transform.ts:150,178`) — i.e. per lab.

⇒ A 5-OBR lab produces **5 ServiceRequests** and **DiagnosticReports for the surviving iterations
only** (§3). Each carries its own panel `code`, `status` and timings — which is precisely where the
87.7% / 13% divergence goes.

⚠ An **ordered-but-unresulted** OBR (§2.3a) is a `ServiceRequest` with **no `DiagnosticReport`** —
the same shape as a superseded iteration (§3), reached for a different reason. v1 marks it `I`.

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
- **`V2Payload`'s shape** — one `lab_request` → N; `lab_results` must bind to an OBR (§5.1)
- `toFhir` — resource graph + id derivation (§5.4)
- `supersedePanelIterations` — its winner key is `panelCode`, which now spans OBRs (§3)
- the **audit** — `auditFromSpecimen` is per-specimen; anomalies may now need an OBR
- **counters** — `payloads_built`, batch summaries, anything reporting "labs"
- the **V2↔v1 gate** — `diffV2Request` grades ONE payload against ONE v1 row
  (`fetchRequestByRequestId` returns the **lowest** OBRSetID, `openldr.ts:110`). **With N records it
  must pair per `obr_set_id`** — otherwise the gate's own numbers become meaningless and this slice
  cannot prove itself.
- ~~**v2 ingest** — N records per lab is a volume change~~ ⛔ **WRONG, and superseded by §5.1a.** It
  would have been a **wire-contract break** in a third repo (`openldr-v2`), not a volume change.
  **Moot: v2 is legacy and out of scope.**

---

## 7. Out of scope

- `obx_set_id`'s 11.9% mismatch (§4) — re-measure after, fix separately.
- `testing_facility_code`, `result_type`, `numeric_value`, `abnormal_flag` — separate slices.
- **`v1-transform.ts:256` emits one OBR per DISTINCT ordered code (candidate E, 99.28%)** — a real,
  measured defect found by T1 (§2.5), **~0.7% of labs**. It is in the **v1 export path**, not the
  v2/CE path this slice targets. **File separately; do not fold in.**
- `detectDisaRejection`'s unfinished predicate. ⚠ **But this slice SHOULD close its knock-on:**
  `buildLabRequest` gates `orderedFallback` on `rejection.rejected` (`v2-transform.ts:283-287`) **and
  takes only `TestOrders[0]`**, so 11 observation-less labs lost their `panel_code` and would fail to
  migrate. **The fallback's real predicate is "no observations"**, and per-OBR emission makes it
  natural — each ordered panel names itself, so the fallback **disappears** rather than being fixed.
- Patient identity — deferred; `patient_guid = requestId` is SETTLED.

---

## 8. Acceptance

1. ~~T1 first~~ ✅ **DONE (§2).** `obr_set_id` = **`TestOrders` position** (99.95% at n=3,874), **not**
   `TESTINDEX` (93.6%). The design is **re-founded**, not void.
2. The gate reports `obr_set_id` **match**, not 158/158 `only_v1`, pairing per `obr_set_id`.
3. ⛔ **CORRECTED — this was OVER-PROMISED. Only `section_code` is in reach.** The original read:
   *"`analysis_at` / `result_status` / `tested_by` / `section_code` are sourced per panel — the
   53,011 / 7,845 / 23,600 / 45,173 divergences stop being crushed into one value."* **Three of the
   four are NOT "crushed into one value" — they are NOT SOURCED AT ALL**, so making them per-OBR
   changes `null` into `null` per OBR. Verified in `buildLabRequest`:

   | field | v1 divergence | today | this slice? |
   |---|---|---|---|
   | `section_code` | 45,173 | `panel?.section` — derived from `panel_code` (`v2-transform.ts:349`) | ✅ **YES** — per-OBR for free, once `panel_code` is per-OBR |
   | `analysis_at` | 53,011 | **`null` — hardcoded stub**, *"disalab doesn't expose analysis_at on SpecimenRecpt"* (`:357`) | ❌ **NO** — needs the **timestamps** slice ([[disa-timestamp-stub-and-amr-zero-rows]]) |
   | `tested_by` | 23,600 | `nz(s.ReceivedInLabBy) ?? nz(s.TakenBy) ?? nz(s.CollectedBy)` (`:379`) — **specimen-level** | ❌ **NO** — v1's is per-OBR; needs sourcing (cf. `TESTDATA_STATUS[77..79]`, [[disa-result-status-signal]]) |
   | `result_status` | 7,845 | `rejection.rejected ? "X" : null` (`:372`) — **specimen-level** `detectDisaRejection` | ❌ **NO** — needs **per-OBR** rejection detection |

   ⇒ **Acceptance #3 is now: `panel_code` and `section_code` are per-OBR.** The other three become
   **per-OBR-shaped holes** this slice creates and later slices fill. That is the honest sequencing:
   **the structure must exist before the values can hang off it.** ⚠ Do NOT let a future plan claim
   #3 is met because the fields are "now per-OBR" — a per-OBR `null` is still `null`.
4. Superseded iterations emit an **order with no results** (§3) — verified against a real multi-run
   lab such as `TZDISATDS0047711` (5 orders, results under OBR 3 and 4 only).
5. **A record cannot be emitted without `obr_set_id`** — enforced by the type, not a convention.
6. FHIR: N ServiceRequests with distinct ids, correct `basedOn`/`result[]` wiring, id derivation
   still in one place.
7. **Ordered-but-unresulted panels emit a request** (§2.3a) — `TDS0109482` (`ROTEL`, 0 TestResults)
   must emit **1** request. Today CDR emits **none**.
8. **`+100` rows attach to their base OBR** (§2.2) — `TDS0012427` (`COL#1` + `COL#101`) emits **2**
   requests (`COL`, `RNAHF`), **not 3**.
9. The **0.05% v1-snapshot residual** (§2.4) is an **exception with a counted `expected`** — it must
   not be "fixed", and a regression must still fail.
10. No regression: 190 tests / 189 pass / 1 pre-existing skip; DISA↔v1 gate output byte-identical.

---

## 9. Provenance of the T1 numbers

Throwaway probes (`apps/cli/probe-t1*.ts`, **not committed**), random spread sample
`abs(checksum([LabNo])) % 25 = 0` → 5,090 labs, 3,874 with a v1 counterpart. ⚠ **Never `--limit N`**
— that returns the N **oldest** labs incl. `INSTRUMENT VALIDATION` QC (`compare-batch.ts:202`).
Population counts (§2.2) are direct SQL over `TESTDATA`.

⚠ **Widening the sample moved the numbers TWICE**: A 96.2% → 93.6%, and C **100.0% (838) → 99.95%
(3,874)** — the 838-lab sample contained **zero** of the `[CD4,CD4]` cases. **A 100% on the smaller
sample would have been reported as certainty.** This is the 4th sample-size reversal in this
workstream; see [[plans-cite-or-flag]].
