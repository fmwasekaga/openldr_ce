# AMR organism semantics (Slice C) — Design

**Date:** 2026-07-16
**Status:** design approved, researched to falsification, NOT implemented
**Repos:** `cdr-toolchain` (mapper) + `openldr_ce` (AMR queries) — **both halves must land together**
**Depends on:** Slice A (organism classifier) — DONE, `3c3f120`

## ⚠ This spec REPLACES an earlier, wrong one

An earlier draft of Slice C (inside `2026-07-16-cdr-fhir-ingest-to-ce-design.md`) proposed making
`packages/reporting/src/amr/query.ts` ValueSet-driven, with two seeded ValueSets. **Every load-bearing
claim in it was false.** Corrected by applying [[plans-cite-or-flag]]'s Rule 0 — *name what would make
this false, then check that*:

| I asserted | Falsifier | Reality |
|---|---|---|
| `amr/query.ts` is the AMR query | who calls it? | **No callers.** It is a parity reference. The real AMR is SQL in `report-seeds.ts`. |
| "the fix is 2 SQL strings" | grep every `634-6` | **9** — 3 queries × 3 dialects |
| ValueSets give deployment-extensibility | is there an existing config surface? | Seeded **queries** are managed-overwrite and editable via `/api/report-defs`. ValueSets are unnecessary. |
| ValueSets can be joined in the AMR SQL | which DB is each in? | Reports run against the **external** warehouse; `value_sets` is **internal**. They cannot join. |
| editing the seed fixes existing installs | does the seed update or create? | **Both**: `SEED_QUERIES` updates (`report-seeds.ts:1803`), `SEED_REPORT_DEFS`/`SEED_DESIGNS` are create-only (`:1822`, `:1765`). |
| (never asked) | what happens to an antibiotic not in the panel? | **`ANTIBIOGRAM_PANEL` silently drops it** — 6 of our 10 real antibiotics. |

## The two defects, on real data

Live-verified 2026-07-16 with 6 real DISA labs ingested into CE:

```
TZDISATDS0123369 | ACIBA | Acinetobacter baumanii   ← appears TWICE
TZDISATDS0050309 | NBG   | No bacterial growth      ← a negative reported as an organism
```

1. **Negatives are organisms.** The classifier now types `NBG` as `organism_type: 'none'`
   (Slice A), but the mapper still emits it as a `634-6` "Bacteria identified" isolate, so CE's
   AMR counts it as a pathogen and `glass.ts` would ship it to WHO GLASS.
2. **Fungi are labelled bacteria.** `isolateResource` codes everything `634-6`. `Candida albicans`
   is recorded as a bacterium — because `634-6` is the only code CE's AMR looks for.

**Not a defect:** duplicate isolates are **faithful to v1** — v1 has 2 `ORGS` rows for
`TZDISATDS0123369`, one per `OBRSetID` (the organism is reported under both the culture and the
sensitivity panel). Our mapper emits 2 because v1 has 2. AMR *aggregation* should dedupe; the
mapping is correct. **Out of scope** — see Known gaps.

## Verified facts to build on

**Codes** (looked up, not recalled):
- `634-6` = LOINC "Bacteria identified in Specimen by **Aerobe culture**" — CE's existing code
- `580-1` = LOINC "Fungus identified in Specimen by Culture" — https://loinc.org/580-1
- `6463-4` = LOINC "Bacteria identified in Specimen by Culture" (the generic) — **not adopted**, see Out of scope
- `264868006` = SNOMED CT "No growth" — https://bioportal.bioontology.org/ontologies/SNOMEDCT?p=classes&conceptid=264868006

**Parasites: do not build.** 0 of 647 `COMMDICT CONTEXT=50` codes classify as `parasite`
(measured). `PARASITE_RE` is inert on this dictionary. The harness already fails loudly if a future
dictionary adds one.

**CE's AMR convention** (`packages/reporting/src/seed/report-seeds.ts`):
- organism = a `lab_results` row with `observation_code = '634-6'`
- AST = `abnormal_flag in ('S','I','R')`
- The 9 organism filters are **byte-identical**:
  ```sql
  from lab_results o
  where o.observation_code = '634-6'
    and o.specimen_id is not null and o.specimen_id <> ''
  ```

**CE's projection reads `coding[0]` only** (`relational/observation.ts` via `codeable()`), so
`observation_code = code.coding[0].code` and `coded_value = valueCodeableConcept.coding[0].code`.
**Anything CE must filter on has to be in `coding[0]`.**

## Design

### 1. cdr-toolchain — `fhir-transform.ts`, `isolateResource`

Code the isolate by `organism_type` (`V2Isolate.organism_type`, now trustworthy after Slice A):

| organism_type | `Observation.code.coding[0]` | `valueCodeableConcept.coding[0]` |
|---|---|---|
| `bacteria` | LOINC `634-6` | the DISA organism code (unchanged) |
| `fungus` | LOINC `580-1` "Fungus identified in Specimen by Culture" | the DISA organism code (unchanged) |
| `parasite` | LOINC `634-6` + a comment saying why (0 codes exist) | the DISA organism code |
| `none` | LOINC `634-6` — a negative culture **is** a bacteria-identification observation | **SNOMED `264868006` "No growth"**, with the DISA code as `coding[1]` |

`source_test_code` stays as a second `code.coding[]` entry, as today.

**Why SNOMED goes first for negatives:** CE filters on `coded_value`, which is `coding[0].code`. The
DISA code (`NBG`, `NG48`, `BC1`, …) is **site-specific**; SNOMED is not. Putting the standard
concept first is what makes CE's filter deployment-agnostic — the whole reason we don't hardcode
`NBG` in CE. The DISA code is preserved at `coding[1]` and in `raw_result`; `text_value` keeps the
original description.

### 2. openldr_ce — the 9 AMR SQL filters

For each of the **3 queries × 3 dialects**, replace:

```sql
where o.observation_code = '634-6'
```
with:
```sql
where o.observation_code in ('634-6', '580-1')   -- bacteria + fungi; see Slice C spec
  and coalesce(o.coded_value, '') <> '264868006' -- SNOMED "No growth" — a negative culture is not a pathogen
```

⚠ **`in (...)` and `<>` are portable across all three dialects** — but write each dialect's string
explicitly; do NOT assume the surrounding SQL is identical.

⚠ **The `coalesce` matters**: `coded_value` is nullable, and `NULL <> '264868006'` is `NULL`, not
`true` — a bare `<>` would silently drop every organism with a null coded_value.

### 3. openldr_ce — `ANTIBIOGRAM_PANEL`

Add the 6 antibiotics real data has and the panel lacks: **Amikacin, Ceftazidime, Tobramycin,
Chloramphenicol, Tetracycline**, and **Cotrimoxazole** (DISA's name for the drug the panel calls
`Trimethoprim/Sulfamethoxazole` — add it as its own entry; the match is on `observation_desc`, so
the DISA spelling is what arrives).

Without this the MDR *Acinetobacter* antibiogram renders as Cefotaxime/Ciprofloxacin/Gentamicin and
**silently drops Amikacin (S), Ceftazidime (I), Tobramycin (R)** — half its resistance profile.

## Regression modes — the reason both halves ship together

- Mapper emits `580-1` but CE still filters `= '634-6'` ⇒ **every fungus disappears from AMR.**
- CE accepts `580-1` but the mapper never emits it ⇒ no effect (safe, but pointless).
- Negatives get SNOMED `coding[0]` but CE doesn't filter it ⇒ negatives still counted, and
  `coded_value` now reads `264868006` instead of `NBG` — **worse than today**.

⇒ **Land the mapper change and the SQL change in the same sitting, and verify on live data before
merging either.**

## Testing

**cdr-toolchain** (`node:test`, NOT vitest):
- `isolateResource` emits `580-1` for `organism_type: 'fungus'`, `634-6` for `bacteria`.
- `organism_type: 'none'` ⇒ `valueCodeableConcept.coding[0]` is SNOMED `264868006`, `coding[1]` is
  the DISA code, `text` keeps the description.
- The R4 conformance gate still passes: `FHIR_CONFORMANCE=1 node --import tsx --test src/export/fhir-conformance.test.ts`

**openldr_ce** (**vitest**): the AMR parity tests (`amr-antibiogram-parity.test.ts`,
`amr-glass-ris-parity.test.ts`, `amr-resistance-parity.test.ts`) pin the SQL against the TS
reference pipeline. **They will need updating** — and note their headers say the dev DB shipped
**zero** `634-6` rows, so they build their own fixtures. Read them before editing the SQL.

**Live** (the only proof that matters — 6 real labs are already ingested):
```sql
-- must return the organisms and NOT "No bacterial growth"
select request_id, observation_code, coded_value, text_value
from public.lab_results where observation_code in ('634-6','580-1');
```
Expect: `ACIBA` Acinetobacter baumanii, `VIBCO` Vibrio cholera 01 Ogawa, `CANAL` Candida albicans
(now `580-1`). Expect **no** `NBG`/`NG48` rows.

## Explicitly out of scope

- **`634-6` → `6463-4`.** `634-6` means "by **Aerobe** culture" and we don't know the culture was
  aerobic, so it over-asserts. Correcting it churns CE's convention and needs a data migration for
  already-projected rows. Its own decision.
- **Duplicate isolates.** Faithful to v1 (2 `ORGS` rows, one per `OBRSetID`). AMR aggregation should
  dedupe one isolate per (organism, specimen); the mapper is correct. Bigger than this slice.
- **AST fan-out.** `buildIsolates` (`amr/isolates.ts:29-63`) attributes **every** AST on a specimen to
  **every** organism on it, so a polymicrobial specimen gets wrong antibiograms. Our `hasMember` tree
  carries the true linkage and CE ignores it. **Real bug, bigger than this slice.**
- **Growth quantifiers** (`GR0`-`GR3`, `PURE`), `BL-`, `PUF` — not organisms, still in the
  pathogen-id dictionary. Needs a new `organism_type` value ⇒ changes `V2Payload`. Its own decision.
- ValueSets. Unnecessary — the seeded queries are the config surface.

## Known caveats

- Everything measured is **TDS — 1 site of 22** on this laptop; v1 mirrors ~1.8M requests across 22
  sites. Other sites' dictionaries are unseen (`GN` "Gram Negative", 113 uses in v1, is **not** in
  TDS's 647-code dictionary).
- `SEED_REPORT_DEFS`/`SEED_DESIGNS` are **create-only**; only `SEED_QUERIES` refreshes. If this slice
  ever needs a *def* change, it will not reach existing installs.
