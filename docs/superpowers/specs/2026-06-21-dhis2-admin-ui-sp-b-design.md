# DHIS2 Admin UI — SP-B: OrgUnit Mapping UI Design

**Date:** 2026-06-21
**Status:** Approved (brainstorming) — ready for implementation planning
**Depends on:** SP-A (`docs/superpowers/specs/2026-06-21-dhis2-admin-ui-sp-a-design.md` — DHIS2 routes module, `Dhis2Context` wired into `buildApp`, the `/dhis2` Settings page, the `pullDhis2Metadata` route, the `card` primitive, `dhis2.*` i18n).

## Background

SP-A exposed DHIS2 status + an on-demand metadata pull (counts only, nothing persisted) and a read-only Settings/Status page. SP-B adds the **facility → DHIS2 orgUnit mapping** UI — the second of four DHIS2 Admin UI sub-projects (SP-A done; SP-C mapping authoring; SP-D operations).

Relevant existing backend:
- `Dhis2Context.orgUnits` = `OrgUnitMapStore` (`packages/db/src/dhis2-store.ts`): `upsert(entries)`, `list(): {facilityId, orgUnitId, orgUnitName}[]`, `getMap()`. **No delete method yet.**
- `Dhis2Context.pullMetadata()` → `TargetMetadata` (`{ dataElements, orgUnits, categoryOptionCombos, programs?, programStages? }`, each `{id, name}`).
- `ctx.fhirStore` (`FhirStore`, `packages/db/src/fhir-store.ts`): `save`, `get(resourceType, id)`. **No list-by-type yet.**
- OpenLDR facilities are FHIR `Location` resources (the facility sample form targets `Location`).
- Audit: mutations are recorded via `recordAudit(ctx, req, …)` (SP2 convention).
- Web has `Popover` + `Input` primitives and searchable-picker patterns (`components/data-table/FilterPopover.tsx`, `ColumnPickerPopover.tsx`). No `cmdk`/combobox.

## Goal

A `/dhis2/orgunits` page (lab_admin) that lists OpenLDR facilities (FHIR Locations) with their current DHIS2 orgUnit mapping, and lets an admin set/change/clear each mapping by picking from the DHIS2 orgUnit catalog. The catalog comes from a **persisted metadata cache** so the picker does not re-pull DHIS2 on every page load.

## Decisions (locked during brainstorming)

1. **Facility source = FHIR `Location` resources** (canonical). Add a generic `FhirStore.listByType`.
2. **Metadata cache = single-row JSONB snapshot** of the whole `TargetMetadata` + `pulledAt`. SP-A's pull route persists it; the orgUnit picker reads orgUnits from it. (One pull, one row; serves SP-C's other metadata later without re-design.)
3. **One composed endpoint** `GET /api/dhis2/orgunit-mappings` (facilities ⨝ mappings + cached orgUnits), not a separate generic `/api/facilities`.
4. **Navigation:** reach the page via a "Manage →" link on the SP-A Settings page's Overview card. Single top-level "DHIS2" nav stays; sub-tabs can consolidate in a later sub-project.
5. **Picker = flat searchable combobox** built from existing `Popover`+`Input` (orgUnit metadata is only `{id, name}` — no hierarchy/tree).

## Architecture

### 1. Metadata cache (new)

- **Migration** (internal, next sequential number): `dhis2_metadata_cache` — `id text primary key` (always `'latest'`), `metadata jsonb not null`, `pulled_at timestamptz not null default now()`.
- **Store** `createDhis2MetadataCache(db)` in `packages/db/src/dhis2-metadata-cache.ts`:
  - `get(): Promise<{ metadata: TargetMetadata; pulledAt: string } | null>`
  - `save(metadata: TargetMetadata): Promise<void>` — upsert the single `'latest'` row, set `pulled_at = now()`.
- **Wiring:** exposed on `Dhis2Context` as `metadataCache` (built in `createDhis2Context`). `TargetMetadata` is imported from `@openldr/ports`.
- **Pull route change (SP-A):** `POST /api/dhis2/metadata/pull` now calls `metadataCache.save(md)` after a successful pull and adds `pulledAt` to its response. (Behaviour otherwise unchanged: still returns `counts`; still 409/502.)

### 2. Facility source

- Add `FhirStore.listByType(resourceType: string, limit?: number): Promise<{ id: string; resource: FhirResource }[]>` — selects from `fhir_resources` where `resource_type = ?`, newest first, default limit (e.g. 500). Returns parsed resources.
- A facility's display name = `Location.name` (string) when present, else its id.

### 3. OrgUnit map store

- Add `remove(facilityId: string): Promise<void>` to `OrgUnitMapStore` (delete the row). `upsert` already serves "set".

### 4. Routes (extend `apps/server/src/dhis2-routes.ts`, all `requireRole('lab_admin')`)

`GET /api/dhis2/orgunit-mappings`
```jsonc
{
  "facilities": [{ "facilityId": string, "facilityName": string, "orgUnitId": string|null, "orgUnitName": string|null }],
  "orgUnits": [{ "id": string, "name": string }],   // from the cache; [] if never pulled
  "metadataPulledAt": string|null                    // cache pulled_at; null if never pulled
}
```
- Composes `fhirStore.listByType('Location')` (left side) with `orgUnits.list()` (the mapping, keyed by facilityId) and `metadataCache.get()` (the catalog).
- Returns `200` always; when DHIS2 is unconfigured the facilities still list (they are local), `orgUnits` is `[]`, `metadataPulledAt` is `null`.

`PUT /api/dhis2/orgunit-mappings/:facilityId` — body `{ orgUnitId: string, orgUnitName: string | null }`
- Validates body (zod). Upserts via `orgUnits.upsert([{ facilityId, orgUnitId, orgUnitName }])`.
- Audit: `recordAudit(ctx, req, { action: 'dhis2.orgunit.map', entityType: 'dhis2-orgunit-map', entityId: facilityId, before: <prior mapping or null>, after: <new mapping>, metadata: { orgUnitId } })`.
- Returns the updated mapping row.

`DELETE /api/dhis2/orgunit-mappings/:facilityId`
- `orgUnits.remove(facilityId)`.
- Audit: `dhis2.orgunit.unmap`, `entityType: 'dhis2-orgunit-map'`, `entityId: facilityId`, `before: <prior mapping or null>`, `after: null`.
- Returns `204`.

These routes do not require DHIS2 to be configured/reachable (they operate on local facilities + cached metadata). `dhis2` may be `null`; facility listing + mapping CRUD + cache reads still work.

> **Wiring (concrete):** `AppContext` exposes `ctx.internalDb: Kysely<InternalSchema>` and `ctx.fhirStore`. So `registerDhis2Routes` constructs the two DB-only stores it needs directly from `ctx.internalDb` — `createOrgUnitMapStore(ctx.internalDb)` and `createDhis2MetadataCache(ctx.internalDb)` — and reads facilities via `ctx.fhirStore.listByType('Location')`. None of these depend on the DHIS2 target, so the orgunit-mapping routes work with `dhis2 === null`. The `POST /api/dhis2/metadata/pull` route is the only one that needs `dhis2` (for `pullMetadata()`); it writes the result through the same `createDhis2MetadataCache(ctx.internalDb)` instance. (The SP-A status route keeps using `dhis2.orgUnits.list()` for its count when `dhis2` is non-null — unchanged.) The cache store is still ALSO exposed on `Dhis2Context.metadataCache` for CLI/parity, constructed from the same internal db.

### 5. Web

- **Route:** `/dhis2/orgunits` in `App.tsx`, wrapped `RequireRole('lab_admin')`.
- **Entry point:** the SP-A Settings Overview card's "OrgUnit mappings: N" becomes a link ("Manage →") to `/dhis2/orgunits`.
- **Page `apps/web/src/pages/Dhis2OrgUnits.tsx`** (shadcn `Table`, `Button`, `Badge`, `AppShell`, i18n):
  - Header shows `metadataPulledAt` (or "never pulled") with a hint to pull from Settings if the catalog is empty.
  - A row per facility: facility name + id, current orgUnit (name + id) or an "unmapped" badge, and actions.
  - **OrgUnit combobox** `apps/web/src/components/ui/combobox.tsx` (new, built from `Popover`+`Input`+filtered list, mirroring `FilterPopover`): type-ahead over `orgUnits` by name; selecting calls `setOrgUnitMapping`; a "Clear" affordance calls `clearOrgUnitMapping`. Disabled with a tooltip when the catalog is empty.
  - Inline toast for success/error; optimistic refresh via re-fetch after each change.
- **`api.ts`:** `getOrgUnitMappings()`, `setOrgUnitMapping(facilityId, { orgUnitId, orgUnitName })`, `clearOrgUnitMapping(facilityId)` + the `Dhis2OrgUnitMappings` type.
- **i18n:** `dhis2.orgunits.*` keys.
- **Selectors:** `data-testid`s on the table, combobox trigger, and clear action.

## Data Flow

1. Admin pulls metadata on the Settings page → snapshot cached (`pulled_at` set).
2. Admin opens `/dhis2/orgunits` → `getOrgUnitMappings()` returns facilities + cached orgUnit catalog + current mappings.
3. Admin picks an orgUnit for a facility → `PUT` upserts the mapping (audited) → page re-fetches.
4. Admin clears a mapping → `DELETE` removes it (audited) → page re-fetches.

## Error Handling

- **Catalog empty (never pulled):** `orgUnits: []`, `metadataPulledAt: null`; combobox disabled with an explanatory empty state linking to Settings. Facilities still list.
- **Unknown facility on PUT/DELETE:** the store upsert/delete is keyed by facilityId; an id with no Location still writes (the mapping is keyed by id, not FK) — acceptable; the UI only offers real facilities.
- **No role:** `403` from `requireRole`; the web route additionally redirects via `RequireRole`.
- **Validation:** PUT body validated with zod → `400` on failure.

## Testing

- **Server — `apps/server/src/dhis2-routes.test.ts`** (extend; inject fakes for `fhirStore.listByType`, `orgUnits` store incl. new `remove`, and `metadataCache`):
  - `GET orgunit-mappings`: composes facilities + mappings + cached orgUnits; cache-empty → `orgUnits: []`, `metadataPulledAt: null`; facilities still listed when DHIS2 unconfigured.
  - `PUT`: upserts + records `dhis2.orgunit.map` audit; `400` on bad body.
  - `DELETE`: removes + records `dhis2.orgunit.unmap` audit; `204`.
  - `403` without `lab_admin` on each.
- **DB — `packages/db/src/dhis2-metadata-cache.test.ts`** (pg-mem or the existing store-test pattern): `save` then `get` round-trips the snapshot; `save` twice keeps one row (upsert) and updates `pulled_at`.
- **DB — `FhirStore.listByType`**: add a test (existing fhir-store test file) — saves two types, `listByType` returns only the requested type.
- **OrgUnitMapStore.remove**: add a test (existing dhis2-store test) — upsert then remove drops the row.
- **Web — `apps/web/src/pages/Dhis2OrgUnits.test.tsx`:** renders facilities + current mappings; cache-empty disables the picker with the empty state; setting via the combobox calls `setOrgUnitMapping`; clearing calls `clearOrgUnitMapping`.
- **Gate:** `pnpm turbo typecheck lint test build` + `pnpm depcruise` green.

## Out of Scope (later sub-projects)

- Aggregate/tracker mapping authoring + validation (SP-C).
- Dry-run preview, manual push, push history, schedule management (SP-D).
- OrgUnit hierarchy/tree picker (metadata is only `{id, name}`).
- Editable connection config; bulk import UI (CLI `dhis2 orgunit import` already exists).
- Live acceptance against a real DHIS2 instance (tests use injected fakes).
