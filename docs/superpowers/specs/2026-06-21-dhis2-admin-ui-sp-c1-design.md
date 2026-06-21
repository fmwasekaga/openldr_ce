# DHIS2 Admin UI — SP-C1: Aggregate Mapping Authoring UI Design

**Date:** 2026-06-21
**Status:** Approved (brainstorming) — ready for implementation planning
**Depends on:** SP-A (DHIS2 routes module, Settings page, `Dhis2Context` wiring), SP-B (`ctx.internalDb`/`ctx.fhirStore` on `AppContext`, the `Dhis2RouteDeps` pattern, the metadata cache, the `Combobox` primitive, `dhis2.*` i18n).

## Background

SP-A (status + metadata pull) and SP-B (orgUnit mapping + metadata cache) are done. SP-C is the **mapping authoring** UI — the third of four DHIS2 Admin UI sub-projects. It is decomposed:

- **SP-C1 (this spec)** — mappings list + CRUD/validate routes + the **aggregate** mapping editor.
- **SP-C2** — the **tracker** mapping editor (reuses the same list/CRUD/validate).

Relevant existing backend:
- `packages/dhis2/src/types.ts`:
  - `AggregateMapping = { kind?: 'aggregate'; id; name; source: { kind:'report'; reportId; params? }; orgUnitColumn; periodColumn?; columns: ColumnMapping[] }`
  - `ColumnMapping = { column; dataElement; categoryOptionCombo? }`
  - `TrackerMapping = { kind:'tracker'; … }` (SP-C2)
- `validateMapping(mapping: AggregateMapping, metadata: TargetMetadata): string[]` (`packages/dhis2/src/validate.ts`) — pure; checks each column's `dataElement` and optional `categoryOptionCombo` exist in metadata.
- `MappingStore` (`packages/db/src/dhis2-store.ts`): `upsert(m: Dhis2MappingRecord)`, `get(id)`, `list(): {id,name}[]`. **No delete; list lacks `kind`.** `Dhis2MappingRecord = { id; name; definition: Record<string, unknown> }` — the definition is the AggregateMapping/TrackerMapping JSON.
- `ctx.reporting` (`ReportingApi`): `list(): ReportSummary[]` (backs `GET /api/reports`) and `run(reportId, params): Promise<ReportResult>` where `ReportResult.columns: { key; label; kind }[]`.
- SP-B's metadata cache (`ctx`-constructible `createDhis2MetadataCache(ctx.internalDb)`) holds `TargetMetadata` (`dataElements`/`categoryOptionCombos`/`orgUnits`/`programs`/`programStages`, each `{id,name}`).
- SP-B's `Combobox` primitive (`apps/web/src/components/ui/combobox.tsx`).

## Goal

List DHIS2 mappings and author/edit aggregate mappings end-to-end: choose a source report, discover its columns by running it, map the orgUnit/period columns and a set of report-column → dataElement(+optional COC) pairs (DHIS2 ids picked from the cached metadata), validate the draft against the cache, and save.

## Decisions (locked during brainstorming)

1. **Aggregate only** this cycle. Tracker mappings list with a `tracker` badge but are read-only here (editing one shows a "tracker editing comes in SP-C2" notice; "New mapping" creates aggregate). SP-C2 adds the tracker editor.
2. **Report columns discovered by running the report** — a `report-columns` endpoint runs `ctx.reporting.run(reportId, {})` and returns its column list. Reliable because reports define columns independent of row data.
3. **`source.params` deferred** (YAGNI) — the editor authors mappings without source params for the MVP. The push period drives the DHIS2 period; reports run full-range. Params can be added later or via the CLI.
4. **Validation against the cached metadata** (SP-B), not a live DHIS2 pull — consistent with the pickers; works with `dhis2 === null`.
5. **Role gate:** `requireRole('lab_admin')` on all routes; `/dhis2/mappings*` web routes guarded `RequireRole('lab_admin')`.

## Architecture

### 1. Backend

**MappingStore changes** (`packages/db/src/dhis2-store.ts`):
- Add `remove(id: string): Promise<void>`.
- Extend `list()` to return `{ id; name; kind: string | null }` — select `definition->>'kind'` as `kind` (Postgres jsonb text extraction). Additive: existing callers (CLI `dhis2 map list`) ignore the new field.

**Route deps** (`apps/server/src/dhis2-routes.ts`): extend `Dhis2RouteDeps` with `mappingStore: MappingStore` (built in `buildApp` from `ctx.internalDb` via `createMappingStore`, alongside the existing `metadataCache`/`orgUnitStore`).

**Routes** (all `requireRole('lab_admin')`):
- `GET /api/dhis2/mappings` → `deps.mappingStore.list()` → `[{ id, name, kind }]`.
- `GET /api/dhis2/mappings/:id` → `deps.mappingStore.get(id)`; `404` if missing; returns `{ id, name, definition }`.
- `PUT /api/dhis2/mappings/:id` — body `{ name: string, definition: <aggregate mapping> }`, zod-validated to the aggregate shape (see below). `deps.mappingStore.upsert({ id, name, definition })`. Audit `dhis2.mapping.save` (`entityType: 'dhis2-mapping'`, `entityId: id`, before = prior record or null, after = saved). Returns the saved record.
- `DELETE /api/dhis2/mappings/:id` → `deps.mappingStore.remove(id)`. Audit `dhis2.mapping.delete` (before = prior or null, after null). `204`.
- `POST /api/dhis2/mappings/validate` — body = a draft aggregate definition (zod-validated). Reads `deps.metadataCache.get()`. If no cache → `{ problems: ['no DHIS2 metadata cached — pull metadata from DHIS2 settings first'] }`. Else `{ problems: validateMapping(def, cached.metadata) }`. `200` always (no save, no audit).
- `GET /api/dhis2/report-columns?reportId=X` → `ctx.reporting.run(X, {})` → `{ columns: result.columns.map(c => ({ key: c.key, label: c.label })) }`. `400` if `reportId` missing; `404` if the report id is unknown (catch the "unknown report" error from `ctx.reporting.run`); `502 redact(...)` on other run errors.
- `GET /api/dhis2/metadata` → `deps.metadataCache.get()` → `{ dataElements, categoryOptionCombos, orgUnits, programs, programStages, pulledAt } | null` (flattens the cached `TargetMetadata` + `pulledAt`; `null` when never pulled). The editor uses this for the dataElement/COC comboboxes. Single cheap cache read; reused by SP-C2.

**zod aggregate schema** (in `dhis2-routes.ts`):
```
const aggregateColumn = z.object({ column: z.string().min(1), dataElement: z.string().min(1), categoryOptionCombo: z.string().optional() });
const aggregateDefinition = z.object({
  kind: z.literal('aggregate').optional(),
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.object({ kind: z.literal('report'), reportId: z.string().min(1), params: z.record(z.string()).optional() }),
  orgUnitColumn: z.string().min(1),
  periodColumn: z.string().optional(),
  columns: z.array(aggregateColumn),
});
```
PUT body = `z.object({ name: z.string().min(1), definition: aggregateDefinition })`. Validate body = `aggregateDefinition`.

### 2. Web

- **List page** `apps/web/src/pages/Dhis2Mappings.tsx` at `/dhis2/mappings` (guarded `lab_admin`), reached via a "Manage →" `Link` on the Settings Overview card's "Mappings: N" line (mirrors SP-B's orgUnits link). Table: name, `kind` badge (`aggregate`/`tracker`), row actions edit + delete (delete behind a confirm dialog). "New mapping" button → `/dhis2/mappings/new`.
- **Editor page** `apps/web/src/pages/Dhis2MappingEditor.tsx` at `/dhis2/mappings/new` and `/dhis2/mappings/:id` (guarded `lab_admin`):
  - Loads `getDhis2Mapping(id)` when editing; if the loaded mapping's `kind === 'tracker'`, render a read-only notice ("Tracker mapping editing comes in SP-C2") instead of the form.
  - **Form (aggregate):** `name`; **source report** `Select`/`Combobox` from `listReports()`; on report change → `getReportColumns(reportId)` populates the column dropdowns. **orgUnitColumn** (Combobox of discovered columns) + optional **periodColumn**. **Columns table**: each row = report-column dropdown (discovered columns) + dataElement `Combobox` (cached `dataElements`) + optional COC `Combobox` (cached `categoryOptionCombos`); add-row / remove-row.
  - **Validate** button → `validateDhis2Mapping(draft)` → render the `problems` list (empty → "No problems").
  - **Save** → `saveDhis2Mapping(id, { name, definition })` (id generated client-side for new: `mapping-<crypto.randomUUID()>`), then navigate back to the list. Cancel → back.
  - Catalog-empty handling: if cached `dataElements` is empty, the dataElement/COC comboboxes are disabled with a hint to pull metadata first (the editor can still fetch the cache via a small `getDhis2MappingMeta()` — see below).
- **Metadata for pickers:** the editor reads the cached `dataElements`/`categoryOptionCombos` via the new `GET /api/dhis2/metadata` route (above) for the dataElement/COC comboboxes.
- **`api.ts`:** `listDhis2Mappings()`, `getDhis2Mapping(id)`, `saveDhis2Mapping(id, body)`, `deleteDhis2Mapping(id)`, `validateDhis2Mapping(def)`, `getReportColumns(reportId)`, `getDhis2Metadata()` + types. `listReports()` already exists (`fetchReports`).
- **i18n:** `dhis2.mappings.*`.
- **Selectors:** `data-testid`s on the list rows, "New mapping", the report select, add-column, validate, and save controls.

## Data Flow

1. Admin opens `/dhis2/mappings` → `listDhis2Mappings()`.
2. New/edit → editor loads reports list + cached metadata (`getDhis2Metadata`) + (edit) the mapping.
3. Select report → `getReportColumns` populates column dropdowns.
4. Build column→dataElement rows; Validate → `validateDhis2Mapping` shows problems.
5. Save → `saveDhis2Mapping` (audited) → back to list.

## Error Handling

- **Unknown report** on report-columns → `404`; editor shows "report not found, pick another".
- **Report run failure** → `502 redact(...)`; editor surfaces a message; column dropdowns stay empty.
- **Empty metadata cache** → validate returns the "pull metadata first" problem; dataElement/COC comboboxes disabled with a hint.
- **GET mapping 404** → editor shows "mapping not found".
- **Invalid PUT/validate body** → `400` (zod message).
- **No role** → `403`; web route redirects via `RequireRole`.
- Routes never depend on a live DHIS2 target (mappings + cache + reporting are all local); `dhis2` may be `null`.

## Testing

- **DB — `packages/db/src/dhis2-store.test.ts`** (extend): `MappingStore.remove` drops the row; `list()` returns `kind` from the definition.
- **Server — `apps/server/src/dhis2-routes.test.ts`** (extend; fakes for `mappingStore`, `metadataCache`, and `ctx.reporting`):
  - mappings list/get(+404)/put(+audit, +400 bad body)/delete(+audit, 204).
  - validate: with cache → problems from `validateMapping`; empty cache → "pull metadata first".
  - report-columns: success → columns; 400 missing id; 404 unknown report; 502 run error.
  - metadata read: returns cache or null.
  - `403` for non-admins on each.
- **Web:**
  - `Dhis2Mappings.test.tsx`: lists mappings with kind badges; delete behind confirm calls `deleteDhis2Mapping`; "New mapping" navigates.
  - `Dhis2MappingEditor.test.tsx`: select report → columns load → add a column row, pick dataElement → Validate shows problems → Save calls `saveDhis2Mapping` with the composed aggregate definition; editing a tracker mapping shows the read-only notice.
- **Gate:** `pnpm turbo typecheck lint test build` + `pnpm depcruise`.

## Out of Scope (later)

- Tracker mapping editor (SP-C2).
- Dry-run preview, manual push, push history, schedules (SP-D).
- Editable `source.params`.
- Live acceptance against a real DHIS2 instance (tests use injected fakes).
- Mapping duplication/versioning.
