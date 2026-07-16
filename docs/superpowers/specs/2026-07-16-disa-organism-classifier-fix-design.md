# DISA organism classifier fix — Design

**Date:** 2026-07-16
**Status:** design approved, not implemented
**Repo:** `cdr-toolchain` (**not** openldr_ce — this spec lives here because the workstream's docs do)
**Slice:** A of 3. Prerequisite for the CE read-model slice; ships value alone.

## Why this exists

`apps/cli/src/export/codebook.ts:37-39` buckets each DISA organism code into
`V2Isolate.organism_type` (`bacteria | fungus | parasite | none`) using description heuristics:

```ts
// codebook.ts:37-39 (VERBATIM, read at those lines)
const NO_GROWTH_RE = /\b(no\s*(growth|bacterial|pathogen|organism)|normal\s*flora|sterile|negative)\b/i;
const FUNGUS_RE = /\b(candida|cryptoc|aspergillus|fusarium|trichoph|microsporum|histoplasm|mucor|yeast|fungi|mould|mold)\b/i;
const PARASITE_RE = /\b(plasmodi|trypanos|leishman|schistos|filari|giardia|entamoeba|cryptosporid|toxoplasm|trichomon|ascaris|strongyl|hookworm|hymenolep|taenia|necator|enterobi)\b/i;
```

**`NO_GROWTH_RE`'s bare `negative` alternative matches "Gram negative bacilli".** So Gram-negative
bacteria — among the most important AMR pathogens there are — are classified as *no growth*.

This is **live today on the production v2 path**, independent of any CE work:
`v2-transform.ts:394-396` (`nearestGrowthPositiveIsolate`) filters `organism_type !== "none"` to
choose which isolate an AST belongs to. Gram-negative isolates are therefore already being skipped
as AST hosts in the Mozambique/Zambia migration.

## Evidence — measured against the live DISA dictionary

All 647 `COMMDICT` rows with `CONTEXT=50` (pathogen-id) were re-classified with the current
regexes. Findings:

**Currently `none` (12) — 5 of them wrong:**

| code | description | current | correct |
|---|---|---|---|
| `ANGNC` | Anaerobic gram negative coccus | none | **bacteria** |
| `GNB` | Gram negative bacilli | none | **bacteria** |
| `GNC` | Gram negative cocci | none | **bacteria** |
| `GNDC` | Gram negative diplococci | none | **bacteria** |
| `BL-` | á-Lactamase Negative | none | **not an organism** (resistance marker) |
| `BC1` | Aerobic culture - Negative | none | none ✓ |
| `BC3` | Anaerobic cult - negative | none | none ✓ |
| `GRW7` | Nogrowth after 7days Icubation | none | none ✓ |
| `NBG` | No bacterial growth | none | none ✓ |
| `NF` | Normal flora isolated | none | none ✓ |
| `NG` | No growth | none | none ✓ |
| `NG48` | No growth after 48 hours | none | none ✓ |

**Missed no-growths — currently `bacteria`:**

| code | description | why missed |
|---|---|---|
| `NFG` | No fungal growth | `no\s*growth` cannot match across the intervening "fungal"; `FUNGUS_RE`'s `\bfungi\b` does not match "fungal" |
| `NSB` | No Signf. bact. growth Repeat | same — words intervene; "bact." is not "bacterial" |

**Not organisms at all, currently `bacteria`** — these would be reported to WHO GLASS as pathogens:

| code | description | what it is |
|---|---|---|
| `GR0` | (very scanty growth) | growth quantifier |
| `GR1` | (Light growth) | growth quantifier |
| `GR2` | (moderate growth) | growth quantifier |
| `GR3` | (abundant growth) | growth quantifier |
| `PURE` | (pure growth) | growth quantifier |
| `PUF` | Peri-urethral flora | commensal flora |

**Fungi missed:** `ABSID = Absidia species` is a mould classified as `bacteria` — `FUNGUS_RE` has no
`absidia`, `rhizopus`, or `mucorales` (it has `mucor`, which does not match "Absidia").

**Parasites: 0.** No `CONTEXT=50` code in this dictionary classifies as a parasite. Nothing to
build; `PARASITE_RE` is inert here (it may not be in other deployments — leave it).

## Scope

Fix the classifier so `organism_type` can be trusted. Three changes plus a verification harness.

### 1. `negative` must mean "the culture was negative", not "gram negative"

Every real use in this dictionary is culture-result phrasing (`BC1` "Aerobic culture - Negative",
`BC3` "Anaerobic cult - negative"), and every false positive is gram-stain morphology
(`gram negative <something>`). Anchor accordingly rather than deleting the alternative — deleting it
would misclassify `BC1`/`BC3` as bacteria.

The rule: `negative` counts only when **not preceded by "gram"**.

### 2. Catch the missed no-growths

`NFG` ("No fungal growth") and `NSB` ("No Signf. bact. growth Repeat") must be `none`. The current
pattern requires `no` adjacent to the noun; real descriptions put words between. Allow a bounded gap
between `no` and `growth` rather than requiring adjacency — bounded, so it cannot match "no" and a
"growth" many words away in an unrelated phrase.

### 3. Add the missing moulds

Add `absidia` and `rhizopus` to `FUNGUS_RE`. Do **not** attempt a comprehensive mycology list — add
what the real dictionary contains, verified by the harness below.

### Verification harness (the point of the slice)

A test that re-classifies a **snapshot of the real 647 COMMDICT codes** (committed as a fixture, no
DB required at test time) and asserts:

- `GNB`, `GNC`, `GNDC`, `ANGNC` → `bacteria`
- `BC1`, `BC3`, `NBG`, `NG`, `NG48`, `GRW7`, `NF`, `NFG`, `NSB` → `none`
- `ABSID`, `ASPFU`, `CANAL` → `fungus`
- No code classifies `parasite` (documents the 0 finding; fails loudly if a future dictionary adds one)

The fixture is the deliverable as much as the regex: it makes the next change to these heuristics
measurable instead of speculative.

## Explicitly NOT in scope

- **Growth quantifiers and resistance markers** (`GR0`-`GR3`, `PURE`, `BL-`, `PUF`) are in the
  pathogen-id dictionary but are not organisms. Correctly excluding them needs a **new category** —
  `organism_type` has no value meaning "not an organism", and adding one changes `V2Payload`, which
  the live v2 path consumes. Classifying them `none` would coincidentally exclude them from AMR, but
  `none` means "no growth" and that would be a lie of a different shape. **Its own decision.**
  Recorded here because they will otherwise reach GLASS as pathogens.
- Any CE change. Slices B (provenance) and C (organism semantics) are separate.
- `634-6` → `6463-4`.

## Risk

`v2-transform.ts:394-396` consumes `organism_type` on the **live v2 migration path**. This change
alters which isolates count as growth-positive — deliberately, since that is the bug — so ASTs will
attribute differently after it lands. That is a **behaviour change on a running migration**, and it
is a correction, not a regression: Gram-negative isolates currently receive no ASTs at all.

The compare gate cannot catch a regression here — `organism_type` is not among its 13 compared
fields, like `result_status`/`analysis_at`/`authorised_at` before it.

## Testing

- Unit: the 647-code fixture harness above.
- Regression: full `pnpm test` in `apps/cli` (currently 117 tests, 116 pass, 1 skipped).
- Live sanity: re-run `export-batch --dry-run --emit-payloads` over the 21 known culture labs
  (`LabNo IN (...)`, see `disa-result-status-signal` method) and confirm `organism_type` on each
  isolate matches the table above — in particular that no isolate in the real data flips to `none`
  that should not.

## Follow-on

Once `organism_type` is trustworthy, Slice C (organism semantics) can use it: the mapper emits
`580-1` for fungus and a standard no-growth coding for `none`, and CE's AMR query selects on
ValueSets rather than a hardcoded `634-6`.
