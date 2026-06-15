# Terminology Management UI — SP4: Ontology Browser (full corlix parity) — Design

**Date:** 2026-06-15
**Status:** Approved (brainstorm) — pending implementation plan
**Module:** apps/web Terminology page + @openldr/terminology + @openldr/db + apps/server + @openldr/cli
**Predecessors:** SP1 (Publishers + Code Systems, `b434a9b`), SP2 (Terms + Mappings, `b71ad4b`), SP3 (Value Sets, merge `22df8ec`)
**Design source of truth:** corlix (`D:\Projects\Repositories\corlix`) — reimplement-not-copy.

## Problem

CE can author publishers, code systems, terms, mappings, and value sets, but it
has **no hierarchical ontology browser**. Two affordances are stubbed out:
- The Terminology page's `⋯` kebab has **disabled** "Browse ontology" / "Ontology
  distribution…" items (both on the breadcrumb menu and each code-system row).
- The mapping editor (`apps/web/src/terminology/TermMappingDialog.tsx`) has a
  **disabled** "Browse ontology" target-picker button (hint: *"Available once an
  ontology index exists (a later update)"*).

corlix ships a full ontology subsystem: a per-coding-system index (nodes + edges +
full-text search + manifest, plus LOINC panel/answer/specimen extras), an
`ontology_distributions` registry, three source adapters (**LOINC** multiaxial
hierarchy, **SNOMED CT** IS-A graph, **RxNorm** ATC tree + relationship groups), a
build lifecycle with live progress + staleness detection + a stale-index notifier,
and a lazy-loading tree **OntologyBrowser** with search, a detail pane, and a picker
mode. SP4 reimplements **all of it** over CE's stack (Postgres + HTTP + browser),
and wires the two disabled affordances.

## Decisions (locked during brainstorm)

1. **Scope: full parity.** All three adapters (LOINC/SNOMED/RxNorm), panel/answer/
   specimen extraction, RxNorm group sections + breadcrumb + FHIR-coding copy, live
   build progress, and staleness detection — in one SP4.
2. **Build trigger: server-side path + CLI, dialog manages lifecycle.** CE has no
   Electron folder picker. A build runs **server-side** over an already-extracted
   distribution directory:
   - CLI: `terminology ontology build <systemId> <dir>` registers + builds.
   - The `OntologyDistributionDialog` shows status / node+edge counts and offers a
     **server-side path text input + Build**, plus **Rebuild** (from the recorded
     path) and **Unlink**. *Stated divergence:* a path text field replaces corlix's
     native folder picker (a browser cannot pick a server directory).
   - Build **streams progress over SSE** so long SNOMED/RxNorm builds report live,
     matching corlix's IPC `onBuildProgress` UX.

## Architecture overview

```
  apps/web ─ Terminology.tsx (enable kebab Browse/Manage) · TermMappingDialog (enable Browse)
            OntologyBrowser.tsx · OntologyPickerDialog.tsx · OntologyDistributionDialog.tsx
                    │ api.ts: REST reads + EventSource(build)
  apps/server ─ ontology-routes.ts:  GET list/get/roots/children/node/search/path/panels/answers/specimens
                                     GET  build|rebuild (SSE)   DELETE unlink   (all via ctx, DP-1)
                    │ ctx.terminology.ontology
  @openldr/terminology ─ ontology/build.ts  buildOntologyDistribution(systemId, dir, store, onProgress)
                         ontology/adapters/{loinc,snomed,rxnorm,index}.ts  (ported; write via IndexWriter)
                         ontology/staleness.ts  isStale/stalenessReason (fs.stat vs manifest)
                    │ OntologyStore
  @openldr/db ─ ontology-store.ts:  distributions CRUD · clearIndex · bulkInsert{Nodes,Edges,Panels,Answers,Specimens}
                                    browse: roots/children/node/search(LIKE)/path · panelMembers/answerOptions/specimenCodes
                migration 015_ontology:  ontology_distributions · ontology_nodes · ontology_edges
                                         ontology_panel_members · ontology_answer_options · ontology_specimen_map
```

**Key reimplementation:** corlix's adapters write directly into a per-system
**SQLite sidecar** (`insertNode(db, …)`). CE has no sidecar; adapters instead write
through an injected **`IndexWriter`** (same method names), and a buffered
Postgres-backed writer flushes rows in chunks. The corlix adapter *logic* is ported
verbatim; only the write target changes. corlix's FTS5 search becomes a Postgres
`lower(display) LIKE` search (pg-mem-compatible, consistent with the rest of CE) —
*stated divergence*.

## Section 1 — Data model (migration `015_ontology`)

All tables keyed by **`coding_system_id`** = `coding_systems.id` (from SP1), so an
ontology index belongs to a CE code system. (corlix keys its sidecar by the same id;
nodes/edges live in the sidecar — here they're Postgres tables scoped by the id.)

```sql
CREATE TABLE ontology_distributions (
  coding_system_id text PRIMARY KEY,           -- -> coding_systems.id (no FK, matches existing tables)
  ontology_type    text NOT NULL,              -- loinc | snomed | rxnorm
  source_path      text NOT NULL,              -- server-side distribution dir
  index_status     text NOT NULL DEFAULT 'none', -- none | building | ready | error
  index_error      text,
  node_count       integer,
  edge_count       integer,
  manifest         jsonb,                       -- { schemaVersion, ontologyType, sourcePath, fileStats:[{path,size,mtimeMs}] }
  built_at         timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ontology_nodes (
  coding_system_id text NOT NULL,
  code             text NOT NULL,
  display          text NOT NULL,
  kind             text,
  extra            jsonb,
  PRIMARY KEY (coding_system_id, code)
);
CREATE INDEX ontology_nodes_search ON ontology_nodes (coding_system_id, lower(display));

CREATE TABLE ontology_edges (
  coding_system_id text NOT NULL,
  parent_code      text NOT NULL,
  child_code       text NOT NULL,
  seq              integer NOT NULL DEFAULT 0,
  label            text                          -- RxNorm relationship group; null for plain edges
);
CREATE INDEX ontology_edges_parent ON ontology_edges (coding_system_id, parent_code);
CREATE INDEX ontology_edges_child  ON ontology_edges (coding_system_id, child_code);

CREATE TABLE ontology_panel_members (
  coding_system_id text NOT NULL, panel_loinc text NOT NULL, member_loinc text NOT NULL,
  member_name text NOT NULL, display_name text NOT NULL, sequence integer NOT NULL DEFAULT 0,
  required boolean NOT NULL DEFAULT false
);
CREATE INDEX ontology_panel_members_panel ON ontology_panel_members (coding_system_id, panel_loinc);

CREATE TABLE ontology_answer_options (
  coding_system_id text NOT NULL, loinc text NOT NULL, seq integer NOT NULL DEFAULT 0,
  value text NOT NULL, label text NOT NULL
);
CREATE INDEX ontology_answer_options_loinc ON ontology_answer_options (coding_system_id, loinc);

CREATE TABLE ontology_specimen_map (
  coding_system_id text NOT NULL, loinc text NOT NULL, snomed_code text NOT NULL, equivalence text NOT NULL
);
CREATE INDEX ontology_specimen_map_loinc ON ontology_specimen_map (coding_system_id, loinc);
```

- `ROOT_CODE = '__ROOT__'` is the synthetic top-level parent (same as corlix). Roots
  = `ontology_edges WHERE parent_code = '__ROOT__'`.
- `INDEX_SCHEMA_VERSION` constant (start at `1`) stored in `manifest.schemaVersion`;
  bumping it marks all indexes stale (schema reason).
- No FK on `coding_system_id` (consistent with existing terminology tables); the
  store deletes index rows explicitly on `clearIndex`/`unlink`.
- `child_count` for a node is computed per-query (correlated count over edges), as
  corlix does in `NODE_SELECT`.

### Schema types (`packages/db/src/schema/internal.ts`)
Add `OntologyDistributionsTable`, `OntologyNodesTable`, `OntologyEdgesTable`,
`OntologyPanelMembersTable`, `OntologyAnswerOptionsTable`, `OntologySpecimenMapTable`,
registered on `InternalSchema`.

## Section 2 — Adapters + build (`@openldr/terminology`)

Ported from `corlix/apps/desktop/src/main/ontology/`. Filesystem + parsing live here
(alongside the existing loaders); DB writes go through an injected store.

### `ontology/types.ts`
Port `corlix .../ontology/types.ts` + the shared ontology types
(`corlix/packages/shared-types/src/ontology.ts`): `OntologyType` (`loinc|snomed|rxnorm`),
`OntologyIndexStatus`, `OntologyNode` (code/display/kind/extra/childCount/group),
`OntologyBreadcrumb`, `OntologyDistribution`, `OntologyBuildProgress`, `PanelMember`,
`AnswerOption`, `SpecimenCode`, `DetectedDistribution`, `FileStat`, `ROOT_CODE`.

Define the write seam:
```ts
export interface IndexWriter {
  insertNode(n: { code: string; display: string; kind: string | null; extra: Record<string, unknown> | null }): void;
  insertEdge(parent: string, child: string, seq: number, label?: string | null): void;
  insertPanelMember(m: PanelMember): void;
  insertAnswerOption(a: { loinc: string; seq: number; value: string; label: string }): void;
  insertSpecimenMap(m: { loinc: string; snomedCode: string; equivalence: string }): void;
}
export interface OntologyAdapter {
  type: OntologyType;
  detect(folderPath: string): DetectedDistribution | null;
  buildIndex(dist: DetectedDistribution, writer: IndexWriter, onProgress: (p: Omit<OntologyBuildProgress, 'codingSystemId'>) => void): void | Promise<void>;
}
```

### `ontology/adapters/{loinc,snomed,rxnorm}.ts` + `index.ts`
**Port the three corlix adapters verbatim**, applying only these mechanical transforms:
- `insertNode(db, x)` → `writer.insertNode(x)`; likewise `insertEdge`/`insertPanelMember`/
  `insertAnswerOption`/`insertSpecimenMap` → `writer.*`.
- Drop the `db.transaction(() => …)()` wrapper — the writer buffers and the build
  orchestrator flushes transactionally. The body inside the transaction runs directly.
- Keep all parsing, column indexing, ATC/relationship logic, `ROOT_CODE` edges,
  dedup, and progress calls **exactly** as corlix has them.
- `detect()` is unchanged (pure `fs.existsSync`/`statSync` over the dir).
`adapters/index.ts`: `export const adapters = [loincAdapter, snomedAdapter, rxnormAdapter]`
+ `detectAdapter(folderPath)`.

### `ontology/build.ts`
```ts
export interface OntologyIndexStore {
  beginBuild(systemId: string, ontologyType: string, sourcePath: string): Promise<void>;       // status=building
  clearIndex(systemId: string): Promise<void>;
  bulkInsertNodes(systemId: string, rows: NodeRow[]): Promise<void>;
  bulkInsertEdges(systemId: string, rows: EdgeRow[]): Promise<void>;
  bulkInsertPanelMembers(systemId: string, rows: PanelMember[]): Promise<void>;
  bulkInsertAnswerOptions(systemId: string, rows: AnswerRow[]): Promise<void>;
  bulkInsertSpecimens(systemId: string, rows: SpecimenRow[]): Promise<void>;
  finishBuild(systemId: string, opts: { ontologyType: string; sourcePath: string; nodeCount: number; edgeCount: number; manifest: unknown }): Promise<void>; // status=ready
  failBuild(systemId: string, ontologyType: string, sourcePath: string, error: string): Promise<void>;
}

export async function buildOntologyDistribution(
  systemId: string, sourcePath: string, store: OntologyIndexStore,
  onProgress: (p: OntologyBuildProgress) => void,
): Promise<void>;
```
- `detectAdapter(sourcePath)` → throw if none ("No LOINC / SNOMED CT / RxNorm
  distribution found in that folder.").
- `beginBuild` (status=building) → `clearIndex` → run the adapter with a **buffered
  writer** that flushes to `store.bulkInsert*` every N rows (e.g. 5000) to bound
  memory → on success `finishBuild` with counts + manifest (`{ schemaVersion:
  INDEX_SCHEMA_VERSION, ontologyType, sourcePath, fileStats: dist.fileStats }`); on
  error `failBuild`. Re-throw so the caller surfaces it.
- `onProgress` adds `codingSystemId` to each `{phase, processed, total}`.

### `ontology/staleness.ts`
Port corlix `distributions.stalenessReason`/`isStale`: given a distribution's stored
`manifest`, return `'schema' | 'files' | null` by comparing `manifest.schemaVersion`
to `INDEX_SCHEMA_VERSION` and re-`statSync`-ing each `manifest.fileStats[].path`
(size + mtimeMs ±1). Pure fs over the manifest (no DB) — the store passes the manifest in.

## Section 3 — Ontology store (`packages/db/src/ontology-store.ts`)

`createOntologyStore(db: Kysely<InternalSchema>)` returns:
- **Distributions:** `list()`, `get(systemId)`, `beginBuild`, `finishBuild`,
  `failBuild`, `unlink(systemId)` (deletes the distribution row + all index rows),
  `clearIndex(systemId)`.
- **Bulk index writes:** `bulkInsertNodes/Edges/PanelMembers/AnswerOptions/Specimens`
  (chunked inserts; jsonb via `JSON.stringify`).
- **Browse queries** (ported from corlix `indexDb.ts`, scoped by `coding_system_id`):
  - `roots(systemId)` = `children(systemId, '__ROOT__')`.
  - `children(systemId, parentCode)` — join nodes↔edges where `parent_code = ?`,
    select `e.label AS group` + correlated child_count, order by `e.seq, n.display`.
  - `node(systemId, code)` — node + child_count.
  - `search(systemId, query, limit=50)` — `lower(display) LIKE '%'||lower(q)||'%'`
    (and/or code prefix), order by display, limit. *(FTS5 → LIKE divergence.)*
  - `path(systemId, code)` — first-parent breadcrumb up to ROOT (cycle-guarded),
    returns `OntologyBreadcrumb[]`.
  - `panelMembers(systemId, panelLoinc)`, `answerOptions(systemId, loinc)`,
    `specimenCodes(systemId, loinc)`.
- All `*Row → OntologyNode` mappers parse `extra` jsonb and compute `group`.

pg-mem note: parse jsonb via `JSON.stringify` on insert; `lower() LIKE` not `ILIKE`.

## Section 4 — Bootstrap wiring

`ctx.terminology.ontology` (built in `index.ts` + `terminology-context.ts` from
`createOntologyStore(db)` + the build/staleness modules):
```ts
ontology: {
  listDistributions(): Promise<OntologyDistribution[]>;
  getDistribution(systemId): Promise<(OntologyDistribution & { stale: boolean }) | null>;  // staleness via manifest
  build(systemId, sourcePath, onProgress): Promise<void>;   // buildOntologyDistribution
  rebuild(systemId, onProgress): Promise<void>;             // build from recorded source_path
  unlink(systemId): Promise<void>;
  roots(systemId); children(systemId, parent); node(systemId, code);
  search(systemId, q); path(systemId, code);
  panelMembers(systemId, panel); answerOptions(systemId, loinc); specimenCodes(systemId, loinc);
}
```
The store implements `OntologyIndexStore` for `build()` to consume.

## Section 5 — REST + SSE (`apps/server/src/ontology-routes.ts`)

New route module, registered alongside the terminology-admin routes. DP-1: all via
`ctx.terminology.ontology`; reuse the `redact()` boundary.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/terminology/ontology/distributions` | list |
| GET | `/api/terminology/ontology/distributions/:id` | get (+ `stale`) |
| DELETE | `/api/terminology/ontology/distributions/:id` | unlink |
| GET | `/api/terminology/ontology/:id/roots` | tree roots |
| GET | `/api/terminology/ontology/:id/children?parent=CODE` | children |
| GET | `/api/terminology/ontology/:id/node?code=CODE` | node detail |
| GET | `/api/terminology/ontology/:id/search?q=…` | search (limit 50) |
| GET | `/api/terminology/ontology/:id/path?code=CODE` | breadcrumb |
| GET | `/api/terminology/ontology/:id/panels?loinc=…` | panel members |
| GET | `/api/terminology/ontology/:id/answers?loinc=…` | answer options |
| GET | `/api/terminology/ontology/:id/specimens?loinc=…` | specimen codes |
| GET | `/api/terminology/ontology/:id/build?path=DIR` | **SSE** build (path required) |
| GET | `/api/terminology/ontology/:id/rebuild` | **SSE** rebuild (recorded path) |

**SSE build/rebuild:** set `content-type: text/event-stream`; for each progress event
write `data: {"phase","processed","total"}\n\n`; on completion write a final
`event: done\ndata: {distribution}\n\n` (or `event: error\ndata: {message}\n\n`) and
end the stream. Use `reply.raw` (Fastify raw response) so we can stream; `reply.hijack()`.
`path` is a **server-side absolute path** (the operator's responsibility); `redact()`
any error text. Build is GET (EventSource only does GET).

## Section 6 — CLI (`packages/cli/src/terminology.ts` + `index.ts`)

- `terminology ontology build <systemId> <dir>` → `ctx.terminology.ontology.build`,
  printing progress lines (`phase: processed/total`) and the final node/edge counts.
- `terminology ontology rebuild <systemId>`.
- `terminology ontology list` → distributions (systemId · type · status · nodes · edges).
- `terminology ontology unlink <systemId>`.

## Section 7 — Web API client (`apps/web/src/api.ts`)

Types: `OntologyNode`, `OntologyBreadcrumb`, `OntologyDistribution` (+ `stale`),
`OntologyBuildProgress`, `OntologyType`, `PanelMember`, `AnswerOption`, `SpecimenCode`.
Fns: `listOntologyDistributions()`, `getOntologyDistribution(id)`,
`unlinkOntologyDistribution(id)`, `ontologyRoots(id)`, `ontologyChildren(id, parent)`,
`ontologyNode(id, code)`, `ontologySearch(id, q)`, `ontologyPath(id, code)`,
`ontologyPanelMembers/AnswerOptions/SpecimenCodes(id, loinc)`, and a build helper:
```ts
buildOntology(id, opts: { path?: string; rebuild?: boolean },
  onProgress: (p: OntologyBuildProgress) => void): { promise: Promise<OntologyDistribution>; cancel: () => void };
```
implemented with `EventSource` on `…/build?path=` or `…/rebuild`, resolving on the
`done` event, rejecting on `error`, exposing `cancel()` = `es.close()`.

## Section 8 — Web UI (faithful corlix port)

### `OntologyBrowser.tsx` (`apps/web/src/terminology/ontology/`)
Port corlix `OntologyBrowser.tsx`. `window.api.ontology.*` → the api.ts fns; `t(…)`
→ English literals. Preserve: lazy tree (roots → expand → cached children), RxNorm
**group sections** (collapsible labeled buckets keyed by `${parentCode}::${label}`),
FTS-style search (flat results; debounced 300ms), click-result → walk `path` → expand
ancestors → highlight + select, detail pane (display/code/kind/childCount/extra `dl`),
RxNorm **breadcrumb** + **FHIR-coding copy** panel + US-catalog caveat, copy
code/copy code+display, and `mode="picker"` with a "Use as target" button →
`onPick({code, display})`.

### `OntologyPickerDialog.tsx` (`apps/web/src/terminology/ontology/`)
Port corlix's — a wide right-side `Sheet` (`sm:max-w-[920px]`, full-height) wrapping
`<OntologyBrowser mode="picker" …>`; closes itself on pick.

### `OntologyDistributionDialog.tsx` (`apps/web/src/terminology/ontology/`)
Port corlix's, with the build-mechanism adaptation: a `Dialog` showing status banners
(stale/error), ready metadata (type/nodes/edges/builtAt), and actions. Replace corlix's
native folder-picker "Link folder" with a **server-side path text input + Build**;
keep **Rebuild** (recorded path) and **Unlink** (with `DangerConfirmDialog`/confirm).
Show **live build progress** by passing an `onProgress` callback to `buildOntology(...)`
(updates a `phase: processed/total` line). Disable actions while building.

### `Terminology.tsx` wiring
- **Enable** the kebab's "Browse ontology" and "Ontology distribution…" items (both
  breadcrumb and code-system-row menus). "Browse" is enabled only when that system's
  distribution `indexStatus === 'ready'`; "Manage" (distribution dialog) is always
  enabled. Load distributions in `reload()` into a `Record<systemId, distribution>`
  map (like corlix's `distributions`), so the row/menu can check readiness.
- Mount the `OntologyPickerDialog` (browse mode, `mode="browse"`) and the
  `OntologyDistributionDialog`, driven by `browseSystem` / `distDialogSystem` state.
- After a build/unlink (`onChanged`), refresh the distributions map.

### `TermMappingDialog.tsx` wiring
Replace the disabled "Browse ontology" button + hint with a real button that opens an
`OntologyPickerDialog` (picker mode) for the **target system** (resolve the target
system's `coding_systems.id` from its url); `onPick` fills the mapping's target
code + display. Enable only when the target system has a `ready` distribution; keep a
tooltip hint when not.

## Section 9 — Staleness notifier (best-effort)

Port corlix `staleNotify.ts` as a periodic scan (every 15 min) that flags ready
distributions whose source files/schema changed. **Wire to CE's existing notification/
outbox mechanism if one exists; otherwise log a warning** and rely on the dialog's
stale banner (which is always shown via `getDistribution(...).stale`). The implementer
verifies what CE has (search for a notifications/outbox publisher) and chooses the
lightest faithful integration; the stale **banner** is the must-have, the background
**notification** is best-effort.

## Section 10 — Testing

- **Adapters** (`@openldr/terminology`): port corlix's `loinc.test.ts` /
  `snomed.test.ts` / `rxnorm.test.ts` **and their `__fixtures__`** verbatim, adapting
  the test harness to assert against a tiny in-memory `IndexWriter` (collect rows in
  arrays) instead of a SQLite db — assert the same node/edge/panel/answer/specimen
  outcomes.
- **build.ts**: a fake `OntologyIndexStore` (in-memory) + the LOINC fixture →
  `buildOntologyDistribution` populates nodes/edges, status ready, counts correct;
  a no-adapter folder → `failBuild` + throws.
- **ontology-store** (pg-mem): bulk insert nodes/edges → roots/children/node/search/
  path return expected; panel/answer/specimen round-trips; unlink clears all rows;
  build lifecycle status transitions.
- **staleness.ts**: manifest schemaVersion mismatch → 'schema'; changed file
  size/mtime → 'files'; unchanged → null (use a temp file).
- **REST**: list/get/browse happy paths; SSE build emits progress then `done` with the
  distribution (drive with a tiny fixture dir); not-found mapping.
- **e2e**: with a LOINC fixture available to the server, build an index for the LOINC
  system via the dialog (or seed it), open "Browse ontology", expand a root, search a
  term, select it (detail shows); then in a mapping, open "Browse ontology" and pick a
  target. If SSE/build is impractical in e2e, seed a tiny index in a migration-time or
  test-only fixture and assert the browser renders + picker returns a code.
- **Live-PG acceptance**: `terminology ontology build <loincSystemId> <loincDir>` on
  real Postgres → `ontology list` shows ready + counts → browse via REST → mapping
  picker. `pnpm docs:screenshots` regenerated.
- **Gates**: `pnpm turbo typecheck lint test build` + `pnpm depcruise` green; no
  `@openldr/db` ↔ `@openldr/terminology` cycle (adapters/build live in terminology and
  take an injected store; types they share with db must not create a cycle — mirror the
  SP3 resolution).

## Section 11 — Non-goals (deferred)

- Bundled ontology content (LOINC/SNOMED/RxNorm distributions are operator-provided;
  CE ships none — licensing).
- Editing the hierarchy in the UI (browse + pick only; the index is import-derived).
- Form-builder answer-list / specimen wiring (corlix uses panels/answers/specimens in
  its Form Builder; CE has none — the data is stored + queryable but only surfaced in
  the browser detail/RxNorm panels for now).
- Real-time file watching (staleness is a periodic scan + on-open check).

## Affected code (orientation)

- `packages/db/src/migrations/internal/015_ontology.ts` (+ test) + `index.ts` register.
- `packages/db/src/schema/internal.ts` — six ontology tables.
- `packages/db/src/ontology-store.ts` (+ test) — store + browse queries.
- `packages/terminology/src/ontology/types.ts` — types + IndexWriter + adapter iface.
- `packages/terminology/src/ontology/adapters/{loinc,snomed,rxnorm,index}.ts` (+ tests + `__fixtures__`).
- `packages/terminology/src/ontology/build.ts` (+ test).
- `packages/terminology/src/ontology/staleness.ts` (+ test).
- `packages/terminology/src/index.ts` — export ontology surface.
- `packages/bootstrap/src/index.ts` + `terminology-context.ts` — wire `ctx.terminology.ontology`.
- `apps/server/src/ontology-routes.ts` (+ register in the server bootstrap) — REST + SSE.
- `packages/cli/src/terminology.ts` + `index.ts` — `ontology build/rebuild/list/unlink`.
- `apps/web/src/api.ts` — ontology client + EventSource build helper.
- `apps/web/src/terminology/ontology/{OntologyBrowser,OntologyPickerDialog,OntologyDistributionDialog}.tsx` (new).
- `apps/web/src/pages/Terminology.tsx` — enable kebab items, mount browser + distribution dialog, load distributions map.
- `apps/web/src/terminology/TermMappingDialog.tsx` — enable "Browse ontology" target picker.
- `e2e/tests/terminology.spec.ts` — ontology browse + pick flow.
```
