# Terminology Management UI — SP3: Value Sets + Value Set Builder — Design

**Date:** 2026-06-15
**Status:** Approved (brainstorm) — pending implementation plan
**Module:** apps/web Terminology page + @openldr/terminology + @openldr/db + apps/server + @openldr/cli
**Predecessors:** SP1 (Publishers + Code Systems, merged `b434a9b`), SP2 (Terms + Mappings, merged `b71ad4b`)
**Design source of truth:** corlix (`D:\Projects\Repositories\corlix`) — reimplement-not-copy.

## Problem

SP1 + SP2 gave CE a faithful corlix-style Terminology page with Publishers, Code
Systems, Terms, and Mappings authoring. The third FHIR terminology layer — the
**ValueSet** — is missing from the authoring UI. CE *serves* ValueSets today
(`$expand` / `$validate-code` in `packages/terminology/src/operations.ts`) but
only for ValueSet **resources** stored in the fhir store, and the inline expander
supports **exactly one `compose.include`** with a single `=` filter. There is no
way to author a ValueSet, no multi-clause expansion, no import/export, and the
page's `⋯` menu is missing the **Term** and **Value set** submenus that corlix has.

SP3 ports corlix's Value Set Builder faithfully: a `value_sets` authoring table
(FHIR-shaped `compose` JSON) that is the single source of truth, a full ported
expander, a materialized expansion cache, FHIR JSON import/export, and the
builder/list UI — and upgrades the FHIR serve path to the full expander so
authored multi-clause ValueSets are served correctly.

## Decisions (locked during brainstorm)

1. **Scope:** Full faithful builder — everything in corlix's `ValueSetBuilder.tsx`
   (metadata, include/exclude editor, enumerated concepts, `class`/`status`
   filters, import-another-ValueSet, live expansion preview, FHIR JSON
   import/export, duplicate, immutable banner) + seed ValueSets. One large
   sub-project (~18–20 tasks), consistent with SP1/SP2.
2. **Read-path integration:** **Full ported expander + projected FHIR resource.**
   Port corlix's pure `expandCompose` into `@openldr/terminology` over an
   `ExpandDeps` adapter (preserves DP-1). `value_sets` + `valueset_expansions` are
   the source of truth. On save, expand and **project** a FHIR `ValueSet` resource
   (with materialized `expansion`) into the fhir store + `terminology_systems`, so
   `$expand`/`$validate-code` keep working and now handle multi-clause composes.
   The single-include inline expander in `operations.ts` is **replaced** by the
   ported expander.
3. **Seeds:** Seed corlix's small local ValueSets under the local "System"
   publisher as **editable** (`immutable = false`) sets using **enumerated
   concepts** (inline codes), so they expand without LOINC/SNOMED content imported.
   (Per the standing rule that only HL7 FHIR R4 + UCUM ship with code-system
   *content*; ValueSets are corlix-authored local data, no licensing concern.)

## Architecture overview

```
                 ┌─────────────────────────── apps/web ──────────────────────────┐
                 │  Terminology.tsx  (publisher rail + breadcrumb + segmented      │
                 │     "Code systems | Value sets" toggle + value-set list table)  │
                 │  ValueSetBuilder.tsx (Sheet)   ValueSetPicker.tsx               │
                 └───────────────┬───────────────────────────────────────────────┘
                                 │ api.ts (fetch)
                 ┌───────────────▼─────────────── apps/server ────────────────────┐
                 │  terminology-admin-routes.ts  /api/terminology/valuesets*       │
                 │     (duck-type TerminologyAdminError guard + redact())          │
                 └───────────────┬───────────────────────────────────────────────┘
                                 │ ctx.terminology.admin.valueSets
   ┌─────────── @openldr/db ─────▼──────────┐     ┌──────── @openldr/terminology ──────┐
   │ terminology-admin-store.ts             │     │ expander.ts  expandCompose(deps)   │
   │   valueSets: { list/get/save/expand/   │ ◄── │   (pure; ExpandDeps adapter)       │
   │     duplicate/delete/import/export }   │     │ fhirValueSet.ts  to/from FHIR JSON │
   │ migration 014_value_sets               │     │ operations.ts  $expand/$validate   │
   │   value_sets + valueset_expansions     │     │   now use expandCompose            │
   └────────────────┬───────────────────────┘     └────────────────────────────────────┘
                    │ projection dep (bootstrap-wired): fhirStore.save + saveSystem
                    ▼
        fhir store + terminology_systems  ←── getResourceByUrl ──  operations.ts serve path
```

## Section 1 — Data model (migration `014_value_sets`)

New migration `packages/db/src/migrations/internal/014_value_sets.ts`, registered
in `internal/index.ts` after `013`. Two tables + seed data.

```sql
CREATE TABLE value_sets (
  id           text PRIMARY KEY,                 -- vs-<uuid>
  url          text NOT NULL,                    -- canonical; UNIQUE (plain index)
  version      text,
  name         text,                             -- machine name
  title        text,                             -- human title
  status       text NOT NULL DEFAULT 'draft',    -- draft | active | retired
  experimental boolean NOT NULL DEFAULT false,
  description  text,
  compose      jsonb NOT NULL DEFAULT '{}',      -- FHIR ValueSet.compose
  source_json  jsonb,                            -- raw resource for imported externals
  immutable    boolean NOT NULL DEFAULT false,
  category     text,                             -- "Source" column (nullable)
  publisher_id text,                             -- -> publishers.id (no FK, matches existing tables)
  expanded_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX value_sets_url_key ON value_sets(url);   -- PLAIN unique (url is NOT NULL)
CREATE INDEX value_sets_publisher ON value_sets(publisher_id);

CREATE TABLE valueset_expansions (
  value_set_id text NOT NULL REFERENCES value_sets(id) ON DELETE CASCADE,
  system_url   text NOT NULL,
  code         text NOT NULL,
  display      text,
  inactive     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (value_set_id, system_url, code)
);
CREATE INDEX valueset_expansions_vs ON valueset_expansions(value_set_id);
```

**Notes**
- `url` is `NOT NULL` so a plain unique index is correct (no NULLS-distinct concern
  like `coding_systems.url`). `ON CONFLICT(url)` is used for save-by-url.
- No FK on `publisher_id` (consistent with `coding_systems.publisher_id`).
- `category` is nullable; faithful to corlix's "Source" column. Population is
  optional — seeds may set it; otherwise it stays null.
- `ON DELETE CASCADE` works on real PG. pg-mem does not enforce cascade on its own
  in all cases, so the store's `delete()` also explicitly deletes expansion rows.

### Schema types

Add to `packages/db/src/schema/internal.ts`: `ValueSetsTable`, `ValuesetExpansionsTable`,
and register on `InternalSchema` as `value_sets` and `valueset_expansions`.

### Seed ValueSets

Seed in the migration `up()` (idempotent via `ON CONFLICT(url) DO NOTHING`) under
the local **System** publisher (id `pub-system`, resolved via `resolveSeedPublisherId`
of the local url, matching SP1's seeding). Each uses **enumerated concepts** so it
expands offline. Canonical url prefix: `urn:openldr:valueset:<slug>`.

| slug | title | status | concepts (system / code → display) |
|---|---|---|---|
| `yes-no` | Yes / No | active | `urn:openldr:cs:local` Y→Yes, N→No |
| `biological-sex` | Biological Sex | active | local M→Male, F→Female, O→Other, U→Unknown |
| `result-interpretation` | Result Interpretation | active | local POS→Positive, NEG→Negative, IND→Indeterminate |
| `specimen-type` | Specimen Type | draft | local BLD→Blood, UR→Urine, CSF→CSF, SPT→Sputum |
| `malaria-species` | Malaria Species | draft | local PF→P. falciparum, PV→P. vivax, PM→P. malariae, PO→P. ovale |
| `hiv-result` | HIV Result | draft | local R→Reactive, NR→Non-reactive, IND→Indeterminate |

Seeds reference a local code system url `urn:openldr:cs:local`. The migration also
seeds that code system (publisher System) + its concepts into `terminology_concepts`
and registers the seed ValueSet resources via the same projection the store uses
(so `$expand` serves them immediately after migrate). The migration writes the
projected FHIR `ValueSet` resource rows + `terminology_systems` registration + the
`valueset_expansions` cache directly (it has the raw `db`), matching what the store's
`save()` does at runtime.

## Section 2 — Expander (`packages/terminology/src/expander.ts`)

Port corlix's `apps/desktop/src/main/expander.ts` verbatim in behavior. Pure
function over an injected deps adapter — no DB import, preserving DP-1.

```ts
export interface ExpandedConcept { system: string; code: string; display: string | null }

export interface ExpandDeps {
  listSystemConcepts(systemUrl: string, activeOnly: boolean): Promise<ExpandedConcept[]>;
  filterConcepts(systemUrl: string, filters: VsFilter[], activeOnly: boolean): Promise<ExpandedConcept[]>;
  resolveDisplay(systemUrl: string, code: string): Promise<string | null>;
  resolveValueSetCompose(url: string): Promise<VsCompose | null>;
}

export interface ExpandOptions { activeOnly?: boolean; seedUrls?: string[] }

export async function expandCompose(
  compose: VsCompose, deps: ExpandDeps, opts?: ExpandOptions,
): Promise<{ codes: ExpandedConcept[]; total: number }>;
```

**Semantics (faithful):**
- Per `include`/`exclude` clause, each present dimension yields a candidate set;
  the clause result is their **intersection** by `(system, code)`:
  - `system` + `concept[]` → enumerated codes (display from `concept.display` or
    `resolveDisplay`);
  - `system` + `filter[]` → `filterConcepts`;
  - `system` only → `listSystemConcepts`;
  - `valueSet[]` → recursively expand each imported url.
  - A clause with neither `system` nor `valueSet` → empty.
- **Union** across includes; **subtract** excludes; **dedup** by `(system, code)`.
- Imports: `MAX_IMPORT_DEPTH = 16`, `visited` set cycle-guard seeded with the root
  set's own url (`opts.seedUrls`).
- `activeOnly` defaults true.

corlix's expander is **synchronous** (SQLite); CE's deps are **async** (Kysely), so
the port is async (`await` each deps call, `Promise.all` where corlix maps). Logic
otherwise identical. Filters supported: `class` and `status` with op `=`/`equals`
(matches CE's current `operations.ts` capability + corlix slice 1). Unsupported
filter ops throw `TerminologyError('filter op ... unsupported', 'invalid')`.

**`VsCompose` / `VsFilter` / `VsInclude` types** live in `@openldr/terminology`
(type-only; reuse `@openldr/fhir` `ValueSet['compose']` shape where possible). The
FHIR `ValueSet` type in `@openldr/fhir` already carries `compose`; the expander
types narrow to the supported subset.

### `operations.ts` upgrade

`createOperations(source)` currently has a single-include `expand` and a
single-include `validateCode`. Replace both to use `expandCompose`:

- Build an `ExpandDeps` from the existing `ConceptSource`:
  - `listSystemConcepts(sys, active)` → `source.findConcepts({ system: sys, limit: BIG })`,
    filter by `status === 'ACTIVE'` when `active` (or pass a status property filter).
  - `filterConcepts(sys, filters, active)` → `source.findConcepts({ system: sys, property: {name,value} })`
    for the (single) supported `=` filter.
  - `resolveDisplay(sys, code)` → `source.getConcept(sys, code)?.display`.
  - `resolveValueSetCompose(url)` → `valueSetOf(await source.getResourceByUrl(url))?.compose ?? null`.
- `expand(url, opts)` → load the ValueSet resource via `getResourceByUrl`, run
  `expandCompose(vs.compose, deps, { seedUrls:[url] })`, apply `offset`/`count`
  paging to the resulting codes, return the FHIR `ValueSet` with `expansion`.
- `validateCode({ valueSetUrl, code, system? })` → expand the set, membership = code
  present in the expansion (respecting `system` if given).
- `LIMIT`/paging: `listSystemConcepts` uses a high cap (e.g. 10_000) — documented;
  whole-system expansion of huge systems (LOINC) is bounded and logged, not silently
  truncated (a `log`/comment notes the cap). Seeds and lab value sets are small.

This keeps the FHIR endpoints working and makes them multi-clause capable. Existing
`operations.test.ts` Slice-A tests are updated to the new behavior (a single-include
set still expands identically).

## Section 3 — FHIR JSON import/export (`packages/terminology/src/fhirValueSet.ts`)

Port corlix's `fhirValueSet.ts`:
- `fhirValueSetToInput(resource: unknown): ValueSetInput` — validates `resourceType`
  + `url`, maps `compose.include/exclude` clauses (system / concept[] / filter[] /
  valueSet[]), falls back to building a `compose` from `expansion.contains` when no
  `compose` is present. Throws on invalid input.
- `valueSetToFhirResource(vs, expansion?)` — emits a FHIR R4 `ValueSet` resource
  (+ `expansion` block when codes provided).

Designations are **dropped** (deferred non-goal) — the mapper ignores
`concept.designation` rather than carrying it, with a comment. (corlix keeps them;
CE's slice does not author designations.)

## Section 4 — Admin store `valueSets` namespace (`packages/db/src/terminology-admin-store.ts`)

Extend `TerminologyAdminStore` with a `valueSets` namespace and corresponding types
(`ValueSet`, `ValueSetSummary`, `ValueSetInput`, `ValueSetCompose`, `ExpandedCode`).

```ts
valueSets: {
  list(publisherId?: string): Promise<ValueSetSummary[]>;
  get(id: string): Promise<ValueSet>;                       // throws not-found
  getByUrl(url: string): Promise<ValueSetSummary | null>;
  save(input: ValueSetInput): Promise<ValueSet>;            // upsert by url
  duplicate(id: string): Promise<ValueSet>;
  delete(id: string): Promise<void>;                        // throws not-found
  expand(id: string, activeOnly?: boolean): Promise<{ codes: ExpandedCode[]; total: number }>;
  importFhir(resource: unknown): Promise<ValueSet>;
  exportFhir(id: string): Promise<Record<string, unknown>>;
}
```

**Behavior**
- `list`: `value_sets` (optionally filtered by `publisher_id`) LEFT JOIN a
  `valueset_expansions` count → `codeCount`; `primarySystem` = first include's
  `system` (or the dominant system in the cache); ordered by `title`/`url`.
- `save`: validate `url` (required). If a row with that `url` exists **and**
  `immutable`, throw `TerminologyAdminError('immutable ... duplicate to edit', 'conflict')`.
  Otherwise upsert (`ON CONFLICT(url)`), assigning `id = vs-<uuid>` for inserts.
  Then **expand** (via `expandCompose` over a DB-backed `ExpandDeps`), rewrite the
  `valueset_expansions` cache, stamp `expanded_at`, and **project** the FHIR resource
  (Section 5). Transactional.
- `duplicate`: load source, save a copy with `url + '-copy'` (deduped if taken),
  `immutable = false`, `status = 'draft'`.
- `delete`: throw not-found if missing; else delete `value_sets` row (+ explicit
  `valueset_expansions` delete for pg-mem) + de-project (Section 5). Transactional.
- `expand`: build DB-backed `ExpandDeps`, run `expandCompose`, refresh cache, return
  codes. The DB-backed deps:
  - `listSystemConcepts(sys, active)` → `terminology_concepts WHERE system = sys
    [AND status = 'ACTIVE']`.
  - `filterConcepts(sys, filters, active)` → `properties->>{property} = {value}`
    (matches `terminology-store.applyConceptFilter`).
  - `resolveDisplay` → `terminology_concepts` lookup.
  - `resolveValueSetCompose(url)` → `value_sets WHERE url = url` → `compose`.
- `importFhir`: `fhirValueSetToInput(resource)` → keep raw in `source_json` → `save`.
- `exportFhir`: load set + cached expansion → `valueSetToFhirResource`.

**DB-backed `ExpandDeps`** is a small helper inside the store (not exported); it
reuses the same Kysely instance. N+1 is bounded (small value sets).

## Section 5 — Projection to the read path

The admin store needs to write a FHIR `ValueSet` resource into the fhir store and
register its url in `terminology_systems`. The store currently takes only
`db: Kysely<InternalSchema>`. Add an **optional** second parameter:

```ts
export interface ValueSetProjection {
  saveValueSetResource(resource: Record<string, unknown>): Promise<string>;  // returns resource id
  registerSystem(url: string, version: string | null, kind: string, resourceId: string): Promise<void>;
  deleteValueSetResource(url: string): Promise<void>;
}
export function createTerminologyAdminStore(
  db: Kysely<InternalSchema>, projection?: ValueSetProjection,
): TerminologyAdminStore;
```

- **Bootstrap wiring** (`index.ts` + `terminology-context.ts`): build `projection`
  from the existing `fhirStore` + `termStore.saveSystem` + a delete that removes the
  `terminology_systems` row and the projected resource. Pass it to
  `createTerminologyAdminStore`.
- **Tests** (pg-mem) pass no projection → the store **skips projection** (no-op) and
  exercises only `value_sets` + `valueset_expansions`. Expansion + cache are still
  testable without a fhir store.
- `save()` projects: `valueSetToFhirResource(vs, codes)` → `saveValueSetResource` →
  `registerSystem(url, version, 'ValueSet', resourceId)`. `delete()` calls
  `deleteValueSetResource(url)`.

This is the same "project-into the read index" pattern as SP2 mappings
(`concept_map_elements`) and terms (`terminology_concepts`).

## Section 6 — REST routes (`apps/server/src/terminology-admin-routes.ts`)

Add under the existing terminology-admin route group, reusing `mapErr` / the
duck-type `isAdminError` guard / `redact()`:

| Method | Path | Handler |
|---|---|---|
| GET | `/api/terminology/valuesets?publisherId=` | `admin.valueSets.list` |
| POST | `/api/terminology/valuesets` | `admin.valueSets.save` (zod `valueSetInput`) |
| GET | `/api/terminology/valuesets/:id` | `admin.valueSets.get` |
| PUT | `/api/terminology/valuesets/:id` | `admin.valueSets.save` (input incl. url) |
| DELETE | `/api/terminology/valuesets/:id` | `admin.valueSets.delete` |
| POST | `/api/terminology/valuesets/:id/duplicate` | `admin.valueSets.duplicate` |
| GET | `/api/terminology/valuesets/:id/expand?activeOnly=` | `admin.valueSets.expand` |
| POST | `/api/terminology/valuesets/import` | `admin.valueSets.importFhir` (raw JSON body) |
| GET | `/api/terminology/valuesets/:id/export` | `admin.valueSets.exportFhir` (JSON download) |

Zod: `valueSetInput` validates `url` (required), `title`/`name`/`version`/`description`
(nullable), `status` (enum), `experimental` (bool), `compose` (object), `publisherId`
(optional), `category` (optional). `compose` validated structurally (include/exclude
arrays of clauses); unknown keys stripped.

## Section 7 — CLI (`packages/cli/src/terminology.ts`)

Add `terminology valueset list` (prints url · title · status · codeCount), matching
the existing `publisher list` / `system list` / `term list` style.

## Section 8 — API client (`apps/web/src/api.ts`)

Add types `ValueSet`, `ValueSetSummary`, `ValueSetInput`, `ValueSetComposeInclude`,
`ExpandedCode` and client fns: `listValueSets(publisherId?)`, `getValueSet(id)`,
`saveValueSet(input)`, `deleteValueSet(id)`, `duplicateValueSet(id)`,
`expandValueSet(id, activeOnly?)`, `importValueSet(json)`, `valueSetExportUrl(id)`.

## Section 9 — Web UI (faithful corlix port)

### `publisherSections.ts`
Extend signature to `publisherSections(publishers, systems, valueSets)`; each
returned section gains `valueSets: ValueSetSummary[]` (filtered by `publisher_id`).
Seeded publishers remain always-visible (SP1 rule). Update the SP1/SP2 callsite +
unit test.

### `Terminology.tsx`
- Load `valueSets` alongside publishers/systems in `reload()`.
- Derived `bothKinds` = active section has systems **and** valueSets → render a
  **segmented toggle** ("Code systems | Value sets") in the breadcrumb (corlix
  `paneTab`), defaulting to `systems`. Single-kind publishers skip the toggle.
- **`⋯` breadcrumb menu**: add two submenus (closing carry-forward feedback):
  - **Term** (New · Import · Download) — targets the selected system; New hidden for
    `external` publishers; items disabled when no system selected. (CE previously
    only reached Terms by drilling; this matches corlix's kebab.)
  - **Value set** (New · Import). Edit/Delete live on each value-set row's `⋯`.
- **Value-set list table** (shown when `valueSets.length > 0 && !selectedSystemId &&
  (!bothKinds || paneTab === 'valuesets')`): columns Title · URL · System
  (`primarySystem` label) · Source (`category` badge) · Codes (`codeCount`) · Status
  · `⋯`. Row click opens the builder. Row `⋯`: View/Edit · Duplicate · Export ·
  Delete (Delete hidden when `immutable`). Search input + system Select filter
  (faithful to corlix `vsSearch` / `vsSystem`). `TablePagination`.
- **Builder Sheet**: right-side `Sheet` (`sm:max-w-2xl`, `p-0`) wrapping
  `<ValueSetBuilder>`, keyed by `editingValueSet?.id ?? 'new'`.

### `ValueSetBuilder.tsx` (`apps/web/src/terminology/`)
Port corlix's component:
- Metadata grid: url, title, version, status (Select), publisher (Select).
- `readOnly` when `immutable` → inputs disabled + amber immutable banner; kebab shows
  Duplicate instead of Save.
- Compose editor: include clauses (system Select + enumerated concept rows with
  code/display inputs + add/remove; import-clause rows render compact read-only) +
  "import another ValueSet" via `<ValueSetPicker>` + "add include"; exclude clauses
  symmetric.
- Live expansion preview pane: calls `expandValueSet(savedId)` after save / on open;
  shows count + resolved codes; "save to preview" hint before first save.
- Kebab (`⋯`): Save (disabled until url) / Duplicate (readOnly) / Cancel / Re-expand /
  Export / Delete.
- Uses shadcn primitives (Select/Input/Label/Button/DropdownMenu) per the standing
  rule. `crypto.randomUUID()` for editing keys (already used elsewhere in web).

### `ValueSetPicker.tsx` (`apps/web/src/terminology/`)
Port corlix's typeahead: loads `listValueSets()` once, filters client-side by
title/name/url, calls `onPick(summary)`.

## Section 10 — Testing

- **Expander unit tests** (`expander.test.ts`): enumerated, whole-system, class
  filter, status filter, valueSet import, cycle guard, depth cap, exclude,
  intersect-within-clause, union-across, dedup, activeOnly. (Port corlix's
  `expander.test.ts` cases, async.)
- **FHIR round-trip** (`fhirValueSet.test.ts`): `toInput` → `save`-shape →
  `toResource` preserves url/status/compose; `expansion.contains` fallback; invalid
  input throws.
- **operations.test.ts**: updated — single-include still expands; multi-include +
  exclude + import now expand; `$validate-code` membership.
- **admin-store** (pg-mem): save (insert + update), upsert-by-url, immutable-reject,
  duplicate, delete (+ cascade), expand refreshes cache, list codeCount/primarySystem.
- **migration 014** (`014_value_sets.test.ts`): tables exist; seeds present; seed VS
  expands to enumerated codes.
- **REST contract**: CRUD + duplicate + expand + import + export happy paths +
  not-found / conflict mapping.
- **publisherSections.test.ts**: sections carry valueSets; seeded publishers shown.
- **e2e** (`terminology.spec.ts`): create a code system → add a term → create a
  ValueSet that includes that system+code → open builder → expansion preview shows
  the code → ValueSet appears in the list. Idempotent via `RUN=Date.now()`.
- **Live-PG acceptance**: reseed Postgres, author a ValueSet, hit
  `GET /fhir/ValueSet/$expand?url=…` and `/$validate-code`, confirm authored
  multi-clause set serves; `pnpm docs:screenshots` regenerated.
- **Gates**: `turbo typecheck lint test build` + `depcruise` green.

## Section 11 — Non-goals (deferred)

- SNOMED `is-a` / hierarchy filters → **SP4** (ontology browser + hierarchy edges).
- Designations / translations (i18n) — mapper drops them.
- Form-binding (CE has no Form Builder; corlix slice 2).
- ValueSet sync to a remote API mirror (corlix slice 3 desktop→API push; CE serves
  directly from its own store).
- External terminology servers (tx.fhir.org).
- Per-user ownership of ValueSets (owner_id) — consistent with dashboards/terms.

## Affected code (orientation)

- `packages/db/src/migrations/internal/014_value_sets.ts` (+ test) — tables, seeds.
- `packages/db/src/migrations/internal/index.ts` — register 014.
- `packages/db/src/schema/internal.ts` — `value_sets`, `valueset_expansions`.
- `packages/db/src/terminology-admin-store.ts` — `valueSets` namespace + types +
  optional `projection` param + DB-backed `ExpandDeps`.
- `packages/terminology/src/expander.ts` (+ test) — ported `expandCompose`.
- `packages/terminology/src/fhirValueSet.ts` (+ test) — FHIR JSON import/export.
- `packages/terminology/src/operations.ts` (+ test) — use `expandCompose`.
- `packages/terminology/src/index.ts` — export expander + fhirValueSet.
- `packages/bootstrap/src/index.ts` + `terminology-context.ts` — wire `projection`.
- `apps/server/src/terminology-admin-routes.ts` — valuesets routes + zod.
- `packages/cli/src/terminology.ts` + `index.ts` — `valueset list`.
- `apps/web/src/api.ts` — valueset client + types.
- `apps/web/src/terminology/publisherSections.ts` (+ test) — third arg.
- `apps/web/src/terminology/ValueSetBuilder.tsx` (new).
- `apps/web/src/terminology/ValueSetPicker.tsx` (new).
- `apps/web/src/pages/Terminology.tsx` — toggle, value-set list, kebab Term + Value
  set submenus, builder Sheet.
- `e2e/tests/terminology.spec.ts` — value-set flow.
```
