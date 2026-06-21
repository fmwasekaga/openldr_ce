# DHIS2 Admin UI — SP-C2: Tracker Mapping Editor Design

**Date:** 2026-06-21
**Status:** Approved (brainstorming) — ready for implementation planning
**Depends on:** SP-C1 (`docs/superpowers/specs/2026-06-21-dhis2-admin-ui-sp-c1-design.md` — the mappings list page, mappings CRUD routes, the `Dhis2MappingEditor`, the `validate`/`report-columns`/`metadata` routes, the `Dhis2RouteDeps.mappingStore`, and the `@openldr/dhis2` server dep), SP-B (the metadata cache), SP-A.

## Background

SP-C1 shipped aggregate mapping authoring. SP-C2 adds the **tracker** editor, completing SP-C of the DHIS2 Admin UI (SP-D — operations/push/schedule — remains).

Tracker model (`packages/dhis2/src/types.ts`):
```
TrackerMapping = {
  kind: 'tracker'; id; name;
  source: { kind: 'event-source'; sourceId; params? };
  program; programStage;
  orgUnitColumn; eventDateColumn; idColumn;
  dataValues: { column; dataElement }[];
}
```
- `validateTrackerMapping(m: TrackerMapping, metadata: TargetMetadata): string[]` (`packages/dhis2/src/tracker.ts`, exported from `@openldr/dhis2`) — checks `program`/`programStage` exist in `metadata.programs`/`programStages` and each `dataValues[].dataElement` exists in `metadata.dataElements`.
- Event sources: `eventSourceCatalog(): EventSource[]` / `getEventSource(id)` (`packages/reporting/src/eventsource.ts`). Currently one source: `amr-isolates`. `EventSource = { id; name; run(db, window, params?): Promise<{ rows }> }` — **no declared columns** (unlike `ReportDefinition`, whose `run()` returns `ReportResultData.columns`). `amr-isolates` `run()` produces rows keyed `id`/`facility`/`eventDate`/`antibiotic`/`result`.
- `TargetMetadata.programStages` entries are `{ id; name; program }` — so program stages can be filtered by the selected program.
- SP-C1's `Dhis2MappingEditor` currently renders a read-only "tracker editing comes in SP-C2" notice for tracker mappings; the `validate`/PUT routes accept the aggregate shape only.

## Goal

Make tracker mappings first-class: an event-source-driven editor with program/programStage/column/dataElement pickers and inline validation, reusing the SP-C1 list/CRUD/validate infrastructure.

## Decisions (locked during brainstorming)

1. **Declare columns on `EventSource`** — add a static `columns: { key; label }[]` to the type and populate `amr-isolates`. The editor reads them from a new `GET /api/dhis2/event-sources` route. (Event sources return rows-only at runtime, so static declaration is required for dropdown UX.)
2. **Kind-discriminated union** for validate/PUT bodies — accept aggregate OR tracker, dispatch validation by `kind`.
3. **Kind selector in the editor for new mappings** — Aggregate / Tracker. Editing keys off the loaded mapping's `kind`; tracker mappings now open the tracker form (the read-only notice is removed).
4. **`source.params` deferred** (consistent with SP-C1).
5. **program → programStage filtering** via `programStage.program`.
6. **Native `<select>` pattern**, consistent with the SP-C1 editor.
7. Role gate `lab_admin` everywhere (unchanged).

## Architecture

### 1. Backend

**EventSource columns** (`packages/reporting/src/eventsource-types.ts`):
```ts
export interface EventSource {
  id: string;
  name: string;
  columns: { key: string; label: string }[];   // NEW — static output schema
  run(db: Kysely<ExternalSchema>, window: EventWindow, params?: Record<string, string>): Promise<{ rows: Record<string, unknown>[] }>;
}
```
Populate `amr-isolates` (`packages/reporting/src/reports/amr-isolates.ts`):
```ts
columns: [
  { key: 'id', label: 'Isolate ID' },
  { key: 'facility', label: 'Facility' },
  { key: 'eventDate', label: 'Event date' },
  { key: 'antibiotic', label: 'Antibiotic' },
  { key: 'result', label: 'Result (S/I/R)' },
],
```
(Any other existing event sources must also gain a `columns` array — `amr-isolates` is the only one today.)

**`ReportingApi.eventSources()`** (`packages/bootstrap/src/index.ts`): add to the `ReportingApi` interface and implementation:
```ts
eventSources(): { id: string; name: string; columns: { key: string; label: string }[] }[];
```
implemented as `eventSourceCatalog().map((s) => ({ id: s.id, name: s.name, columns: s.columns }))`.

**Route** (`apps/server/src/dhis2-routes.ts`, `requireRole('lab_admin')`):
- `GET /api/dhis2/event-sources` → `ctx.reporting.eventSources()` → `[{ id, name, columns: [{key,label}] }]`.

**Tracker validation + persistence** (`apps/server/src/dhis2-routes.ts`):
- Add a `trackerDefinition` zod schema:
  ```ts
  const trackerColumn = z.object({ column: z.string().min(1), dataElement: z.string().min(1) });
  const trackerDefinition = z.object({
    kind: z.literal('tracker'),
    id: z.string().min(1),
    name: z.string().min(1),
    source: z.object({ kind: z.literal('event-source'), sourceId: z.string().min(1), params: z.record(z.string()).optional() }),
    program: z.string().min(1),
    programStage: z.string().min(1),
    orgUnitColumn: z.string().min(1),
    eventDateColumn: z.string().min(1),
    idColumn: z.string().min(1),
    dataValues: z.array(trackerColumn),
  });
  ```
- The mapping **definition** becomes `z.union([aggregateDefinition, trackerDefinition])` for both `PUT /api/dhis2/mappings/:id` (`mappingPutInput.definition`) and `POST /api/dhis2/mappings/validate` (the body).
  - Note: `aggregateDefinition.kind` is `z.literal('aggregate').optional()`. To make the union discriminate cleanly, tighten `aggregateDefinition.kind` to `z.literal('aggregate')` (required) is NOT desired (existing aggregate mappings may omit `kind`). Instead use a plain `z.union([...])` (zod tries each); validate dispatches on the parsed object's `kind`.
- The **validate route** dispatches:
  ```ts
  const def = p.data;
  const problems = (def as { kind?: string }).kind === 'tracker'
    ? validateTrackerMapping(def as TrackerMapping, cached.metadata)
    : validateMapping(def as AggregateMapping, cached.metadata);
  return { problems };
  ```
  (import `validateTrackerMapping` + `TrackerMapping` from `@openldr/dhis2`.)
- PUT stores the definition unchanged (the store is kind-agnostic); audit action stays `dhis2.mapping.save`.

### 2. Web

**API client** (`apps/web/src/api.ts`):
- `TrackerColumnMapping = { column; dataElement }`, `TrackerMappingDef = { kind:'tracker'; id; name; source:{kind:'event-source';sourceId;params?}; program; programStage; orgUnitColumn; eventDateColumn; idColumn; dataValues: TrackerColumnMapping[] }`.
- `getDhis2EventSources(): Promise<{ id; name; columns: {key,label}[] }[]>` → `GET /api/dhis2/event-sources`.
- Widen `saveDhis2Mapping` and `validateDhis2Mapping` to accept `AggregateMappingDef | TrackerMappingDef`.

**Editor** (`apps/web/src/pages/Dhis2MappingEditor.tsx`) — dual-mode. Concrete structure (the plan may split into sub-components; the behavior is fixed):
- On new (`/dhis2/mappings/new`): a **kind selector** (`aggregate` | `tracker`, default `aggregate`). On edit: kind is read from the loaded mapping; remove the read-only tracker notice.
- Shared shell: `name`, the kind-specific form, a Validate button (sends the composed definition; renders `problems`), Save (`saveDhis2Mapping(id, { name, definition })` → navigate to `/dhis2/mappings`), Cancel, the loading guard + 404/error handling from SP-C1.
- **Aggregate form:** unchanged from SP-C1 (source report → report-columns; orgUnit/period; column→dataElement table).
- **Tracker form:**
  - **Source event-source** dropdown from `getDhis2EventSources()`; selecting one provides its `columns` for the column dropdowns.
  - **Program** dropdown from cached `meta.programs`; **Program stage** dropdown from cached `meta.programStages` filtered to `stage.program === program` (id stored).
  - **orgUnitColumn / eventDateColumn / idColumn** dropdowns from the selected source's `columns`.
  - **dataValues table:** rows of (source-column dropdown → dataElement dropdown), add/remove; dataElement from cached `meta.dataElements`.
  - Composed `TrackerMappingDef` (filters empty `dataValues` rows; omits `params`).
- Metadata (`getDhis2Metadata`) and the cache-empty handling are shared with SP-C1.

**i18n** (`apps/web/src/i18n/index.ts`): add under `dhis2.mappings.editor`:
```
kindLabel, kindAggregate, kindTracker,
tracker: { sourceEventSource, pickEventSource, program, pickProgram, programStage, pickStage,
           orgUnitColumn, eventDateColumn, idColumn, pickColumn, dataValues, reportColumn, dataElement, addRow, remove }
```
(reuse existing `editor.save`/`cancel`/`validate`/`noProblems`/`mappingName` etc.)

### 3. Data Flow

1. New → choose kind. Tracker → pick event-source (loads its columns) + program (loads stages) + stage + columns + dataValues.
2. Validate → `validateDhis2Mapping(trackerDef)` → server dispatches `validateTrackerMapping` against the cache → problems.
3. Save → `saveDhis2Mapping` (audited) → list. Edit a tracker mapping → form seeded from its definition.

## Error Handling

- **Empty metadata cache:** program/stage/dataElement dropdowns disabled with the SP-C1 "pull metadata first" hint; validate returns the "pull metadata first" problem.
- **No event sources / unknown source:** the dropdown is empty; column dropdowns stay empty.
- **Invalid PUT/validate body:** `400` (zod union failure message).
- **No role:** `403`; `RequireRole` redirect on the web route.
- Routes never depend on a live DHIS2 target (`event-sources` + validate + CRUD are all local; `dhis2` may be `null`).

## Testing

- **Reporting — `packages/reporting`:** a test asserting `eventSourceCatalog()` entries (amr-isolates) expose `columns` with the expected keys.
- **Bootstrap — `packages/bootstrap`:** `ctx.reporting.eventSources()` returns `{id,name,columns}` (extend an existing bootstrap test or add a focused one).
- **Server — `apps/server/src/dhis2-routes.test.ts`** (extend; `fakeCtx.reporting` gains `eventSources`):
  - `GET /api/dhis2/event-sources` returns the sources + columns; `403` for non-admins.
  - validate dispatches tracker: a valid tracker def → `[]`; a tracker def with an unknown program → a problem; an aggregate def still validates via `validateMapping`.
  - PUT accepts a tracker definition (`200`, stored) and still accepts aggregate; bad tracker body → `400`.
- **Web:**
  - `Dhis2MappingEditor.test.tsx` (extend): new + kind=tracker → pick event-source/program/stage/columns/dataValue → Save calls `saveDhis2Mapping` with a well-formed `TrackerMappingDef`; editing a tracker mapping seeds the tracker form (no longer the read-only notice); program→stage filtering shows only stages of the selected program.
- **Gate:** `pnpm turbo typecheck lint test build` + `pnpm depcruise`.

## Out of Scope (later)

- SP-D — operations: dry-run preview, manual push, push history, schedule management.
- Editable `source.params`.
- Additional event sources (only `amr-isolates` exists today).
- Live acceptance against a real DHIS2 instance (tests use injected fakes).
