# DISA Organism Classifier Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `V2Isolate.organism_type` trustworthy — stop classifying Gram-negative bacteria as "no growth", catch the missed no-growths, and recognise the 16 fungal genera currently reported as bacteria.

**Architecture:** Three regex corrections in one file (`apps/cli/src/export/codebook.ts`), plus a fixture harness that re-classifies a committed snapshot of all 647 real DISA dictionary codes offline. `classify` is currently a closure inside `loadCodebook` and must be hoisted and exported so it can be tested without a database.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), `node:test` + `node:assert/strict` (**not vitest**), `mssql` (fixture generation only).

**Spec:** `docs/superpowers/specs/2026-07-16-disa-organism-classifier-fix-design.md` (openldr_ce, `c7650876` + amendment `750a94e0`)

---

## Repo

**ALL work is in `D:\Projects\Repositories\cdr-toolchain`.** The spec/plan live in `openldr_ce`
only because the workstream's docs do. Do not modify `openldr_ce`.

Branch from `main` (currently `ee971b5`, clean).

## Why this matters (read before touching the regexes)

`apps/cli/src/export/codebook.ts:37` — the bare `negative` alternative matches **"Gram negative
bacilli"**, so Gram-negative bacteria classify as `none` (no growth). This is **live on the
production v2 migration**: `apps/cli/src/export/v2-transform.ts:394-396`
(`nearestGrowthPositiveIsolate`) filters `organism_type !== "none"` to choose an AST's host isolate,
so Gram-negative isolates already receive no ASTs in Mozambique/Zambia.

**This change alters live v2 behaviour deliberately.** It is a correction, not a regression. The
compare gate cannot catch a mistake here — `organism_type` is not among its 13 compared fields.

## Conventions

- ESM: relative imports **must** carry `.js` (`./codebook.js`), even from `.ts`.
- Tests are `src/**/*.test.ts`, run by `node --import tsx --test` (`apps/cli/package.json`).
  Style verified at `apps/cli/src/audit/detector-non-test.test.ts:1-2`:
  ```ts
  import { test } from "node:test";
  import assert from "node:assert/strict";
  ```
- Run one file: `cd apps/cli && node --import tsx --test src/export/codebook-classify.test.ts`
- Full suite: `cd apps/cli && pnpm test` — currently **117 tests, 116 pass, 1 skipped**. Must stay green.
- Typecheck: `cd apps/cli && pnpm typecheck`
- **NEVER add a `Co-Authored-By` trailer.**
- **`pnpm dev -- <cmd>` is broken** — it passes a literal `--` that breaks commander's option
  parsing, silently ignoring flags. Use `node --import tsx src/index.ts <cmd>`.

## File Structure

| File | Responsibility |
|---|---|
| `apps/cli/src/export/codebook.ts` (modify) | The three regexes + `classify`, hoisted to module scope and exported. |
| `apps/cli/src/export/__fixtures__/commdict-context50.json` (create) | Snapshot of all 647 real `COMMDICT` `CONTEXT=50` codes. Generated once from the live DB; used offline forever after. |
| `apps/cli/src/export/codebook-classify.test.ts` (create) | The harness: re-classifies every fixture row and pins the known-correct buckets. |
| `apps/cli/scripts/dump-commdict-fixture.ts` (create) | One-shot generator for the fixture. Documented and re-runnable; not part of the test path. |

Keeping the harness in its own test file (rather than appending to an existing one) matches the
repo's one-concern-per-test-file pattern and keeps the 647-row fixture's consumer obvious.

---

## Task 1: Branch and confirm a green baseline

**Files:** none (git only)

- [ ] **Step 1: Branch**

```bash
cd /d/Projects/Repositories/cdr-toolchain
git checkout main && git pull --ff-only 2>/dev/null; git checkout -b fix/organism-classifier
git status --short   # expect: clean
```

- [ ] **Step 2: Confirm the baseline is green BEFORE changing anything**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli && pnpm test 2>&1 | grep -E "ℹ (tests|pass|fail|skipped)"
```

Expected: `tests 117`, `pass 116`, `fail 0`, `skipped 1`. If it is already red, **STOP and report** — do not build on a red baseline.

---

## Task 2: Generate the COMMDICT fixture

**Files:**
- Create: `apps/cli/scripts/dump-commdict-fixture.ts`
- Create: `apps/cli/src/export/__fixtures__/commdict-context50.json`

This is the only task that needs the database. Everything after it runs offline.

**Context:** `CONTEXT=50` is the pathogen-id context (`apps/cli/src/export/codebook.ts:10-16`). The
dictionaries live in the **`DisaGlobal`** database (not `DisalabData`) — verified 2026-07-16.
`COMMDICT` columns: `DATESTAMP, CONTEXT, CODE, DESCRIPTION, ACTIVE, COMMDICT_STATUS`.

- [ ] **Step 1: Write the generator** — SKETCH (new code)

Create `apps/cli/scripts/dump-commdict-fixture.ts`:

```ts
// One-shot generator for the organism-classifier fixture. Run manually against a
// live DISA when the dictionary changes; the test path never touches a database.
//
//   cd apps/cli && node --import tsx scripts/dump-commdict-fixture.ts
//
// CONTEXT=50 is DISA's pathogen-id context (codebook.ts:10-16). The dictionaries
// live in DisaGlobal, NOT DisalabData.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import mssql from "mssql";
import { loadConfig } from "../src/config.js";

const cfg = loadConfig({}, undefined) as unknown as { connectionString: string };
if (!cfg.connectionString) throw new Error("DISA_CONNECTION_STRING not configured");

const pool = await new mssql.ConnectionPool(cfg.connectionString).connect();
const r = await pool.request().query(`
  SELECT LTRIM(RTRIM(CODE)) AS code, LTRIM(RTRIM(DESCRIPTION)) AS description
  FROM [DisaGlobal].[dbo].[COMMDICT] WHERE CONTEXT = 50 ORDER BY CODE`);
await pool.close();

const rows = (r.recordset as { code: string; description: string }[]).map((x) => ({
  code: String(x.code ?? ""),
  description: String(x.description ?? ""),
}));

const out = resolve(import.meta.dirname, "../src/export/__fixtures__/commdict-context50.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
console.log(`wrote ${rows.length} rows -> ${out}`);
process.exit(0);
```

- [ ] **Step 2: Run it**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node --import tsx scripts/dump-commdict-fixture.ts
```

Expected: `wrote 647 rows -> …/commdict-context50.json`

**If the count is not 647, STOP and report it** — the spec's measurements assume that dictionary. A different count means the source changed and every expectation below needs re-verifying.

- [ ] **Step 3: Sanity-check the fixture contains the codes the harness pins**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node -e "const f=require('./src/export/__fixtures__/commdict-context50.json');const w=['GNB','GNC','GNDC','ANGNC','BC1','BC3','NBG','NG','NG48','GRW7','NF','NFG','NSB','ABSID','TORGL','SPOSC','CANAL','ASPFU'];const m=new Map(f.map(r=>[r.code,r.description]));for(const c of w)console.log(c.padEnd(7), m.has(c)?m.get(c):'*** MISSING ***');"
```

Expected: every code present, e.g. `GNB → Gram negative bacilli`, `TORGL → Torulopsis glabrata`. **Any `*** MISSING ***` means STOP and report.**

- [ ] **Step 4: Commit**

```bash
cd /d/Projects/Repositories/cdr-toolchain
git add apps/cli/scripts/dump-commdict-fixture.ts apps/cli/src/export/__fixtures__/commdict-context50.json
git commit -m "test(export): snapshot the 647 real COMMDICT pathogen-id codes

The classifier's heuristics have never been measured against the dictionary
they classify. This fixture makes the next change to them testable offline
instead of speculative. Regenerate with scripts/dump-commdict-fixture.ts."
```

---

## Task 3: Hoist and export `classify` (pure refactor, no behaviour change)

**Files:**
- Modify: `apps/cli/src/export/codebook.ts:182-188`

`classify` is currently a closure inside `loadCodebook` (`codebook.ts:182`), so it cannot be tested
without a live database. It uses **no** closure state — only the module-level regexes — so hoisting
is inert.

- [ ] **Step 1: Read the current function**

```bash
cd /d/Projects/Repositories/cdr-toolchain && sed -n '180,190p' apps/cli/src/export/codebook.ts
```

Verbatim, read at `codebook.ts:182-188`:

```ts
  function classify(desc: string): OrganismCategory {
    if (desc.length === 0) return "bacteria";
    if (NO_GROWTH_RE.test(desc)) return "none";
    if (FUNGUS_RE.test(desc)) return "fungus";
    if (PARASITE_RE.test(desc)) return "parasite";
    return "bacteria";
  }
```

- [ ] **Step 2: Move it to module scope and export it**

Delete those lines from inside `loadCodebook`, and add at module scope — directly beneath the
`OrganismCategory` type (near `codebook.ts:41`) so the regexes, the type and the function that uses
them stay together:

```ts
/** Bucket a COMMDICT[CONTEXT=50] organism description into v2's organism_type.
 *  Exported so the classifier can be tested against a fixture of the real
 *  dictionary without a database — see codebook-classify.test.ts. */
export function classify(desc: string): OrganismCategory {
  if (desc.length === 0) return "bacteria";
  if (NO_GROWTH_RE.test(desc)) return "none";
  if (FUNGUS_RE.test(desc)) return "fungus";
  if (PARASITE_RE.test(desc)) return "parasite";
  return "bacteria";
}
```

The call site inside `loadCodebook` (`organismCategory(codedValue)`) needs no change — it resolves
to the module-scope function by name.

- [ ] **Step 3: Prove the refactor is inert**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli && pnpm typecheck && pnpm test 2>&1 | grep -E "ℹ (tests|pass|fail|skipped)"
```

Expected: typecheck clean; **117 / 116 pass / 1 skipped** — identical to Task 1's baseline. A changed count means something else moved; **STOP and report**.

- [ ] **Step 4: Commit**

```bash
cd /d/Projects/Repositories/cdr-toolchain
git add apps/cli/src/export/codebook.ts
git commit -m "refactor(export): hoist and export classify() so it can be tested

Pure move — no behaviour change. It was a closure inside loadCodebook, so
testing the organism heuristics required a live database."
```

---

## Task 4: The harness — write the failing test

**Files:**
- Create: `apps/cli/src/export/codebook-classify.test.ts`

Every expectation below was **measured against the live dictionary on 2026-07-16**, not assumed.

- [ ] **Step 1: Write the test**

Create `apps/cli/src/export/codebook-classify.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classify, type OrganismCategory } from "./codebook.js";

interface Row { code: string; description: string }

const rows: Row[] = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "__fixtures__/commdict-context50.json"), "utf8"),
) as Row[];
const byCode = new Map(rows.map((r) => [r.code, r.description]));

function categoryOf(code: string): OrganismCategory {
  const d = byCode.get(code);
  assert.ok(d !== undefined, `fixture is missing code ${code}`);
  return classify(d);
}

test("the fixture is the dictionary we measured", () => {
  assert.equal(rows.length, 647, "regenerate the fixture if the dictionary changed");
});

test("gram-stain morphology is a bacterial finding, not a negative culture", () => {
  // The bug: NO_GROWTH_RE's bare `negative` matched "Gram negative bacilli", so
  // Gram-negatives — among the most important AMR pathogens — classified as
  // no-growth, and v2-transform.ts:394 then skipped them as AST hosts.
  assert.equal(categoryOf("GNB"), "bacteria");   // Gram negative bacilli
  assert.equal(categoryOf("GNC"), "bacteria");   // Gram negative cocci
  assert.equal(categoryOf("GNDC"), "bacteria");  // Gram negative diplococci
  assert.equal(categoryOf("ANGNC"), "bacteria"); // Anaerobic gram negative coccus
});

test("genuine no-growth results still classify as none", () => {
  assert.equal(categoryOf("NG"), "none");    // No growth
  assert.equal(categoryOf("NG48"), "none");  // No growth after 48 hours
  assert.equal(categoryOf("NBG"), "none");   // No bacterial growth
  assert.equal(categoryOf("GRW7"), "none");  // Nogrowth after 7days Icubation (one word!)
  assert.equal(categoryOf("NF"), "none");    // Normal flora isolated
  assert.equal(categoryOf("BC1"), "none");   // Aerobic culture - Negative
  assert.equal(categoryOf("BC3"), "none");   // Anaerobic cult - negative
});

test("no-growths with words between 'no' and 'growth' are caught", () => {
  // Previously missed: `no\s*growth` cannot match across an intervening word,
  // so these classified as bacteria — i.e. a negative culture became a pathogen.
  assert.equal(categoryOf("NFG"), "none");  // No fungal growth
  assert.equal(categoryOf("NSB"), "none");  // No Signf. bact. growth Repeat
});

test("the 16 missing fungal genera classify as fungus", () => {
  // TORGL is Torulopsis glabrata — the old name for Candida glabrata, a major
  // drug-resistant yeast, previously reported as a bacterium.
  for (const code of ["ABSID", "ACREM", "ALTER", "BIPOL", "CURVU", "EXOJE", "EXOPH",
                      "GEOCA", "GEOTR", "HANAN", "MADGR", "MADMY", "MALFU", "PHIAL",
                      "PHIRI", "PHIVE", "PICET", "RHIZO", "RHODT", "RHOGL", "RHOPI",
                      "RHORU", "SPOSC", "TORGL", "TORIN"]) {
    assert.equal(categoryOf(code), "fungus", `${code} = ${byCode.get(code)}`);
  }
});

test("fungi that already worked still work", () => {
  assert.equal(categoryOf("CANAL"), "fungus");  // Candida albicans
  assert.equal(categoryOf("ASPFU"), "fungus");  // Aspergillus fumigatus
});

test("no code in this dictionary is a parasite", () => {
  // Documents the measured finding (0 parasite codes) and fails loudly if a
  // future dictionary adds one — at which point Slice C needs a parasite code.
  const parasites = rows.filter((r) => classify(r.description) === "parasite");
  assert.deepEqual(parasites, [], "a parasite code appeared — see the classifier spec");
});

test("classification is exhaustive and total", () => {
  // Every row lands in exactly one known bucket; nothing throws.
  const valid = new Set<OrganismCategory>(["bacteria", "fungus", "parasite", "none"]);
  for (const r of rows) assert.ok(valid.has(classify(r.description)), `${r.code} = ${r.description}`);
});
```

- [ ] **Step 2: Run it — expect FAILURES**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node --import tsx --test src/export/codebook-classify.test.ts 2>&1 | tail -20
```

Expected: **3 failing tests** —
- "gram-stain morphology…" (GNB is currently `none`)
- "no-growths with words between…" (NFG/NSB are currently `bacteria`)
- "the 16 missing fungal genera…" (ABSID is currently `bacteria`)

The other tests should already pass. **If "genuine no-growth results" or "fungi that already worked" fail, STOP** — that means the fixture or the hoist is wrong, not the regexes.

- [ ] **Step 3: Commit the failing harness**

```bash
cd /d/Projects/Repositories/cdr-toolchain
git add apps/cli/src/export/codebook-classify.test.ts
git commit -m "test(export): pin organism classification against the real dictionary

Red: GNB/GNC/GNDC/ANGNC classify as no-growth, NFG/NSB as bacteria, and 16
fungal genera as bacteria. Each expectation was measured against the live
COMMDICT, not assumed."
```

---

## Task 5: Fix the three regexes

**Files:**
- Modify: `apps/cli/src/export/codebook.ts:37-39` and `classify` (hoisted in Task 3)

- [ ] **Step 1: Replace the regexes and the classify body** — SKETCH (new code)

Current, verbatim at `codebook.ts:37-39`:

```ts
const NO_GROWTH_RE = /\b(no\s*(growth|bacterial|pathogen|organism)|normal\s*flora|sterile|negative)\b/i;
const FUNGUS_RE = /\b(candida|cryptoc|aspergillus|fusarium|trichoph|microsporum|histoplasm|mucor|yeast|fungi|mould|mold)\b/i;
const PARASITE_RE = /\b(plasmodi|trypanos|leishman|schistos|filari|giardia|entamoeba|cryptosporid|toxoplasm|trichomon|ascaris|strongyl|hookworm|hymenolep|taenia|necator|enterobi)\b/i;
```

Replace with:

```ts
// Explicit no-growth phrasing. `no\s*(\w+[\s.]+){0,3}growth` tolerates words
// between "no" and "growth" ("No fungal growth", "No Signf. bact. growth") while
// `\s*` still matches the one-word "Nogrowth after 7days Icubation" (GRW7).
// Bounded to 3 words so it cannot join a stray "no" to a distant "growth".
const NO_GROWTH_RE = /\b(no\s*(\w+[\s.]+){0,3}(growth|bacterial|pathogen|organism)|normal\s*flora|sterile)\b/i;

// Gram-stain morphology ("Gram negative bacilli") is a BACTERIAL finding. It must
// be recognised before NEGATIVE_RE, or the word "negative" in it reads as a
// negative culture — the bug this fix exists for.
const GRAM_STAIN_RE = /\bgram\s*(positive|negative)\b/i;

// A culture reported negative: "Aerobic culture - Negative" (BC1), "Anaerobic
// cult - negative" (BC3). Checked AFTER gram-stain morphology.
const NEGATIVE_RE = /\bnegative\b/i;

// 16 genera appended 2026-07-16, measured against the real dictionary: they were
// classifying as bacteria. TORGL (Torulopsis glabrata) is the old name for
// Candida glabrata — a major drug-resistant yeast reported as a bacterium.
const FUNGUS_RE = /\b(candida|cryptoc|aspergillus|fusarium|trichoph|microsporum|histoplasm|mucor|yeast|fungi|mould|mold|absidia|acremonium|alternaria|bipolaris|curvularia|exophiala|geotrichum|hansenula|madurella|malassezia|phialophora|pichia|rhizopus|rhodotorula|sporothrix|torulopsis)\b/i;

const PARASITE_RE = /\b(plasmodi|trypanos|leishman|schistos|filari|giardia|entamoeba|cryptosporid|toxoplasm|trichomon|ascaris|strongyl|hookworm|hymenolep|taenia|necator|enterobi)\b/i;
```

And the hoisted `classify` becomes:

```ts
/** Bucket a COMMDICT[CONTEXT=50] organism description into v2's organism_type.
 *  Exported so the classifier can be tested against a fixture of the real
 *  dictionary without a database — see codebook-classify.test.ts.
 *
 *  Order is load-bearing:
 *   1. explicit no-growth wins outright ("No growth of gram negative organisms")
 *   2. gram-stain morphology is bacteria, NOT a negative culture
 *   3. only then does a bare "negative" mean a negative culture
 */
export function classify(desc: string): OrganismCategory {
  if (desc.length === 0) return "bacteria";
  if (NO_GROWTH_RE.test(desc)) return "none";
  if (GRAM_STAIN_RE.test(desc)) return "bacteria";
  if (NEGATIVE_RE.test(desc)) return "none";
  if (FUNGUS_RE.test(desc)) return "fungus";
  if (PARASITE_RE.test(desc)) return "parasite";
  return "bacteria";
}
```

**Note on `BL-` ("á-Lactamase Negative"):** it stays `none` via `NEGATIVE_RE`, exactly as today. It
is a resistance marker rather than an organism, but reclassifying it is out of scope (see the spec)
— and `none` at least keeps it out of AMR reporting, whereas `bacteria` would make it a pathogen.
**Do not "fix" it here.**

- [ ] **Step 2: Run the harness — expect PASS**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node --import tsx --test src/export/codebook-classify.test.ts 2>&1 | grep -E "^(✔|✖)|ℹ (tests|pass|fail)"
```

Expected: 8 tests, all passing.

- [ ] **Step 3: Full suite + typecheck**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli && pnpm test 2>&1 | grep -E "ℹ (tests|pass|fail|skipped)" && pnpm typecheck
```

Expected: **125 tests, 124 pass, 1 skipped** (117 + 8 new), typecheck clean.

**If any pre-existing test now fails, STOP and report it.** Existing audit/export tests may encode the old behaviour — that is exactly the signal we need, and it must be reviewed by a human, not silently "fixed".

- [ ] **Step 4: Commit**

```bash
cd /d/Projects/Repositories/cdr-toolchain
git add apps/cli/src/export/codebook.ts
git commit -m "fix(export): stop classifying Gram-negative bacteria as no growth

NO_GROWTH_RE's bare \`negative\` matched 'Gram negative bacilli', so
Gram-negatives classified as no-growth and v2-transform.ts:394 skipped them
as AST hosts — live on the Moz/Zambia migration today. Gram-stain morphology
is now recognised as a bacterial finding before a bare 'negative' can read as
a negative culture, with explicit no-growth still winning outright.

Also: allow words between 'no' and 'growth' (NFG 'No fungal growth', NSB)
while still matching the one-word 'Nogrowth' (GRW7); and add the 16 fungal
genera measured as missing, including TORGL (Torulopsis glabrata = Candida
glabrata), previously reported as a bacterium."
```

---

## Task 6: Live sanity check against real data

**Files:** none

Read-only against the live production DISA. **No writes; no CE involvement.**

- [ ] **Step 1: Re-classify the 21 known culture labs and inspect organism_type**

```bash
cd /d/Projects/Repositories/cdr-toolchain/apps/cli
node --import tsx src/index.ts export-batch \
  --where "LabNo IN ('TDS0050309','TDS0049918','TDS0028115','TDS0028009','TDS0028008','TDS0025433','TDS0013541','TDS0012247','TDS0012245','TDS0012244','TDS0012243')" \
  --limit 20 --dry-run --emit-payloads 2>/dev/null | python -c "
import sys, json
for line in sys.stdin:
    line = line.strip()
    if not line.startswith('{'): continue
    try: d = json.loads(line)
    except: continue
    rid = (d.get('lab_request') or {}).get('request_id')
    for i in d.get('isolates') or []:
        oc = i.get('organism_code') or {}
        print(f\"{rid}  {i.get('organism_type'):9} {oc.get('concept_code')} = {oc.get('display_name')}\")
"
```

Expected: `CANAL Candida albicans` → **`fungus`** (it was already), `NBG`/`NG48` → **`none`**. Nothing should regress to `none` that is a real organism.

- [ ] **Step 2: Report before merging**

Report the output. **This is a human review gate** — the change alters live v2 AST attribution, and the compare gate cannot verify it. Do not merge without review.

---

## Task 7: Merge

**Files:** none

- [ ] **Step 1: Merge to local `main`**

```bash
cd /d/Projects/Repositories/cdr-toolchain
git checkout main
git merge --no-ff fix/organism-classifier -m "fix(export): make organism_type trustworthy

Gram-negative bacteria classified as no-growth (NO_GROWTH_RE's bare
'negative' matched 'Gram negative bacilli'), so v2-transform's
nearestGrowthPositiveIsolate skipped them as AST hosts — live on the
Moz/Zambia migration. Also caught two missed no-growths and 16 fungal
genera classifying as bacteria.

Adds a fixture of all 647 real COMMDICT pathogen-id codes: the heuristics
had never been measured against the dictionary they classify.

Prerequisite for the CE read-model slices (provenance, organism semantics)."
git branch -d fix/organism-classifier
git log --oneline -1 && git status --short
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `negative` must not match "gram negative" | 5 |
| Catch `NFG` / `NSB` | 5 |
| Add the 16 measured fungal genera | 5 |
| 647-code fixture harness, no DB at test time | 2, 4 |
| Assert GNB/GNC/GNDC/ANGNC → bacteria | 4 |
| Assert BC1/BC3/NBG/NG/NG48/GRW7/NF/NFG/NSB → none | 4 |
| Assert ABSID/ASPFU/CANAL → fungus | 4 |
| Assert no parasites (documents the 0 finding, fails if one appears) | 4 |
| Live sanity on the 21 culture labs | 6 |
| Full regression suite green | 3, 5 |
| Growth quantifiers / `BL-` NOT fixed | 5 (explicit "do not fix" note) |
| `634-6` → `6463-4` not touched | n/a — no task, correctly absent |

No gaps.

**Placeholder scan:** no TBD/TODO; every code step carries complete code; new code marked SKETCH, and every quoted existing line carries a `file:line`.

**Type consistency:** `classify(desc: string): OrganismCategory` — defined in Task 3, unchanged in
Task 5, imported in Task 4. `OrganismCategory` is the existing exported type (`codebook.ts:41`).
Fixture row shape `{code, description}` — written in Task 2, read identically in Task 4.
`NO_GROWTH_RE` / `GRAM_STAIN_RE` / `NEGATIVE_RE` / `FUNGUS_RE` / `PARASITE_RE` are all defined in
Task 5 and used only by `classify`.

**One risk worth restating:** Task 5 Step 3 may surface pre-existing tests that encode the old
(buggy) behaviour. The plan deliberately tells the implementer to STOP rather than update them —
a test asserting that a Gram-negative is "no growth" is a bug the human should see, not a chore.
