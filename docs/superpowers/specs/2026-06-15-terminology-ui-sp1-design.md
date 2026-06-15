# Terminology Management UI — SP1: Foundation + Publishers & Code Systems

**Date:** 2026-06-15
**Status:** Design (approved data-model; spec under review)
**Requirement:** P2-TERM-5 (terminology management UI), first sub-project.

## Context

Corlix's Terminology page is a full authoring/curation tool over a rich desktop
(Electron + local SQLite) API. OpenLDR CE's terminology backend is a deliberately
read-mostly FHIR terminology *service*: 4 ops (`$lookup` / `$validate-code` /
`$expand` / `$translate`) over a **flat** `terminology_concepts(system, code,
display, status, properties)` index loaded via CLI (LOINC CSV / WHONET sqlite /
FHIR import), plus `terminology_systems(url→resource)` and `concept_map_elements`.

The user chose the **full authoring port** + a **real hierarchical ontology
browser**. That is effectively rebuilding corlix's terminology subsystem on CE, so
it is decomposed into four sequenced sub-projects (each its own spec → plan →
implementation → merge):

- **SP1 (this spec)** — data-model foundation + page shell + Publishers & Code
  Systems CRUD.
- **SP2** — Terms (browse + CRUD + status + import/template + Mappings tab).
- **SP3** — Value Sets (list + Value Set Builder: compose/expand/export/import/duplicate).
- **SP4** — Ontology (hierarchy loading + edge storage + indexer + distribution
  dialog + ontology browser).

Build order SP1 → SP2 → SP3 → SP4; everything hangs off Code Systems + the page
shell. Layout/styling stays pixel-faithful to corlix throughout; deliberate
divergences are backend-shaped and flagged per sub-project.

Corlix is a **read-only design reference** (PRD §10): reimplement, never copy.

## Goal (SP1)

Ship the corlix-faithful Terminology page **skeleton** and the first two entities:

- Publisher rail + main pane + breadcrumb + `⋯` action menu (corlix layout).
- Code-systems table (Code / Name / URL / actions) with pagination.
- New/Edit **Publisher** and **Code System** sheets (faithful ports).
- Delete with a type-to-confirm danger dialog showing deletion impact.
- A backend authoring layer (tables + store + HTTP + bootstrap + lean CLI) that
  projects into the existing read index without disturbing it.

Out of scope for SP1 (later sub-projects): terms browse/edit, term mappings, CSV
import/template, value sets + builder, ontology distributions + browser.

## Data model & reconciliation

**Approach: new normalized authoring tables that *project into* the existing flat
read index — not replace it.**

New internal migration `012_terminology_admin`:

- `publishers`
  - `id` uuid pk
  - `name` text not null
  - `role` text not null — `local` | `standard` | `external`
  - `icon` text null
  - `seeded` boolean not null default false
  - `sort_order` int not null default 0
- `coding_systems`
  - `id` uuid pk
  - `system_code` text not null (e.g. `LOINC`)
  - `system_name` text not null
  - `url` text null (canonical URL, e.g. `http://loinc.org`)
  - `system_version` text null
  - `description` text null
  - `active` boolean not null default true
  - `publisher_id` uuid null fk → publishers(id)
  - `seeded` boolean not null default false
  - unique index on `url` (where not null); unique on `(publisher_id, system_code)`.

`coding_systems.url` is the **join key** to the existing `terminology_concepts.system`
(a system's terms = concepts where `system = coding_systems.url`). This keeps the
4 read ops + ingest path keyed on system URL, byte-for-byte unchanged.

**Backfill (in the migration's `up`):**
1. Insert a seeded publisher `{ name: 'Standards', role: 'standard', seeded: true,
   sort_order: 0 }`.
2. Insert one `coding_systems` row per distinct value of
   `terminology_concepts.system` ∪ `terminology_systems.url`, with `seeded=true`,
   `publisher_id = Standards`, `url = <that url>`, `system_code` derived (last URL
   path segment upper-cased, or the url if no segment), `system_name = system_code`
   as a starting label (editable later). Idempotent (skip urls already present).

This makes the already-loaded LOINC (~109k) + WHONET systems appear in the UI
immediately under the Standards publisher.

**Loaders updated:** the LOINC / WHONET-AMR / FHIR-resource loaders
(`packages/bootstrap/src/terminology-context.ts`) upsert a `coding_systems` row
(+ Standards publisher binding) for each system they load, so future imports also
surface in the UI. `system_name`/`version` taken from the source where available.

**Why project-into over replace:** replacing `terminology_concepts` with
FK-to-`coding_systems` terms would force a rewrite of `$lookup`/`$expand`/`$translate`
and the ingest/reporting consumers — high risk, zero UI benefit. Project-into keeps
the read service + ingest stable while giving authoring a clean normalized home.

## Backend

### Store — `packages/db/src/terminology-admin-store.ts` (new)

Separate from the read-focused `terminology-store.ts`. `createTerminologyAdminStore(db: Kysely<InternalSchema>)`:

- `publishers.list(): Publisher[]` (ordered by sort_order, name)
- `publishers.create(input): Publisher`
- `publishers.update(id, input): Publisher`
- `publishers.delete(id): void` (throws if seeded)
- `publishers.deletionImpact(id): { systemCount, termCount }`
- `codingSystems.list(): CodingSystem[]`
- `codingSystems.create(input): CodingSystem`
- `codingSystems.update(id, input): CodingSystem` (system_code immutable on update)
- `codingSystems.delete(id): void` (throws if seeded)
- `codingSystems.deletionImpact(id): { termCount, mappingCount }`
  - `termCount = count(terminology_concepts where system = url)`
  - `mappingCount = count(concept_map_elements where source_system = url or target_system = url)`

All tables are scalar (no jsonb) → no `JSON.stringify` coercion trap. New
`InternalSchema` table types added to `packages/db`'s schema types. Errors use a
small `TerminologyAdminError { kind: 'not-found' | 'conflict' }` so routes can map
status codes.

### HTTP — `apps/server/src/terminology-admin-routes.ts` (new)

Mounted distinct from the FHIR-op paths (`/api/terminology/CodeSystem/$lookup` …):

- `GET    /api/terminology/publishers`
- `POST   /api/terminology/publishers`
- `PUT    /api/terminology/publishers/:id`
- `DELETE /api/terminology/publishers/:id`
- `GET    /api/terminology/publishers/:id/deletion-impact`
- `GET    /api/terminology/systems`
- `POST   /api/terminology/systems`
- `PUT    /api/terminology/systems/:id`
- `DELETE /api/terminology/systems/:id`
- `GET    /api/terminology/systems/:id/deletion-impact`

Request bodies validated with zod. Error map mirrors `terminology-routes.ts`:
404 (not-found), 409 (conflict — duplicate url/code, or delete of seeded), 400
(zod), 503 (conn), 500. Error messages passed through `redactError` (P2-HARD).

### Bootstrap

`createAppContext` opens the admin store on the shared internal db and exposes
`ctx.terminology.admin`. `createTerminologyContext` (CLI path) exposes it too.

### CLI — `packages/cli/src/terminology.ts` (extend)

Lean parity (full edit/delete CLI deferred):
- `terminology publisher list [--json]`
- `terminology publisher create --name <n> [--role local|external] [--icon <i>] [--json]`
- `terminology system list [--publisher <id>] [--json]`
- `terminology system create --code <C> --name <N> [--url <u>] [--version <v>] [--publisher <id>] [--json]`

## Frontend (apps/web)

### Wiring

- `App.tsx`: `<Route path="/terminology" element={<Terminology />} />`.
- `AppShell.tsx`: nav item `{ to: '/terminology', label: 'Terminology', icon: Library }`
  after Reports (Library = the rail's publisher icon).

### New shadcn primitives (missing in apps/web; shadcn-always rule)

- `components/ui/checkbox.tsx` (Radix Checkbox) — Code System "active".
- `components/ui/badge.tsx` — role badges (and status badges later).
- `components/ui/alert-dialog.tsx` (Radix AlertDialog) — backs the danger confirm.
- `components/ui/table-pagination.tsx` — `TablePagination` ({ page, pageSize, total,
  onPageChange, onPageSizeChange, leftSlot }).
- Verify `dropdown-menu.tsx` exports `Sub` / `SubTrigger` / `SubContent`; add if absent.

### Page — `pages/Terminology.tsx`

`AppShell title="Terminology" fullBleed`. Inner layout copies corlix
`TerminologyPage` (the JSX read at lines 528–786):

- **Publisher rail**: `w-60 shrink-0 border-r`, `h-9` uppercase header
  ("Publishers"), list of sections (publisher + role badge), active accent
  `bg-[rgba(70,130,180,0.12)] shadow-[inset_2px_0_0_#4682b4]`, hover
  `bg-[rgba(70,130,180,0.08)]`. Empty state "No publishers yet."
- **Main pane**: pick-publisher prompt when none selected; else breadcrumb
  (`Publisher › systemCode`), the `bothKinds` Code-systems/Value-sets tab toggle
  (present but Value-sets tab is inert until SP3), and the `⋯` `DropdownMenu`.
- **`⋯` menu (SP1 subset)**: Publisher sub (New / Edit / Delete-if-not-seeded) and
  Code system sub (New / Edit / Delete; **Browse** + **Manage** ontology items
  render *disabled* — enabled in SP4). Term + Value-set subs are added in SP2/SP3.
- **Code-systems table**: `Table` with Code (mono/primary) / Name / URL (mono/muted
  or "—") / row `⋯` (Edit / Browse[disabled] / Manage[disabled] / Delete). Row
  click → drills to a "Terms — coming in the next update" placeholder pane that
  establishes the breadcrumb + back nav (SP2 swaps the pane body). `TablePagination`
  with "{n} code systems" left slot.
- **Grouping**: a local `publisherSections(publishers, codingSystems, [])` helper
  (port of corlix's, value sets empty until SP3): keep a publisher when it has
  systems or is not seeded.
- Toast feedback strip (ok/error) at pane level, matching corlix classes.

### Sheets

- Faithful ports (Radix `Sheet`, already in apps/web):
  - `terminology/PublisherDialog.tsx` — fields Name / Role (local|external, disabled
    when seeded) / Icon; `Sheet side=right sm:max-w-md`, header+footer borders.
  - `terminology/CodingSystemDialog.tsx` — fields System code (mono, immutable on
    edit) / System name / URL+Version grid / Description (textarea) / Publisher
    (Select from list) / Active (Checkbox). Same sheet chrome.
- `terminology/DangerConfirmDialog.tsx` — type-the-name-to-confirm AlertDialog with
  an impact `summary` slot (system delete, publisher delete).

### API client — `apps/web/src/api.ts` (extend)

Typed `fetch` helpers for the 10 admin endpoints (`listPublishers`,
`createPublisher`, `updatePublisher`, `deletePublisher`, `publisherDeletionImpact`,
and the 5 system equivalents), following the existing `json()` helper pattern.

## Deliberate divergences from corlix (with reasons)

1. **IPC → HTTP** — `window.api.terminology.*` → `fetch('/api/terminology/…')`.
   Platform difference; unavoidable.
2. **Synthesized "Standards" publisher + backfill** — CE's pre-loaded LOINC/WHONET
   concepts have no publisher entity; we synthesize one so existing data is visible.
   Corlix authors everything in-app; CE pre-loads via CLI.
3. **Role `standard` is seed-only** — identical to corlix (create form offers only
   local/external); CE also tags the backfill publisher `standard`.
4. **Term / Value-set / Ontology menu items deferred** — present but disabled or
   absent until SP2–SP4, to avoid dead UI during sequenced delivery.
5. **Lean CLI** — list/create only in SP1; full edit/delete CLI is a carry-forward.

## Testing & acceptance (TDD)

- **db store** (pg-mem): publishers + coding_systems CRUD; deletion-impact counts;
  backfill projection (existing concepts → one coding_systems row under Standards);
  seeded rows reject delete.
- **routes** (`app.test.ts`): CRUD happy-path + 404 + 409 (duplicate, seeded-delete).
- **web** (vitest + existing Radix jsdom polyfills): rail renders sections; code-
  systems table renders + paginates; PublisherDialog + CodingSystemDialog save;
  DangerConfirmDialog requires the typed name.
- **e2e** (`e2e/tests/terminology.spec.ts`): nav to /terminology → Standards
  publisher in rail → drill shows backfilled systems → create a local publisher and
  a code system via the `⋯` sheets → both appear.
- **Live acceptance** (seeded Postgres): `db migrate` runs the backfill;
  /terminology shows LOINC + WHONET under Standards; create local publisher + code
  system; delete shows impact and removes; the 4 read ops + a WHONET ingest pass
  un-regressed; docs screenshots regenerated.
- **Gates**: turbo typecheck/lint/test/build + depcruise (DP-1 unaffected — no new
  adapter; routes live in apps/server, store in packages/db, UI in apps/web).

## Open questions / decisions

1. **SP1 row-click behavior** — corlix rows drill into the terms table. SP2 owns
   terms. Chosen: drill to a "Terms — coming in the next update" placeholder pane
   that establishes the breadcrumb/back navigation now, so SP2 only swaps the pane
   body. Flag for user confirmation.
2. **CLI scope** — chosen: list/create only; defer edit/delete CLI.

## Carry-forwards (SP1)

- Full edit/delete CLI for publishers/systems.
- `system_name` for backfilled systems starts as the code (no friendly label until
  edited or a richer loader supplies one).
- Term/Value-set/Ontology surfaces (SP2–SP4).
