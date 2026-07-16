# AMR organism semantics (Slice C) — Design

**Date:** 2026-07-16 (rewritten — supersedes the DISPUTED draft of the same date)
**Status:** Design agreed in brainstorm. Not implemented.
**Repos:** `openldr_ce` only. **cdr-toolchain needs NO change** — see §0.
**Depends on:** Slice A (organism classifier) — DONE, `3c3f120` in `cdr-toolchain`

---

## 0. What changed, and why this spec exists

The previous draft hardcoded a clinical vocabulary into 9 SQL strings and grew a hand-maintained
antibiotic list. The user stopped it:

> *"we have terminology page for a reason, so we don't have to hardcode things … we built this
> together very well in `corlix` … these are sort of ideas/references you look into and think how can
> we adopt."*

That draft reached "ValueSets are impossible here" from a real obstacle and treated it as a licence.
Applying [[plans-cite-or-flag]] Rule 0 — *name what would make this false, then check that* — the
obstacle dissolved. **Every load-bearing claim below was verified against the running system**
(live dev DB + the actual files), not recalled.

### Falsification table for this session

| The disputed draft asserted | Falsifier I checked | Reality |
|---|---|---|
| "`value_sets` is internal, reports run on the external warehouse, so they cannot join" | *Is the ValueSet only in the internal table?* | **FALSE.** ValueSets are **already FHIR resources** in `fhir.fhir_resources` (6 of them, beside 135 Observations) and already carry a materialized `expansion.contains[]`. The projection worker fans that store into the warehouse. Verified live. |
| "reference data can't cross into the warehouse" | *Does any non-clinical resource project today?* | **FALSE.** `Organization`/`Location` → `facilities` — `relational/index.ts:29-30`. Master data already crosses. |
| "the AMR parity tests pin the SQL; they will need updating" | *Read them.* | **FALSE.** All **5** `amr-*-parity.test.ts` are `it.skip` with `expect(true).toBe(true)`. They pin **nothing**. There is no safety net. |
| "`ANTIBIOGRAM_PANEL` is a vocabulary problem; add 6 antibiotics" | *Why does the list exist at all?* | **Misdiagnosed.** Its own comment (`report-seeds.ts:30-47`) says columns are "genuinely data-dependent, so it cannot be reproduced as a SQL `SELECT` column list (columns are static in SQL)". It is a **workaround for a SQL limitation**, and the silent-drop was an *accepted, documented* trade-off. Terminology alone does not fix it. **Deferred to its own slice — §7.** |
| "editing the seed reaches existing installs" | *Does the seed update or create?* | **Half true.** `SEED_QUERIES` managed-overwrites (`report-seeds.ts:1803-1810`); **`SEED_DESIGNS` (`:1811-1817`) and `SEED_REPORT_DEFS` (`:1819-1825`) are create-if-absent only.** Any fix that changes *columns* cannot reach an existing install. This is why §7 is deferred. |
| (draft's own §1) "the mapper must emit `580-1` / SNOMED `264868006`" | *Does CE need the mapper to change?* | **No.** CE holds the semantics (user decision, §1). The mapper keeps emitting raw DISA codes. **Slice C's mapper half is deleted.** |
| "`I` → 'Invalid' is our bug" (my hunch) | *Where does 'Invalid' come from?* | **My hunch was FALSE.** Known Tanzania COMMDICT typo at `CONTEXT=79` (should be "Intermediate"); `cdr-toolchain` already detects it (`apps/cli/src/audit/result-formats.ts:71-73`). `abnormal_flag='I'` is correct. Reports unaffected. **Not in scope.** |

**What survives from the disputed draft:** the code lookups (`580-1`, SNOMED `264868006`,
parasites = 0 of 647), the seed mechanics, the regression modes, and the out-of-scope list.

---

## 1. Decisions taken in brainstorm

| # | Question | Decision |
|---|---|---|
| D1 | Where does "NBG = no growth" knowledge live? | **CE holds it.** Ingest tools stay dumb; CE is the repository of record. |
| D2 | How is it expressed? | **CodeSystem property + intensional ValueSet** (not a ConceptMap). |
| D3 | Scope? | **Organism half only.** Antibiogram is its own slice (§7). |
| D4 | Unknown organism code? | **Fail-open + surface as unknown.** Never silently drop. |

**D4 rationale (load-bearing):** the bug that started this was a *silent* drop. Under-reporting AMR
is worse than over-reporting. Loud and slightly wrong beats quiet and wrong.

---

## 2. Verified facts to build on

Everything here was read at the cited line or observed live. **Unread items are marked SKETCH.**

**The projection is a pure, synchronous dispatch** — `relational/index.ts:22-36`:
```
case 'Organization':
case 'Location': return { table: 'facilities', row: projectFacility(r, prov) };
...
default: return null;     // <-- line 34: the ONLY reason terminology doesn't reach the warehouse
```
`tableForResourceType` (`:38-47`) is a **parallel switch that must be updated in lockstep.**

**`projectObservation` reads `coding[0]` only** (`relational/observation.ts`, read in full):
`observation_code = code.coding[0].code`, `coded_value = valueCodeableConcept.coding[0].code`.

**A ValueSet FHIR resource already carries its expansion** (observed live):
```json
"expansion": { "total": 3, "contains": [ {"code":"POS","system":"urn:openldr:cs:local","display":"Positive"} ] }
```
⇒ `projectValueSet` can stay **pure** — no async expansion needed inside the projection.

**Intensional filters work** — verified end to end:
- `filterConcepts` (`terminology/src/operations.ts:30-36`): **only `filters[0]`**, op must be `'='`/`'equals'`, else throws. Cap `limit: 10_000` (647 codes is fine).
- `applyConceptFilter` (`db/src/terminology-store.ts:85-92`): `where(sql\`properties->>${name}\`, '=', value)` — **the jsonb property filter is real.**
- `expandInner` (`db/src/value-set-expander.ts:76-79`): clauses across `include[]` **union**; sets *within* one clause **intersect** (`collectClause:71-74`).
⇒ `organism_type != 'none'` is expressible as **two `include` clauses** (`bacteria` ∪ `fungus`) despite the `'='`-only limit.

**The DISA vocabulary is already namespaced by the mapper** (observed live in `openldr_target`):

| `observation_system` | rows | meaning |
|---|---|---|
| `urn:openldr:default_org` | 14 | organisms (`ACIBA`, `NBG`, `CANAL`, `VIBCO`) |
| `urn:openldr:default_abx` | 62 | antibiotics (`AMIK`, `CIPRO`, `CEFTA` …) |
| `urn:openldr:default_result` | 45 | other coded results |
| `http://loinc.org` | 14 | the derived `-iso-` isolates |

CE registers **no CodeSystem** for any of them today — only UCUM (`terminology_systems`, observed live).

**Two Observations exist per isolate** (observed live) — `-obs-N` (raw DISA, code `ORGS`) and
`-iso-N` (derived, code `634-6` with `coding[1] = MICBC`). Both project to `lab_results`.
AMR filters `634-6`, so it reads the derived one.

**The 9 executable organism filters — counted myself, not recalled**
(`grep -n "observation_code = '634-6'" packages/reporting/src/seed/report-seeds.ts`):

| query | postgres | mssql | mysql |
|---|---|---|---|
| `q-amr-glass-ris` | **692** | **788** | **891** |
| `q-amr-first-isolate-summary` | **1002** | **1081** | **1175** |
| `q-amr-antibiogram` | **1299** | **1348** | **1404** |

10th hit at `:645` is a comment. `q-amr-resistance` and `q-amr-facility-summary` contain **no**
`634-6` — they are antibiotic-only and never filter on organism. **The plan gets 9, not 8, not 10.**

**`terminology_concepts` shape** (observed live): PK `(system, code)`; columns `system, code,
display, status, properties (jsonb)`.

**`value_sets` has NO runtime consumer.** Exhaustive `grep -rl` over `apps packages scripts`
(excl. node_modules, `*.test.ts`) → exactly 4 files: the migration, the migration registry,
`schema/internal.ts`, `terminology-admin-store.ts`. `$expand` reads the **projected FHIR resource**
(`terminology-store.ts:158-162`), never the table. **This slice is terminology's first consumer.**

---

## 3. Architecture

### 3.1 Describe the DISA organism dictionary as a CodeSystem in CE

Import Slice A's classifier output (647 TDS codes, golden-snapshot pinned) into
`terminology_concepts`:

```
system     = 'urn:openldr:default_org'
code       = 'ACIBA'
display    = 'Acinetobacter baumanii'
properties = { "organism_type": "bacteria" }        -- bacteria | fungus | none
```

This is CE learning what the site's codes mean, **once, as data**. It is an import, not a
hand-typed list — the classifier is the source, and its golden snapshot is the check.

> **SKETCH — verify before building:** the exact import path (a migration? a CLI command? a
> marketplace-style package?) and how the classifier's 647-row output crosses from `cdr-toolchain`
> into CE. I have **not** read the classifier's output format. `parasite` is measured at **0 of
> 647**, so only `bacteria`/`fungus`/`none` occur today — but do **not** hardcode that assumption;
> the harness must fail loudly if a 4th value appears.

### 3.2 Three ValueSets, authored not hardcoded

> **Amended while writing §3.4.** The brainstorm agreed **two**; implementing D4 (fail-open) proved
> a third is required. **Three is the number the plan must carry.** Provenance in §3.4.

**`urn:openldr:valueset:amr-organism-observation`** — extensional; which observations *are* organism
identifications:
```json
{ "include": [ { "system": "http://loinc.org",
                 "concept": [ {"code":"634-6"}, {"code":"580-1"} ] } ] }
```

**`urn:openldr:valueset:amr-pathogen`** — intensional; which coded values are pathogens:
```json
{ "include": [
  { "system": "urn:openldr:default_org", "filter": [{"property":"organism_type","op":"=","value":"bacteria"}] },
  { "system": "urn:openldr:default_org", "filter": [{"property":"organism_type","op":"=","value":"fungus"}] }
] }
```

**`urn:openldr:valueset:amr-non-pathogen`** — intensional; the **explicitly** classified negatives.
Required by D4 (fail-open): see §3.4 for why `amr-pathogen` alone cannot express it.
```json
{ "include": [
  { "system": "urn:openldr:default_org", "filter": [{"property":"organism_type","op":"=","value":"none"}] }
] }
```

**Why this kills the bug class:** it is a **positive definition**. `NBG` and all nine `"No …"` codes
fall out because they are `organism_type='none'` — *there is nothing to remember to exclude*. The
disputed draft's `<> '264868006'` required us to enumerate negatives correctly, and we had already
proven we cannot (the draft's own pattern caught 5 of 9).

⚠ `amr-pathogen` and `amr-non-pathogen` **partition** the classified codes. They are derived from
the same `organism_type` property, so they cannot drift *unless* a 4th value appears — which §3.1
requires the import harness to reject loudly.

### 3.3 New projection case: `ValueSet` → `terminology_codes`

Add to **both** switches in `relational/index.ts` (`projectResource:22-36` **and**
`tableForResourceType:38-47` — they must stay in lockstep), plus `ExternalSchema`
(`schema/external.ts:85-92`, currently 6 tables) and a new external migration.

`projectValueSet` is **pure**: reads `resource.expansion.contains[]` → one row per code.

```
terminology_codes(value_set_url, system, code, display, <provenance columns>)
```

⚠ **`provenance` is REQUIRED on `write()`** ([[ce-projection-drops-provenance]]) — carry it, or the
type checker will (correctly) reject this.

**Why a dimension table and not a column on `lab_results`:** baking `organism_type` onto fact rows
would make every terminology edit require a **reprojection** — and `reprojectAll` **has no
production callers**, so that repair path is unreachable ([[ce-projection-drops-provenance]]). As a
dimension table, a ValueSet edit propagates through the existing `change_log` → projection worker
like a lab result, and **no reprojection is ever needed.**

⚠ **One row per `(value_set_url, system, code)`** — a ValueSet delete must remove its rows. The
projection's upsert semantics for a *shrinking* expansion are a **SKETCH — verify**: if a code is
removed from a ValueSet, does the projection delete the stale row, or leave it? A stale row here
silently re-admits an excluded code. **This is the highest-risk unknown in the slice.**

### 3.4 The 9 SQL filters join instead of inlining

**Proven on live data this session** (throwaway `demo_terminology` table in the dev
`openldr_target`, left in place for inspection — drop with `drop table demo_terminology;`):

Before — `where o.observation_code = '634-6'`:
```
 ACIBA | Acinetobacter baumanii  | Cefotaxime 2 | Ciprofloxacin 2 | Gentamicin 2
 NBG   | No bacterial growth     |            0 |               0 |          0   <-- a negative, counted
```
After — joined to terminology, **zero clinical codes in the SQL**:
```
 ACIBA | Acinetobacter baumanii  | Amikacin=S, Cefotaxime=I, Ceftazidime=I, Ciprofloxacin=R, Gentamicin=R, Tobramycin=R
 VIBCO | Vibrio cholera 01 Ogawa | Ciprofloxacin=S
                                   (NBG gone)
```

**Shape** (per D4, fail-open):
```sql
from lab_results o
join terminology_codes vs_org
  on vs_org.value_set_url = 'urn:openldr:valueset:amr-organism-observation'
 and vs_org.code = o.observation_code
left join terminology_codes vs_path            -- LEFT: unknown codes are KEPT (D4)
  on vs_path.value_set_url = 'urn:openldr:valueset:amr-pathogen'
 and vs_path.code = o.coded_value
left join terminology_codes vs_neg             -- explicit non-pathogen classification
  on vs_neg.value_set_url = 'urn:openldr:valueset:amr-non-pathogen'
 and vs_neg.code = o.coded_value
where o.specimen_id is not null and o.specimen_id <> ''
  and vs_neg.code is null                      -- drop ONLY codes explicitly classified 'none'
```

⚠ **D4 needs a THIRD value set.** Fail-open cannot be expressed with `amr-pathogen` alone: a plain
`left join` to it keeps unknowns *and* keeps `NBG`. To drop only the **explicitly** classified
negatives while keeping the **unclassified**, we need
`urn:openldr:valueset:amr-non-pathogen` = `filter organism_type='none'`, and exclude on *that*.
**This is a design consequence discovered while writing the spec — it was not in the brainstorm.**
The value-set count is therefore **3, not 2**, and §3.2 above is amended accordingly.

⚠ **The value_set_url literals are still strings in SQL.** This is deliberate and is **not**
the hardcoding we are removing: a URL is a *stable identifier for a policy*, not a clinical
vocabulary. The codes behind it are data. (Compare: `'634-6'` names a concept; `amr-pathogen` names
a decision.) If this distinction is rejected, the URLs must become report params — but
`substituteParams` (`dashboards/src/custom-query-run.ts:21-42`) **cannot expand a list into
`in (...)`** (`sqlString(String(v))` at `:34` turns `['A','B']` into the literal `'A,B'`), so the
join-based design is what makes the list problem go away.

⚠ Write **each dialect's string explicitly** — the three variants are hand-written and structurally
divergent (`distinct on` vs `row_number()`; `||` vs `+` vs `concat`). Do **not** assume the
surrounding SQL is identical.

### 3.5 Surface the unknowns (D4)

Fail-open is only honest if unknowns are **visible**. The slice must add an unclassified-organism
count so a new site's codes announce themselves instead of quietly inflating pathogen counts.

> **SKETCH — decide during planning:** where this surfaces. Candidates: an extra column on
> `q-amr-first-isolate-summary`; a new seeded query; the existing Activity/data-quality surface.
> ⚠ **Constraint:** a *new column* on an existing report needs a **design** change, and
> `SEED_DESIGNS` is **create-only** (`report-seeds.ts:1811-1817`) — it will **not** reach existing
> installs. A **new query** (`SEED_QUERIES` managed-overwrites, `:1803-1810`) will. Prefer a new
> query.

---

## 4. What this does NOT touch

- **`cdr-toolchain`** — no change. The mapper keeps emitting raw DISA codes. (The disputed draft's
  §1 is deleted.)
- **`fhir_resources` / the change_log** — a ValueSet is already a resource there.
- **Existing `lab_results` rows** — no reprojection.

---

## 5. Testing

**⚠ There is no existing safety net.** All 5 `amr-*-parity.test.ts` are `it.skip` +
`expect(true).toBe(true)`. Do not "update" them; they assert nothing. Treat AMR SQL as **untested**.

**Rule 7 — every assertion must be able to FAIL.** For each test below, name the mutation that
turns it red.

| Test | Must fail when |
|---|---|
| `projectValueSet` emits one row per `expansion.contains[]` entry | a code is dropped/duplicated |
| `projectResource` routes `ValueSet` → `terminology_codes` | the `default: return null` regresses |
| `tableForResourceType('ValueSet')` === `'terminology_codes'` | the **parallel switch** is missed (this is the lockstep bug) |
| ValueSet **shrink** removes the stale warehouse row | §3.3's highest-risk unknown regresses |
| `amr-pathogen` expansion **excludes** `NBG` and **includes** `ACIBA`+`CANAL` | the intensional filter or the `properties` import breaks |
| `amr-non-pathogen` expansion **includes** `NBG` | the third ValueSet (§3.2) is missed — without it D4's SQL drops nothing |
| the two sets **partition**: `pathogen ∩ non-pathogen = ∅` and `∪` = all classified codes | a 4th `organism_type` appears, or a code is classified twice |
| expansion is **non-empty** | ⚠ a vacuous pass: an empty expansion would make every "excludes NBG" assertion pass. **Assert the count.** |
| AMR SQL keeps an **unclassified** code (D4 fail-open) | someone "tidies" the LEFT JOIN to an INNER JOIN |

**Live verification is the only proof that matters** — 6 real labs are ingested:
```sql
select o.coded_value, o.text_value, count(*)
from lab_results o
join terminology_codes v on v.value_set_url='urn:openldr:valueset:amr-organism-observation'
 and v.code=o.observation_code
group by 1,2;
```
Expect `ACIBA`, `VIBCO`, `CANAL`. Expect **no** `NBG`.

**Gate:** `pnpm turbo run typecheck test --force`. **Rule 8** — this slice widens `ExternalSchema`,
a shared type: typecheck **every** consuming package, not just `@openldr/db`. vitest strips types
and will stay green over a type error.

---

## 6. Regression modes

- Projection case added but **`tableForResourceType` not updated** ⇒ lockstep break. Most likely bug.
- ValueSet edited but expansion **not refreshed** ⇒ warehouse projects a stale expansion. (`expanded_at`
  exists; **SKETCH — verify** what refreshes it. The agent found writers in migration 014 and the
  admin store but **traced no background re-expansion job**.)
- SQL joins terminology but the **ValueSet never projects** ⇒ every organism disappears (inner join
  on `vs_org`). **Fails loudly — acceptable.**
- `terminology_codes` row **not deleted** on ValueSet shrink ⇒ silently re-admits an excluded code.
  **Fails silently — the dangerous one.** See §3.3.

---

## 7. Explicitly out of scope

- **The antibiogram / `ANTIBIOGRAM_PANEL`** (D3). Not a vocabulary problem — a static-SQL-columns
  problem (`report-seeds.ts:30-47`), compounded by `SEED_DESIGNS` being create-only (`:1811-1817`)
  and the design's columns being built from the panel (`:1586`). Needs a dynamic-column mechanism
  (long-format + pivot at render is the candidate) **and** a migration path for create-only designs.
  **Its own slice.** Until then MDR *Acinetobacter* still renders 3 of its 6 antibiotics.
- **`wasm/hl7v2/src/mapping.rs:7`** — `const ORGANISM_CODES: [&str; 2] = ["634-6", "88040-1"]`. A
  **second, independent** hardcoded organism vocabulary, in Rust, that the TS AMR SQL never matches
  (`88040-1` appears nowhere in the TS path). Same anti-pattern, different pipeline. **Named here so
  it is not forgotten.**
- **`634-6` → `6463-4`.** `634-6` means "by **Aerobe** culture" and over-asserts. Its own decision.
- **Duplicate isolates.** Faithful to v1 (2 `ORGS` rows, one per `OBRSetID`). AMR *aggregation*
  should dedupe; the mapping is correct.
- **AST fan-out.** `buildIsolates` (`amr/isolates.ts:29-63`) attributes **every** AST on a specimen
  to **every** organism on it — and the SQL deliberately mirrors it (`report-seeds.ts:646-649`,
  join on `specimen_id` alone). A polymicrobial specimen gets wrong antibiograms. `ast` is also
  **never window-filtered**. **Real bug, deliberate, bigger than this slice.**
- **Growth quantifiers** (`GR0`-`GR3`, `PURE`), `BL-`, `PUF` — not organisms, still in the
  pathogen-id dictionary. Would need a 4th `organism_type`. Its own decision.
- **`I` → "Invalid"** — upstream COMMDICT typo, already detected in `cdr-toolchain`. Not ours.
- **`glass.ts` vocabularies** — `PathogenCode`/`AntibioticCode`/`Specimen` are **unmapped
  pass-throughs** and `AntibioticCode` ships a *description string*, not a code. `GLASS_BANDS`,
  gender and origin are hardcoded and **duplicated** as a SQL `case` (`report-seeds.ts:725-736`).
  The same anti-pattern, one layer up. Its own slice.

---

## 8. Known caveats

- **1 site of 22.** Everything measured is TDS; v1 mirrors ~1.8M requests across 22 sites. `GN`
  "Gram Negative" (113 uses in v1) is **not** in TDS's 647-code dictionary — **this is the live
  proof that D4 (fail-open) is not hypothetical.**
- **`value_sets` lacks `managed_origin`** (`schema/internal.ts:266-283`), unlike `coding_systems`
  and `term_mappings` — so ValueSets may **not** participate in distributed sync. **SKETCH —
  verify.** If a lab must report on terminology authored centrally, this matters and is unbuilt.
- **`014_value_sets.ts:66`** dedups concepts on **`code` alone, not `(system, code)`**. Harmless for
  the 6 seeds; a real hazard once a second system is registered — which **this slice does**.
  **Check before importing 647 codes.**
- The ValueSet expander caps at `limit: 10_000` (`operations.ts:33`) — an undisclosed truncation
  ceiling. 647 is fine; a full LOINC-scale system is not.
