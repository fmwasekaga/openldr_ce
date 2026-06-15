# Terminology Management UI — SP2: Terms + Mappings

**Date:** 2026-06-15
**Status:** Design (approved data-model; spec under review)
**Requirement:** P2-TERM-5 (terminology management UI), second sub-project. Builds on SP1.

## Context

SP1 shipped the terminology page foundation (Publishers + Code Systems) merged to
`main`. SP2 fills in the **drilled-into-a-code-system pane** that SP1 left as a
"Terms — coming in the next update." placeholder: a terms table + Term dialog with a
Details tab and a **full, faithful** Mappings tab (per the user's scope choice —
including corlix's draft-target-term auto-creation and display snapshots).

Corlix is the design source of truth (PRD §10): reimplement, never copy. Corlix
reference components: `apps/desktop/src/renderer/components/TermDialog.tsx`,
`TermMappingDialog.tsx`, `TermPicker.tsx`, and the terms-table region of
`pages/TerminologyPage.tsx`; English labels from `i18n/locales/en.json`
(`terminology.term.*`, `terminology.mapping.*`, `common.*`).

The four sub-projects: SP1 foundation (done) → **SP2 Terms + Mappings (this)** →
SP3 Value Sets → SP4 Ontology browser. The mapping dialog's "Browse ontology"
target-picker depends on SP4 and is rendered **disabled** in SP2.

## Goal (SP2)

- Terms table in the drilled pane: server-side search + status filter + pagination,
  Import / Download-template, row actions.
- `TermDialog` — Details tab (faithful) + Mappings tab (faithful, with count badge).
- `TermMappingDialog` — full mappings (map-type/relationship/owner/is-active; search
  or manual target; draft-target-term creation; "Browse ontology" disabled).
- `TermPicker` — typeahead term search (for the mapping search target).
- CSV terms import + template download.
- Backend: server-side concept search, term CRUD (project-into `properties`),
  `term_mappings` table projecting into `concept_map_elements`.

Out of scope (later): Value Sets (SP3); the ontology browser + the mapping's
ontology target-picker (SP4); full term-create/import CLI.

## Data model & reconciliation

**Terms — project into the existing flat read index (same philosophy as SP1).** A
term is a `terminology_concepts(system, code, display, status, properties jsonb)`
row, keyed by `(system = coding_system.url, code)`. Corlix's extra term fields map
into `properties`:

```
properties = {
  shortName?: string,
  class?: string,
  unit?: string,
  replacedBy?: string,
  meta?: Record<string, unknown>   // the free-form Metadata JSON
}
```

The 4 read ops (`$lookup`/`$validate-code`/`$expand`/`$translate`) + the ingest path
read only `display`/`status`/`properties`, so they stay untouched. Status is
constrained to `ACTIVE` | `DRAFT` | `DEPRECATED` | `DISABLED` in the UI/validation
(the column stays free-text). A term belongs to a code system via
`system = coding_system.url`; managing terms requires the code system to have a
non-null `url` (the join key).

**Server-side search.** New read-store methods on `terminology-store.ts`:
- `searchConcepts(q: { systemUrl; query?; statuses?; limit; offset }): ConceptRecord[]`
  — `where system = systemUrl`, optional `ILIKE` on `code`/`display` (`%query%`,
  case-insensitive), optional `status in (...)`, `order by code`, limit/offset.
- `countConceptsSearch(q)` — same filter, count.

Required because the terms table and the mapping `TermPicker` must page through up
to ~109k LOINC concepts without loading them all.

**Mappings — new `term_mappings` authoring table that projects into
`concept_map_elements`.** Corlix keys terms by a synthetic `id` and a mapping
references `toTermId` OR manual `(toSystemId,toCode,toDisplay)`. CE concepts have NO
synthetic id (composite `(system, code)` key), so a mapping references terms by
`(system_url, code)` and the search-vs-manual UI modes collapse into ONE stored
shape — the target is always `(to_system, to_code, to_display)`.

New internal migration **013_term_mappings**:

- `term_mappings`
  - `id` uuid pk
  - `from_system` text not null (the source term's `coding_system.url`)
  - `from_code` text not null
  - `to_system` text not null (target system url)
  - `to_code` text not null
  - `to_display` text null (snapshot of the target display at map time)
  - `map_type` text not null — `SAME-AS` | `NARROWER-THAN` | `BROADER-THAN` |
    `RELATED-TO` | `UNMAPPED-FROM`
  - `relationship` text null (free text)
  - `owner` text null (free text)
  - `is_active` boolean not null default true
  - `created_at` / `updated_at` (Generated)
  - indexes on `(from_system, from_code)` and `(to_system, to_code)`.

Behavior (faithful to corlix):
- **Outgoing** mappings for term `(S, C)` = rows where `from_system=S, from_code=C`.
  **Reverse** = rows where `to_system=S, to_code=C` (read-only in the UI).
- **Draft-target-term creation:** on mapping create, if `(to_system, to_code)` has
  no `terminology_concepts` row, insert one with `status='DRAFT'`,
  `display=to_display`. The create result carries `draftCreated: boolean` so the UI
  shows corlix's "draft created" notice.
- **Projection into `concept_map_elements`:** on mapping create/update, upsert a
  `concept_map_elements(map_url, source_system=from_system, source_code=from_code,
  target_system=to_system, target_code=to_code, equivalence=map_type)` row so the
  existing `$translate` op reflects authored mappings. On delete, remove it.
  `map_url` = a single synthetic local map `urn:openldr:terminology:local-map`.
  (concept_map_elements is keyed by `(map_url, source_system, source_code,
  target_system, target_code)` — sufficient to upsert/delete one element per mapping.
  Two mappings with the same source→target but different map_type would collide on
  the projection; the authoring `term_mappings` row stays the source of truth and
  the latest projection wins — acceptable, noted as a carry-forward.)
- **mappingCount** per term (for the table column) = count of `term_mappings` where
  `from_*` OR `to_*` matches.

## Backend

### Read store — `packages/db/src/terminology-store.ts` (extend)
Add `searchConcepts` + `countConceptsSearch` (above). No change to existing ops.

### Admin store — `packages/db/src/terminology-admin-store.ts` (extend)
Add two namespaces:

- `terms`:
  - `search(systemUrl, { query?, statuses?, limit, offset }): { rows: Term[]; total }`
    — Term = `{ system, code, display, status, shortName, class, unit, replacedBy,
    metadata, mappingCount }` (the structured fields read out of `properties`).
  - `create(input): Term` / `update(system, code, input): Term` /
    `delete(system, code): void` — writes `terminology_concepts`; maps
    `{shortName,class,unit,replacedBy,metadata}` ↔ `properties` jsonb
    (`JSON.stringify` for the jsonb column).
  - `importCsv(systemUrl, rows): { imported; updated; failed; errors }` — upsert
    concepts (delegates to the read store's `upsertConcepts` for the canonical write).
- `termMappings`:
  - `listOutgoing(system, code): TermMapping[]`, `listReverse(system, code): TermMapping[]`.
  - `create(input): { mapping; draftCreated }`, `update(id, input): TermMapping`,
    `delete(id): void` — writes `term_mappings`, projects into
    `concept_map_elements`, and (create) auto-creates the DRAFT target concept.
  - All within a Kysely transaction so the term_mappings row + the
    concept_map_elements projection + any draft-concept insert commit together.

`TerminologyAdminError` kinds reused (`not-found` | `conflict`); add new
`InternalSchema` type for `term_mappings`.

### HTTP — `apps/server/src/terminology-admin-routes.ts` (extend)
- `GET    /api/terminology/systems/:id/terms?q=&status=&limit=&offset=` → `{ rows, total }`
- `POST   /api/terminology/systems/:id/terms`
- `PUT    /api/terminology/systems/:id/terms/:code`
- `DELETE /api/terminology/systems/:id/terms/:code`
- `POST   /api/terminology/systems/:id/terms/import` (CSV body or JSON rows)
- `GET    /api/terminology/systems/:id/terms/template.csv`
- `GET    /api/terminology/terms/:system/:code/mappings` → `{ outgoing, reverse }`
- `POST   /api/terminology/terms/:system/:code/mappings`
- `PUT    /api/terminology/mappings/:id`
- `DELETE /api/terminology/mappings/:id`

(`:id` resolves a coding system; the store joins to its `url` for the concept key.
`:system`/`:code` in the mapping routes are URL-encoded.) zod-validated bodies;
error map + `redact()` as SP1; duck-type `TerminologyAdminError` guard.

### CSV — `@openldr/terminology` (new tiny `terms-csv.ts`)
Parse `code,display,shortName,class,unit,status` via `csv-parse`; build
`ConceptRecord[]` (extra cols → `properties`). Template = the header row.

### Bootstrap / CLI
`ctx.terminology.admin` already exposed (SP1) — the new namespaces ride on it. CLI:
add `terminology term list <systemUrl> [--q <s>] [--json]` only (lean).

## Frontend (apps/web)

### New primitive
- `components/ui/tooltip.tsx` (Radix Tooltip) — the mappings table uses it. Add
  `@radix-ui/react-tooltip` if absent.

### api client — `apps/web/src/api.ts` (extend)
Types `Term`, `TermInput`, `TermMapping`, `TermMappingInput`, `MapType`,
`TermStatus`; client fns: `searchTerms(systemId, {q,status,limit,offset})`,
`createTerm/updateTerm/deleteTerm`, `importTerms`, `termsTemplateUrl`,
`listTermMappings(system,code)`, `createTermMapping/updateTermMapping/deleteTermMapping`.

### Terms table — replaces the placeholder in `pages/Terminology.tsx` drilled pane
Toolbar: debounced search `Input` (200ms) + status filter `Select` (All + the 4) +
Import `Button` (hidden file input → POST import) + Download-template `Button` (anchor
to template.csv). `Table`: Code (mono/primary) / Name (+ short-name 2nd line) / Class
(`Badge` secondary or —) / Unit (mono/muted) / Status (`Badge`, color-coded:
ACTIVE=emerald, DRAFT=amber, DEPRECATED=orange, DISABLED=gray — the corlix classes) /
Mappings (right-aligned count or —) / row-`⋯` (View / Delete). Row click → TermDialog.
`TablePagination` server-side (page→offset). Search/filter/page refetch via
`searchTerms`. (Extract `terminology/TermsTable.tsx` to keep `Terminology.tsx`
focused.)

### `terminology/TermDialog.tsx` (port)
`Sheet side=right sm:max-w-xl`. Header (title + the system code). Underline-style
**tab buttons** (Details / Mappings — Mappings disabled unless editing, with a count
`Badge`). A `⋯` actions menu pinned to the tab row whose items switch with the tab
(Details: Save/Cancel/Delete-if-editing; Mappings: Add mapping/Cancel). Details body =
General section (code/display/shortName/class/unit) + Lifecycle (status `Select`;
`replacedBy` Input **disabled unless status===DEPRECATED**) + Metadata (JSON
`<textarea>` with parse-validation on save → error if not an object). Mappings body =
merged outgoing+reverse table (direction/type/system/code+display/`⋯`; reverse rows
read-only, no `⋯`); count summary; "draft created" notice (dismissable). Delete via a
ported simple `ConfirmDialog` (non-danger; or reuse a small confirm) — NOT the
type-to-confirm DangerConfirmDialog (corlix uses a plain confirm for term/mapping
delete).

### `terminology/TermMappingDialog.tsx` (port)
`Sheet sm:max-w-lg`. General (map-type `Select`; relationship/owner Inputs) + Target
(toggle **search**↔**manual**) + Status (is-active `Checkbox`). Search mode =
`TermPicker`. Manual mode = system `Select` (active systems) + code Input + display
Input + a **disabled** "Browse {system}" button (SP4 ontology — disabled with a
tooltip "available once an ontology index exists"). Save builds `TermMappingInput`
`{ fromSystem, fromCode, toSystem, toCode, toDisplay, mapType, relationship, owner,
isActive }` (search mode fills to* from the picked term; manual from the fields) →
create/update → on `draftCreated`, surface the notice to the parent.

### `terminology/TermPicker.tsx` (new)
A typeahead: an Input that, on debounced change, calls `searchTerms` across systems
(or a dedicated cross-system search) and shows a dropdown of `{systemCode} code —
display`; selecting sets the value `{ system, code, display, systemCode }`.
`statuses` prop filters (mapping picker uses `['ACTIVE','DRAFT']`).

### Status badge helper
`terminology/statusBadge.ts` — map the 4 statuses to the corlix color classes (shared
by the terms table + any status display).

## Deliberate divergences from corlix (with reasons)
1. **Terms referenced by `(system_url, code)`, not a synthetic term id** — fits CE's
   composite-key concept model + `concept_map_elements`; the corlix `toTermId`-vs-
   manual mapping split collapses into one stored `(to_system,to_code,to_display)`.
2. **Mapping "Browse ontology" target-picker disabled** until SP4 (needs the index).
3. **`concept_map_elements` projection is latest-wins** on a same-source→target pair
   with differing map_type (the `term_mappings` row is the source of truth).
4. **Lean CLI** (term list only); full term create/import CLI deferred.
5. IPC→HTTP.

## Testing & acceptance (TDD)
- **db store** (pg-mem): `searchConcepts` (text + status + paging + count); term CRUD
  with `properties` round-trip (shortName/class/unit/replacedBy/meta); `importCsv`
  upsert; `term_mappings` create→projects a `concept_map_elements` row + auto-creates
  a DRAFT target concept; listReverse; delete removes the projection; mappingCount.
- **routes** (`app.test.ts`): terms search/create/update/delete + import; mappings
  create (draftCreated) / list outgoing+reverse / delete; 404 + 409 + zod 400.
- **web** (vitest + Radix jsdom polyfills): TermsTable renders/paginates/searches;
  TermDialog Details save + tab enable-on-edit + replacedBy-gated-on-DEPRECATED +
  metadata JSON validation; TermMappingDialog search/manual toggle + draft notice;
  TermPicker typeahead selects.
- **e2e** (`terminology.spec.ts` extend): drill into a seeded system, import a tiny
  terms CSV, a term appears; open it, add a manual mapping to a new code → reverse
  shows on the target system's term (draft).
- **Live acceptance** (seeded Postgres): import a terms CSV into a code system; CRUD a
  term; create a mapping (manual → draft target created); confirm `$translate`
  returns the authored mapping; regenerate docs screenshots.
- **Gates**: turbo typecheck/lint/test/build + depcruise (no new adapter; store in
  packages/db, routes in apps/server, UI in apps/web — DP-1 intact).

## Open questions / decisions (resolved)
1. **Mappings scope** — FULL faithful (user-chosen): draft-target-term creation +
   display snapshots + search/manual target. The only deferral is the ontology
   target-picker (SP4).
2. **Term id** — none; terms referenced by `(system_url, code)` (decided above).
3. **Delete confirm** — terms/mappings use a plain `ConfirmDialog` (corlix does), not
   the type-to-confirm danger dialog.

## Carry-forwards (SP2)
- `concept_map_elements` projection is latest-wins per source→target (term_mappings is
  source of truth); revisit if multiple map-types per pair must all reach `$translate`.
- Full term create/import/mapping CLI.
- The mapping ontology target-picker (SP4).
- Move `TerminologyAdminError` → `@openldr/terminology` (carried from SP1).
- Draft target terms are created in the target system only if that system's `url` is
  known (a coding system exists for it); manual mapping to a system with no
  coding_system row stores the mapping but skips draft creation (noted to the user).
