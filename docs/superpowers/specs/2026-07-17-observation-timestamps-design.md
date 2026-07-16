# Observation timestamps — `effectiveDateTime` + `issued` — Design

**Date:** 2026-07-17
**Status:** Design agreed in brainstorm. NOT implemented.
**Repos:** `cdr-toolchain` (the mapper) **+** `openldr_ce` (column + 5 seeded queries)
**Blocks:** [[fhir-bundle-wire-contract]]'s profile (D2) — see §1.3

---

## 1. Why

### 1.1 The live bug

**`result_timestamp: null` is a HARDCODED STUB** — `cdr-toolchain apps/cli/src/export/v2-transform.ts:499`,
sitting next to `abnormal_flag: null`. It is not a faithful mapping; the field was never wired.

Chain, verified end-to-end:
- `fhir-transform.ts:244` — `effectiveDateTime: fhirDateTime(r.result_timestamp, opts.tzOffset)`
  always receives `null` ⇒ helper returns `undefined` ⇒ `compact()` drops the key.
- ⇒ **0 of 135** ingested CE Observations carry **any** time field (measured: `jsonb_object_keys`).
- ⇒ **`lab_results.result_timestamp` is NULL on 135/135** (measured in `openldr_target`).
- ⇒ **`q-amr-resistance` and `q-amr-facility-summary` return ZERO rows for ANY date range** —
  measured, not reasoned: `select count(*) … where o.result_timestamp >= '2013-01-01' …` → **0**.
  `NULL >= x` is never true. **Silent.**

The other three (`q-amr-glass-ris`, `q-amr-first-isolate-summary`, `q-amr-antibiogram`) survive via
`coalesce(oo.result_timestamp, s.received_time)` **plus** an explicit `is null OR in-range` escape.
**Someone solved this once and patched 3 of 5.**

### 1.2 Two fields, both wrong

**HL7 R4, fetched and quoted — not recalled** (https://hl7.org/fhir/R4/observation-definitions.html):

> **`effective[x]`**: *"The time or time-period the observed value is asserted as being true … usually
> called the 'physiologically relevant time'. This is usually either the time of the procedure or
> **of specimen collection**."*
>
> **`issued`**: *"The date and time this version of the observation was **made available to
> providers, typically after the results have been reviewed and verified**."*

⇒ **`effectiveDateTime` is NOT the resulted datetime.** It is the **collection** time.
⇒ The mapper puts the *result* time into the *collection* field — **the same semantic mismatch this
repo has been chasing all week, in our own code.**
⇒ **CE's column is misnamed too**: `lab_results.result_timestamp` ← `str(r['effectiveDateTime'])`
(`relational/observation.ts:28`) — it holds the **collection** time. Name says one thing, mapping
says another.

### 1.3 Why this blocks the Bundle slice

[[fhir-bundle-wire-contract]] D2 = *enforce a CE ingest profile, reject loudly*, and its headline
required field is `Observation.effectiveDateTime` — which **100% of our own production payload
lacks**. Requiring it today rejects our own data. **Fix the mapper first.**

---

## 2. Decisions taken in brainstorm

| # | Decision |
|---|---|
| D1 | **`effectiveDateTime` ← collection time; `issued` ← `TESTDATA.DATESTAMP`.** Both per the R4 text. |
| D2 | **Add `lab_results.issued`; leave `result_timestamp` as-is.** Additive, non-breaking. Rename = debt (§7). |
| D3 | **Fix `q-amr-resistance` + `q-amr-facility-summary`** with the coalesce + null-escape. |
| D4 | **ALL FIVE queries share ONE coalesce chain.** ⇒ the three "working" queries change too. |

**D2 rationale:** the external warehouse is a **public** surface — third parties query it, plus 15
seeded SQL strings, `glass.ts`, and the parity fixtures. A rename is breaking and there is **no
deprecation mechanism** in the repo. Additive now; rename is its own decision.

**D4 rationale (user):** *"all 5 should share the same coalesce chain"*. One rule, not two.

---

## 3. Verified facts

Everything cited was read at the line or measured. **Unread/unmeasured items are marked SKETCH.**

### 3.1 ⚠ DISA stores BLOBS, not columns — do not re-derive this by SQL

`packages/disalab/src/lib/DisalabData/REGDAT4.ts:94-98`:
```ts
this.RegisteredDatetime = Core.Trim(Core.DisaDatetimeValue(bytes, 126, 130, 132, 134));
this.TakenDateTime      = Core.Trim(Core.DisaDatetimeShortValue(bytes, 615, 619));
```
**Measuring `select count(Taken_Date_Time) from REGDAT4` measures the WRONG LAYER** — it reads
104/129,408 while the real value sits at **bytes 615-619**. See [[disa-stores-blobs-not-columns]].
`SpecimenRecpt` (`packages/disalab/src/lib/Forms/specimenrecpt.ts`) is the resolver; it answers
"does DISA have time X?", **not** `information_schema`.

### 3.2 What is available (measured on the laptop — **1 site of 22**)

| need | source | availability |
|---|---|---|
| **collection** → `effectiveDateTime` | `SpecimenRecpt.TakenDateTime` (`:43`) — REGDAT4 blob, **fallback** `RTKNIDX5.TAKENDATE` (`:227-235`) | `RTKNIDX5.TAKENDATE` = **106,212/106,212 (100%)**, **date-only (midnight)** |
| **release** → `issued` | `TESTDATA.DATESTAMP` — a **real** column | **191,121/191,121 (100%)**, real values (`2019-01-23 15:56:42`) |
| per-result timestamp | — | **does not exist.** Finest granularity = per-**panel-iteration** `DATESTAMP`. `OrderItem`'s `Date`/`Time` types (`orderitem.ts:62,84-85`) are result **VALUE** types. **Do not hunt for one.** |
| `TESTDATA.TESTEDDATE` / `REVIEWEDDATE` | — | **0/191,121** — exist, entirely empty. |

### 3.3 The V2 payload already carries what we need

- `V2Result.result_timestamp: string | null` — `apps/cli/src/export/types.ts:78`. **Stubbed** at
  `v2-transform.ts:499`.
- The **request** type carries `taken_datetime`, `collected_datetime`, `received_at` —
  `types.ts:35-37`. **Populated.**
- **The mapper ALREADY resolves the collection time** — `fhir-transform.ts:184` uses
  `lr.taken_datetime ?? lr.collected_datetime` for **DiagnosticReport**`.effectiveDateTime`.
  **The Observation simply never gets it.**

### 3.4 Date-only is valid and already handled — do NOT fabricate midnight

- CE: `DATETIME_RE = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?)?)?$/`
  (`packages/fhir/src/datatypes/primitives.ts:6`) ⇒ **`fhirDateTime` ACCEPTS `"2019-01-17"`.**
  ⚠ This **corrects** [[cdr-ce-fhir-ingest]]'s note that "fhirDateTime needs a zone" — that is
  `fhirInstant` (`INSTANT_RE`, `:7`), not `fhirDateTime`.
- cdr: `fhirDateTime` (`apps/cli/src/export/fhir-primitives.ts:54+`) already branches —
  *"Date-only is valid FHIR as-is; no zone applies"* ⇒ date-only passes through **unzoned**; only
  unzoned wall-clock gets `tzOffset` stamped.
- `disaToIso` (`v2-transform.ts:42-50`) returns `YYYY-MM-DD` when the source has **no time part**
  (`:48`).

⇒ When only `RTKNIDX5.TAKENDATE` is available, emit **`"2019-01-17"`** — **never**
`"2019-01-17T00:00:00+03:00"`, which would assert a collection time we do not have.

### 3.5 CE already has the shapes

- `Observation` schema **already accepts `issued`** — `packages/fhir/src/resources/observation.ts:28`:
  `issued: fhirInstant.optional()` (and `:27` `effectiveDateTime: fhirDateTime.optional()`).
- `diagnostic_reports.issued` **already exists** (`schema/external.ts:80`) and is projected
  (`relational/diagnostic-report.ts:14`: `issued: str(r['issued'])`). **Precedent for D2.**
- `lab_results` has `result_timestamp` (`schema/external.ts:50`) and **no** `issued`.

### 3.6 The SQL blast radius — counted, not estimated

`grep -c` on `packages/reporting/src/seed/report-seeds.ts`:

| | count | sites |
|---|---|---|
| `coalesce(oo.result_timestamp, s.received_time)` | **36** | 9 blocks (**3 queries × 3 dialects**), 4 per block (1 `select` + 3 `where`) — `705-713`, `801-809`, `904-912`, `1015-1023`, `1094-1102`, `1188-1196`, `1310-1315`, `1359-1364`, `1415-1420` |
| bare `and o.result_timestamp >=` | **6** | `178`, `198`, `217` (`q-amr-resistance`), `603`, `618`, `633` (`q-amr-facility-summary`) |
| bare `o.result_timestamp <=` | **6** | `179`, `199`, `218`, `604`, `619`, `634` |

⇒ **15 SQL strings across 5 queries; 48 edit sites.**

### 3.7 ⚠ The two broken queries do NOT join `specimens`

`q-amr-resistance` is `from lab_results o` (`:176`) — **no specimen join**.
`q-amr-facility-summary` is `from lab_results o join patients p on o.patient_id = p.id` (`:598-599`)
— **no specimen join**.
The three working queries use alias `oo` **and** join `s`.

⇒ **D4 (one shared chain) requires ADDING `left join specimens s on s.id = o.specimen_id` to both** —
**6 new joins** (2 queries × 3 dialects). This is not a find-and-replace.

### 3.8 Seed mechanics

`SEED_QUERIES` **managed-overwrites** on upgrade (`report-seeds.ts:1803-1810`) ⇒ the SQL fix **reaches
existing installs**. `SEED_DESIGNS`/`SEED_REPORT_DEFS` are **create-only** (`:1811-1825`) — irrelevant
here, because this slice changes **no columns of any report**.

---

## 4. Design

### 4.1 cdr-toolchain — stop lying in two places at once

**(a) `result_timestamp` becomes what its NAME says.** `v2-transform.ts:499`:
```
result_timestamp: null,                          // stub
→ result_timestamp: <TESTDATA.DATESTAMP, via disaToIso>
```
> **SKETCH — verify before coding:** that `TESTDATA.DATESTAMP` is in scope at `:499`. The `TESTDATA`
> class carries it (`packages/disalab/src/lib/DisalabData/TESTDATA.ts` constructor), and
> `compare/result-mapping.ts:12-16` already consumes it — but I have **not** read the builder's
> parameters at `:499`.

**(b) `fhir-transform.ts:244` — re-point it to the RIGHT field.**
```
effectiveDateTime: fhirDateTime(r.result_timestamp, opts.tzOffset)   // WRONG: result time in the collection field
→ issued:            <instant>(r.result_timestamp, opts.tzOffset)    // release time
→ effectiveDateTime: fhirDateTime(lr.taken_datetime ?? lr.collected_datetime, opts.tzOffset)
```
The `effectiveDateTime` expression is **byte-identical to `fhir-transform.ts:184`**, which already
does this for `DiagnosticReport`. **Reuse it; do not invent a second rule.**

> **SKETCH — PLUMBING.** The Observation builder does **not** currently receive the lab request. I
> read its body (`:236-248`), **not its signature**. Passing `lr` (or just the resolved collection
> datetime) in is a **real change**, not a one-liner. Verify the call site first.

**(c) ⚠ `issued` is `fhirInstant` — it MUST be fully zoned.** `fhirDateTime` would happily emit
date-only for a timeless `DATESTAMP`, and CE's `issued: fhirInstant` (`observation.ts:28`) would
then **reject the entire resource**. **A date-only `issued` must be OMITTED, not emitted.**
Use a helper that returns `undefined` unless the value is a full zoned instant.
`effectiveDateTime` has **no** such constraint (§3.4) — date-only is correct there.

**(d) Keep date-only date-only.** §3.4. Never stamp midnight onto a date we only know to a day.

### 4.2 openldr_ce — one additive column

- **New external migration**: `alter table lab_results add column issued text` (nullable).
  Mirror `diagnostic_reports.issued` exactly (`schema/external.ts:80`).
- `schema/external.ts` — add `issued: string | null` to `LabResultsTable` (currently `:38-54`).
- `relational/observation.ts` — add `issued: str(r['issued'])`, mirroring
  `relational/diagnostic-report.ts:14`.
- ⚠ **`result_timestamp` keeps reading `effectiveDateTime`** (`observation.ts:28`) — **unchanged**.
  Per D2 it continues to hold the **collection** time despite its name.

⚠ **Rule 8:** `LabResultsTable` is a **shared type**. Widening it obliges `turbo typecheck` across
**every** consuming package — vitest strips types and stays green over a type error.

### 4.3 openldr_ce — the one shared chain (D4)

**The chain, everywhere:**
```sql
coalesce(<obs>.result_timestamp, s.received_time, <obs>.issued)
```
**Order rationale — chronological proximity to the clinically relevant moment:** collection
(`result_timestamp`) → specimen received (closest proxy for collection) → release (`issued`, last
resort). This **appends** `issued` to the existing 3's chain, preserving their current precedence.

**And the escape, everywhere** (already present on the 3, new on the 2):
```sql
where <chain> is null
   or (<chain> >= {{param.from}} and <chain> <= (<param.to> || 'T23:59:59.999Z'))
```
⚠ **The `is null` escape is the fail-open rule**: a record with **no** time stays **VISIBLE** rather
than silently dropped. Same principle as [[amr-terminology-slice-c]] D4 (unknown organisms fail
open). **Loud and slightly wrong beats quiet and wrong.**

**Work, per §3.6/§3.7:**
- **3 queries × 3 dialects (9 strings, 36 sites)** — extend the chain with `, oo.issued`.
- **2 queries × 3 dialects (6 strings, 12 predicates)** — replace bare `>=`/`<=` with chain +
  escape, **AND add `left join specimens s on s.id = o.specimen_id`** (**6 new joins**).

⚠ **Write each dialect's string explicitly.** The `to`-concat differs per dialect —
`|| 'T…'` (pg), `+ 'T…'` (mssql), `concat(…, 'T…')` (mysql) — see `:713` / `:809` / `:912`. Do **not**
find-and-replace across dialects.

### 4.4 Healing existing data — re-ingest, NOT reproject

⚠ **Reprojection CANNOT fix the 135 rows.** The stored FHIR resources **themselves** have no
`effectiveDateTime` (measured — the key is absent). `reprojectAll` re-reads that same resource and
gets the same nothing. **The only cure is re-running the export from DISA**, which upserts to v2
(`fhir-store.ts:214+`). This applies to **any** deployment, not just dev.

(Independently: `reprojectAll` has **no production callers** — [[ce-projection-drops-provenance]].)

---

## 5. Testing

**Rule 7 — every assertion must be able to FAIL.** Name the mutation that turns each red.

**cdr-toolchain** (`node:test`, **not** vitest):

| test | must fail when |
|---|---|
| `Observation.issued` == the panel's `DATESTAMP`, zoned | the `:499` stub returns |
| `Observation.effectiveDateTime` == the request's `taken_datetime` | it regresses to `r.result_timestamp` (**the current bug**) |
| a **date-only** taken date ⇒ `effectiveDateTime === "2019-01-17"` — **no `T00:00:00`, no offset** | someone stamps midnight (§3.4) |
| a **timeless** `DATESTAMP` ⇒ `issued` is **OMITTED** (not date-only) | §4.1(c) regresses ⇒ CE rejects the whole resource |
| R4 conformance gate still passes | `FHIR_CONFORMANCE=1 node --import tsx --test src/export/fhir-conformance.test.ts` |

**openldr_ce** (**vitest**):

| test | must fail when |
|---|---|
| `projectObservation` maps `issued` → `lab_results.issued` | the projection line is missed |
| `projectObservation` still maps `effectiveDateTime` → `result_timestamp` | someone "helpfully" re-points it (D2 says leave it) |
| a row with **NULL** time is **RETURNED** by all 5 queries (fail-open) | the `is null` escape is dropped from any dialect |
| a row with **only `issued`** is returned by all 5 | the chain omits `issued` in any dialect |
| a row **outside** the range is **EXCLUDED** | ⚠ **vacuity guard** — an `is null OR …` that always matches would pass every other test here |

⚠ **The 5 parity tests pin NOTHING** — all are `it.skip` + `expect(true).toBe(true)`
([[amr-terminology-slice-c]]). **Do not "update" them; they assert nothing.** Treat the AMR SQL as
**untested** and write real assertions.

**Live proof — the only evidence that matters.** 6 real DISA labs are ingested.
```sql
-- BEFORE: 135 / 0 / 0
select count(*) total, count(result_timestamp) has_effective, count(issued) has_issued from lab_results;
```
Re-ingest, then require: **`has_effective` > 0 AND `has_issued` = 135**, and
```sql
-- currently returns 0 for ANY range; must return > 0
select count(*) from lab_results o where o.abnormal_flag in ('S','I','R')
  and o.result_timestamp >= '2013-01-01' and o.result_timestamp <= '2020-01-01T23:59:59.999Z';
```

**Gate:** `pnpm turbo run typecheck test --force` (Rule 8 — §4.2 widens a shared type).

---

## 6. Regression modes

- **`issued` emitted date-only** ⇒ `fhirInstant` rejects ⇒ **the whole resource fails to persist**.
  Loud, but it would fail *every* record. §4.1(c).
- **`effectiveDateTime` stamped with midnight** ⇒ we assert a collection time we never had. **Silent
  and permanent** — it looks like data.
- **The `is null` escape dropped from one dialect** ⇒ that dialect silently returns fewer rows.
  **Only a live run on a real MSSQL/MySQL warehouse catches it** — the parity tests are inert, and
  the dev DB is Postgres.
- **`specimens` join added to only 2 of 3 dialects** of a broken query ⇒ silent divergence.
- **`disaToIso` passes an unrecognised string through unchanged** (`v2-transform.ts:46`) ⇒ if
  `RTKNIDX5.TAKENDATE` arrives in an unexpected shape (§8), a **garbage string** reaches
  `fhirDateTime`, which returns `undefined`, and the field is **silently dropped** — landing us
  exactly where we started, with a green test suite.

---

## 7. Explicitly out of scope

- **Renaming `result_timestamp`** to `effective_at`/`collected_at`. It is misnamed (§1.2) — it holds
  the **collection** time. But the warehouse is a **public** surface (third parties + 15 seeded SQL
  strings + `glass.ts` + fixtures) and there is **no deprecation mechanism**. **Real debt. Named.**
- **`abnormal_flag: null`** — the *other* hardcoded stub on the same line as `result_timestamp`
  (`v2-transform.ts:496`). 31/135 rows have a flag (via the isolate/AST path), so the flat path's
  stub may be hiding data. **Same bug class, same file, NOT investigated. Named so it is not lost.**
- **The Bundle profile** ([[fhir-bundle-wire-contract]]) — this slice unblocks it; it does not
  implement it.
- **Auditing every seeded query for bare comparisons against nullable columns.** The same NULL-swallow
  may exist on facility/patient/specimen predicates. Named.
- **Slice C** ([[amr-terminology-slice-c]]) — orthogonal.

---

## 8. Known caveats

- ⚠ **`SpecimenRecpt.TakenDateTime` has TWO possible shapes and the fallback path is UNVERIFIED.**
  From the REGDAT4 **blob** it is `Core.DisaDatetimeShortValue(...)` (a DISA string `disaToIso`
  parses). From the **fallback** it is `rtknidx5[0].TAKENDATE` — a **SQL `datetime` via the mssql
  driver**, shape **UNKNOWN** (Date object? ISO string?). **`disaToIso` passes anything it does not
  recognise straight through (`v2-transform.ts:46`)**, so a shape mismatch fails **silently**.
  **THIS IS THE HIGHEST-RISK UNKNOWN. Verify against real data before trusting the fallback.**
- **1 site of 22.** Every measurement here is the laptop's subset; the full dataset is on the user's
  **Linux desktop**. `TESTEDDATE`/`REVIEWEDDATE` being 0% here may not hold nationally.
  [[cdr-ce-fhir-ingest]] already warns the compare gate **never covered** `analysis_at`/`authorised_at`
  — this bug is that gap surfacing.
- **Timezone is per-deployment config, never defaulted** — Tanzania `+03:00`, Moz/Zambia `+02:00`
  ([[cdr-ce-fhir-ingest]]). DISA stores unzoned local wall-clock. A UTC fallback silently shifts every
  clinical timestamp. `issued` is the field newly exposed to this.
- **Pre-existing rows keep NULLs until re-ingested** (§4.4), and there is no automated backfill.
