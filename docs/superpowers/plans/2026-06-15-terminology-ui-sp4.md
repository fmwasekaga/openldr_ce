# Terminology UI — SP4: Ontology Browser (full corlix parity) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reimplement corlix's full ontology subsystem in CE — a Postgres ontology index (`ontology_nodes`/`edges`/`distributions` + LOINC panels/answers/specimens), ported LOINC/SNOMED/RxNorm adapters, a server-side build lifecycle with SSE progress + staleness, a browse/picker/distribution UI, and wiring of the two currently-disabled "Browse ontology" affordances.

**Architecture:** Adapters + build + staleness live in `@openldr/terminology` (filesystem + parsing) and write through an injected `IndexWriter` / `OntologyIndexStore` (DP-1 preserved — `apps/server` never imports `@openldr/db`). `@openldr/db` holds the `ontology-store` (bulk writes + browse queries). `apps/server` exposes REST reads + an **SSE** build endpoint via `ctx`. `apps/web` ports corlix's `OntologyBrowser`/`OntologyPickerDialog`/`OntologyDistributionDialog` and wires the page kebab + the mapping dialog.

**Tech Stack:** pnpm/turbo TS monorepo, Kysely (Postgres), pg-mem (tests), Fastify (+ raw SSE), Vitest, React + Vite + Radix/shadcn, Playwright. Spec: `docs/superpowers/specs/2026-06-15-terminology-ui-sp4-design.md`.

**Conventions carried from SP1–SP3 (do not relitigate):**
- pg-mem: no `ILIKE` (use `` sql`lower(x)` `` `like`); jsonb inserted via `JSON.stringify(...)`; no correlated-subquery reliance — compute counts with a separate grouped query (as SP3 did for `codeCount`); `db.transaction()` + `` sql`now()` `` work.
- `apps/server` has **no** `@openldr/db` dep → all DB access via `ctx`; route errors via `redact()`.
- `@openldr/db` ↔ `@openldr/terminology`: `@openldr/terminology` already imports `@openldr/db` types. Keep ontology **types** in `@openldr/terminology` and have `@openldr/db`'s `ontology-store` import them from there ONLY IF acyclic; if `depcruise` reports a cycle, duplicate the small row/option types locally in `ontology-store.ts` (the SP3 precedent: web duplicates types rather than cross a boundary). Decide in T8, record in the commit.
- Always shadcn primitives in `apps/web`. Gates from repo root: `pnpm turbo typecheck lint test build` + `pnpm depcruise`.
- corlix is the design source of truth: where a task says "port verbatim," open the named corlix file and reproduce it applying ONLY the listed transforms. Do not redesign.

**Source-of-truth corlix paths (read before porting):**
- `apps/desktop/src/main/ontology/types.ts`, `apps/desktop/src/main/ontology/indexDb.ts` (schema + browse query SQL + row→node mappers), `apps/desktop/src/main/ontology/distributions.ts` (build lifecycle + staleness), `apps/desktop/src/main/ontology/staleNotify.ts`.
- `apps/desktop/src/main/ontology/adapters/{loinc,snomed,rxnorm,index}.ts` + their `*.test.ts` + `__fixtures__/`.
- `packages/shared-types/src/ontology.ts` (the public types).
- `apps/desktop/src/renderer/components/ontology/{OntologyBrowser,OntologyPickerDialog,OntologyDistributionDialog}.tsx`.

---

## File Structure

**Create**
- `packages/db/src/migrations/internal/015_ontology.ts` (+ `.test.ts`)
- `packages/db/src/ontology-store.ts` (+ `.test.ts`)
- `packages/terminology/src/ontology/types.ts`
- `packages/terminology/src/ontology/adapters/{loinc,snomed,rxnorm,index}.ts` (+ `loinc.test.ts`/`snomed.test.ts`/`rxnorm.test.ts` + `__fixtures__/`)
- `packages/terminology/src/ontology/build.ts` (+ `.test.ts`)
- `packages/terminology/src/ontology/staleness.ts` (+ `.test.ts`)
- `packages/terminology/src/ontology/index.ts`
- `apps/server/src/ontology-routes.ts`
- `apps/web/src/terminology/ontology/{OntologyBrowser,OntologyPickerDialog,OntologyDistributionDialog}.tsx`

**Modify**
- `packages/db/src/schema/internal.ts`, `…/migrations/internal/index.ts`, `packages/db/src/index.ts`
- `packages/terminology/src/index.ts`
- `packages/bootstrap/src/index.ts`, `…/terminology-context.ts`
- the server bootstrap that registers route modules (where `registerTerminologyAdminRoutes` is called)
- `packages/cli/src/terminology.ts`, `packages/cli/src/index.ts`
- `apps/web/src/api.ts`
- `apps/web/src/pages/Terminology.tsx`
- `apps/web/src/terminology/TermMappingDialog.tsx`
- `e2e/tests/terminology.spec.ts`

---

## Task 1: Migration 015 (six ontology tables) + schema types

**Files:** Create `packages/db/src/migrations/internal/015_ontology.ts` (+ `.test.ts`); modify `…/index.ts`, `schema/internal.ts`.

- [ ] **Step 1: Write the migration**

`packages/db/src/migrations/internal/015_ontology.ts`:

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('ontology_distributions').ifNotExists()
    .addColumn('coding_system_id', 'text', (c) => c.primaryKey())
    .addColumn('ontology_type', 'text', (c) => c.notNull())
    .addColumn('source_path', 'text', (c) => c.notNull())
    .addColumn('index_status', 'text', (c) => c.notNull().defaultTo('none'))
    .addColumn('index_error', 'text')
    .addColumn('node_count', 'integer')
    .addColumn('edge_count', 'integer')
    .addColumn('manifest', 'jsonb')
    .addColumn('built_at', 'timestamptz')
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createTable('ontology_nodes').ifNotExists()
    .addColumn('coding_system_id', 'text', (c) => c.notNull())
    .addColumn('code', 'text', (c) => c.notNull())
    .addColumn('display', 'text', (c) => c.notNull())
    .addColumn('kind', 'text')
    .addColumn('extra', 'jsonb')
    .addPrimaryKeyConstraint('ontology_nodes_pk', ['coding_system_id', 'code'])
    .execute();

  await db.schema.createTable('ontology_edges').ifNotExists()
    .addColumn('coding_system_id', 'text', (c) => c.notNull())
    .addColumn('parent_code', 'text', (c) => c.notNull())
    .addColumn('child_code', 'text', (c) => c.notNull())
    .addColumn('seq', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('label', 'text')
    .execute();
  await db.schema.createIndex('ontology_edges_parent').ifNotExists()
    .on('ontology_edges').columns(['coding_system_id', 'parent_code']).execute();
  await db.schema.createIndex('ontology_edges_child').ifNotExists()
    .on('ontology_edges').columns(['coding_system_id', 'child_code']).execute();

  await db.schema.createTable('ontology_panel_members').ifNotExists()
    .addColumn('coding_system_id', 'text', (c) => c.notNull())
    .addColumn('panel_loinc', 'text', (c) => c.notNull())
    .addColumn('member_loinc', 'text', (c) => c.notNull())
    .addColumn('member_name', 'text', (c) => c.notNull())
    .addColumn('display_name', 'text', (c) => c.notNull())
    .addColumn('sequence', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('required', 'boolean', (c) => c.notNull().defaultTo(false))
    .execute();
  await db.schema.createIndex('ontology_panel_members_panel').ifNotExists()
    .on('ontology_panel_members').columns(['coding_system_id', 'panel_loinc']).execute();

  await db.schema.createTable('ontology_answer_options').ifNotExists()
    .addColumn('coding_system_id', 'text', (c) => c.notNull())
    .addColumn('loinc', 'text', (c) => c.notNull())
    .addColumn('seq', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('value', 'text', (c) => c.notNull())
    .addColumn('label', 'text', (c) => c.notNull())
    .execute();
  await db.schema.createIndex('ontology_answer_options_loinc').ifNotExists()
    .on('ontology_answer_options').columns(['coding_system_id', 'loinc']).execute();

  await db.schema.createTable('ontology_specimen_map').ifNotExists()
    .addColumn('coding_system_id', 'text', (c) => c.notNull())
    .addColumn('loinc', 'text', (c) => c.notNull())
    .addColumn('snomed_code', 'text', (c) => c.notNull())
    .addColumn('equivalence', 'text', (c) => c.notNull())
    .execute();
  await db.schema.createIndex('ontology_specimen_map_loinc').ifNotExists()
    .on('ontology_specimen_map').columns(['coding_system_id', 'loinc']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['ontology_specimen_map', 'ontology_answer_options', 'ontology_panel_members', 'ontology_edges', 'ontology_nodes', 'ontology_distributions']) {
    await db.schema.dropTable(t).ifExists().execute();
  }
}
```

> The functional `lower(display)` index from the spec is omitted here because pg-mem
> can't create expression indexes; search still works without it. Comment that real PG
> can add `CREATE INDEX … ON ontology_nodes (coding_system_id, lower(display))` later.
> Don't let it break the migration test.

- [ ] **Step 2: Register** in `…/migrations/internal/index.ts`: `import * as m015 from './015_ontology';` and `'015_ontology': { up: m015.up, down: m015.down },`.

- [ ] **Step 3: Schema types** in `packages/db/src/schema/internal.ts` (+ register on `InternalSchema`):

```ts
export interface OntologyDistributionsTable {
  coding_system_id: string; ontology_type: string; source_path: string;
  index_status: string; index_error: string | null;
  node_count: number | null; edge_count: number | null;
  manifest: unknown | null; built_at: string | null; updated_at: string;
}
export interface OntologyNodesTable { coding_system_id: string; code: string; display: string; kind: string | null; extra: unknown | null }
export interface OntologyEdgesTable { coding_system_id: string; parent_code: string; child_code: string; seq: number; label: string | null }
export interface OntologyPanelMembersTable { coding_system_id: string; panel_loinc: string; member_loinc: string; member_name: string; display_name: string; sequence: number; required: boolean }
export interface OntologyAnswerOptionsTable { coding_system_id: string; loinc: string; seq: number; value: string; label: string }
export interface OntologySpecimenMapTable { coding_system_id: string; loinc: string; snomed_code: string; equivalence: string }
```
Register: `ontology_distributions: OntologyDistributionsTable; ontology_nodes: OntologyNodesTable; ontology_edges: OntologyEdgesTable; ontology_panel_members: OntologyPanelMembersTable; ontology_answer_options: OntologyAnswerOptionsTable; ontology_specimen_map: OntologySpecimenMapTable;`

- [ ] **Step 4: Test** `015_ontology.test.ts` (mirror SP3's `014` test): `makeMigratedDb()`, insert a node + an edge + a distribution row, read them back. Run `pnpm --filter @openldr/db test -- 015_ontology` → PASS.

- [ ] **Step 5: Commit** `feat(db): ontology tables (migration 015) (P2-TERM)`.

---

## Task 2: Ontology types + IndexWriter + adapter interface

**Files:** Create `packages/terminology/src/ontology/types.ts`.

- [ ] **Step 1:** Port `corlix/packages/shared-types/src/ontology.ts` (the public types) **and** `corlix/apps/desktop/src/main/ontology/types.ts` (DetectedDistribution/FileStat/OntologyAdapter/ROOT_CODE) into one CE file, replacing the SQLite `OntologyAdapter.buildIndex(db)` seam with the `IndexWriter` seam:

```ts
export type OntologyType = 'loinc' | 'snomed' | 'rxnorm';
export type OntologyIndexStatus = 'none' | 'building' | 'ready' | 'stale' | 'error';

export interface OntologyNode { code: string; display: string; kind: string; extra: Record<string, unknown> | null; childCount: number; group: string | null }
export interface OntologyBreadcrumb { code: string; display: string }
export interface OntologyDistribution {
  codingSystemId: string; ontologyType: OntologyType; sourcePath: string;
  indexStatus: OntologyIndexStatus; indexError: string | null;
  nodeCount: number | null; edgeCount: number | null; builtAt: string | null; updatedAt: string;
}
export interface OntologyBuildProgress { codingSystemId: string; phase: string; processed: number; total: number | null }
export interface PanelMember { panelLoinc: string; memberLoinc: string; memberName: string; displayName: string; sequence: number; required: boolean }
export interface SpecimenCode { snomedCode: string; equivalence: string }
export interface AnswerOption { value: string; label: string }

export interface FileStat { path: string; size: number; mtimeMs: number }
export interface DetectedDistribution { type: OntologyType; folderPath: string; files: Record<string, string>; fileStats: FileStat[] }

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

export const ROOT_CODE = '__ROOT__';
export const INDEX_SCHEMA_VERSION = 1;
```

- [ ] **Step 2:** Typecheck `pnpm --filter @openldr/terminology typecheck` → PASS. Commit `feat(terminology): ontology types + IndexWriter seam (P2-TERM)`.

---

## Task 3: LOINC adapter (port) + fixtures + tests

**Files:** Create `packages/terminology/src/ontology/adapters/loinc.ts`, `loinc.test.ts`, and `__fixtures__/loinc/...`.

- [ ] **Step 1: Copy the fixtures.** Copy `corlix/apps/desktop/src/main/ontology/adapters/__fixtures__/loinc/` (the whole tree: `AccessoryFiles/ComponentHierarchyBySystem/…`, `PanelsAndForms/…`, `AnswerFile/…`, `PartFile/…`) verbatim into `packages/terminology/src/ontology/adapters/__fixtures__/loinc/`. These are small synthetic CSVs (no licensed content).

- [ ] **Step 2: Port the adapter.** Reproduce `corlix .../adapters/loinc.ts` exactly, with these transforms:
  - imports: drop `import type Database from 'better-sqlite3'` and the `insertX` imports; instead `import { ROOT_CODE, type DetectedDistribution, type OntologyAdapter, type IndexWriter } from '../types';`.
  - signature: `buildIndex(dist, writer: IndexWriter, onProgress): void` (drop the `db` param).
  - body: replace every `insertNode(db, …)`/`insertEdge(db, …)`/`insertPanelMember(db, …)`/`insertAnswerOption(db, …)`/`insertSpecimenMap(db, …)` with `writer.insertNode(…)` etc.
  - remove the `db.transaction(() => { … })()` wrappers — run the loop bodies directly (the build orchestrator handles transactional flush). Everything else (CSV parsing, column lookup, `parseCsvLine`, the LP-vs-term `kind`, panels/answers/specimens parsing) is **verbatim**.

- [ ] **Step 3: Port the test.** Reproduce `corlix .../adapters/loinc.test.ts`, replacing the SQLite harness with an in-memory `IndexWriter` collector:

```ts
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { loincAdapter } from './loinc';
import { ROOT_CODE, type IndexWriter } from '../types';

const FIXTURE = join(__dirname, '__fixtures__', 'loinc');

function collector() {
  const nodes: any[] = [], edges: any[] = [], panels: any[] = [], answers: any[] = [], specimens: any[] = [];
  const writer: IndexWriter = {
    insertNode: (n) => nodes.push(n),
    insertEdge: (parent, child, seq, label = null) => edges.push({ parent, child, seq, label }),
    insertPanelMember: (m) => panels.push(m),
    insertAnswerOption: (a) => answers.push(a),
    insertSpecimenMap: (m) => specimens.push(m),
  };
  const childrenOf = (parent: string) => edges.filter((e) => e.parent === parent).sort((a, b) => a.seq - b.seq).map((e) => e.child);
  const node = (code: string) => nodes.find((n) => n.code === code) ?? null;
  return { writer, nodes, edges, panels, answers, specimens, childrenOf, node };
}

describe('loincAdapter', () => {
  it('detects a folder containing ComponentHierarchyBySystem.csv', () => {
    const d = loincAdapter.detect(FIXTURE);
    expect(d?.type).toBe('loinc');
    expect(d?.fileStats.length).toBe(6);
  });
  it('returns null for an unrelated folder', () => {
    expect(loincAdapter.detect(join(__dirname, '__fixtures__'))).toBeNull();
  });
  it('builds the multiaxial hierarchy under ROOT', () => {
    const d = loincAdapter.detect(FIXTURE)!; const c = collector();
    loincAdapter.buildIndex(d, c.writer, () => {});
    expect(c.childrenOf(ROOT_CODE)).toEqual(['LP432695-7']);
    expect(c.node('LP432695-7')?.kind).toBe('category');
    expect(c.childrenOf('LP432695-7')).toEqual(['LP29693-6']);
    expect(c.childrenOf('LP29693-6')).toEqual(['LP343406-7']);
    expect(c.childrenOf('LP343406-7')).toEqual(['2093-3', '2571-8']);
    expect(c.node('2093-3')?.kind).toBe('term');
    expect(c.node('2093-3')?.display).toBe('Cholesterol [Mass/Vol]');
  });
  it('parses panels (skipping the self-row), answers (ordered), and SNOMED specimen maps', () => {
    const d = loincAdapter.detect(FIXTURE)!; const c = collector();
    loincAdapter.buildIndex(d, c.writer, () => {});
    expect(c.panels.filter((m) => m.panelLoinc === '24331-1').map((m) => m.memberLoinc)).toEqual(['2093-3', '2571-8']);
    expect(c.answers.filter((a) => a.loinc === '32789-0').map((a) => a.value)).toEqual(['LA2', 'LA1']);
    expect(c.specimens.filter((s) => s.loinc === '6429-5').map((s) => s.snomedCode)).toEqual(['119297000', '122555007']);
  });
});
```
> Adjust the expected codes/values to whatever the copied fixtures actually contain (read the fixture CSVs). The assertions above mirror corlix's `loinc.test.ts`; keep them aligned to the fixtures you copied.

- [ ] **Step 4:** `pnpm --filter @openldr/terminology test -- adapters/loinc` → PASS. Commit `feat(terminology): LOINC ontology adapter (ported) (P2-TERM)`.

---

## Task 4: SNOMED adapter (port) + fixtures + tests

**Files:** Create `packages/terminology/src/ontology/adapters/snomed.ts`, `snomed.test.ts`, `__fixtures__/snomed/…`.

- [ ] **Step 1:** Copy `corlix .../__fixtures__/snomed/` verbatim (synthetic `Snapshot/Terminology/sct2_Description_…txt` + `sct2_Relationship_…txt`).
- [ ] **Step 2:** Port `corlix .../adapters/snomed.ts` with the same transforms as Task 3 (drop `Database` import + `insertX` imports → `IndexWriter`; `buildIndex(dist, writer, onProgress)`; replace `insertNode/insertEdge(db, …)` → `writer.*`; drop the `db.transaction` wrapper, run the loop body directly). All SNOMED logic (FSN/IS-A constants, `streamLines`, two-pass build, ROOT edge for `138875005`) **verbatim**. It's already `async`.
- [ ] **Step 3:** Port `snomed.test.ts` using the `collector()` from Task 3 (extract `collector` into a shared `__fixtures__/collector.ts` or repeat it) — assert the same concept/edge outcomes corlix asserts.
- [ ] **Step 4:** `pnpm --filter @openldr/terminology test -- adapters/snomed` → PASS. Commit `feat(terminology): SNOMED CT ontology adapter (ported) (P2-TERM)`.

---

## Task 5: RxNorm adapter (port) + fixtures + tests

**Files:** Create `packages/terminology/src/ontology/adapters/rxnorm.ts`, `rxnorm.test.ts`, `__fixtures__/rxnorm/…`.

- [ ] **Step 1:** Copy `corlix .../__fixtures__/rxnorm/` verbatim (`rrf/RXNCONSO.RRF`, `rrf/RXNREL.RRF` synthetic).
- [ ] **Step 2:** Port `corlix .../adapters/rxnorm.ts` with the same transforms (→ `IndexWriter`, drop `db.transaction`, run body directly). All RxNorm logic (`SEMANTIC_TTYS`, ATC level/parent helpers, `streamPipe`, the two-pass relation capture, the 2-hop group derivation, node/edge emission with labels) **verbatim**. Already `async`.
- [ ] **Step 3:** Port `rxnorm.test.ts` with the `collector()` — assert the ATC tree, IN/SCD grouping labels (`Clinical drugs`/`Ingredients`/`Strength components`/`Dose form`/`Brand names`/`Branded versions`/`Generic equivalent`), and node `kind`/`extra.tty` exactly as corlix does.
- [ ] **Step 4:** `pnpm --filter @openldr/terminology test -- adapters/rxnorm` → PASS. Commit `feat(terminology): RxNorm ontology adapter (ported) (P2-TERM)`.

---

## Task 6: `detectAdapter` + build orchestrator

**Files:** Create `packages/terminology/src/ontology/adapters/index.ts`, `packages/terminology/src/ontology/build.ts` (+ `build.test.ts`).

- [ ] **Step 1: adapters/index.ts** (verbatim port):
```ts
import { loincAdapter } from './loinc';
import { snomedAdapter } from './snomed';
import { rxnormAdapter } from './rxnorm';
import type { OntologyAdapter, DetectedDistribution } from '../types';
export const adapters: OntologyAdapter[] = [loincAdapter, snomedAdapter, rxnormAdapter];
export function detectAdapter(folderPath: string): { adapter: OntologyAdapter; dist: DetectedDistribution } | null {
  for (const adapter of adapters) { const dist = adapter.detect(folderPath); if (dist) return { adapter, dist }; }
  return null;
}
```

- [ ] **Step 2: build.ts** — the orchestrator + a buffered writer:
```ts
import { detectAdapter } from './adapters/index';
import { INDEX_SCHEMA_VERSION, type IndexWriter, type OntologyBuildProgress, type PanelMember } from './types';

export interface NodeRow { code: string; display: string; kind: string | null; extra: Record<string, unknown> | null }
export interface EdgeRow { parent: string; child: string; seq: number; label: string | null }
export interface AnswerRow { loinc: string; seq: number; value: string; label: string }
export interface SpecimenRow { loinc: string; snomedCode: string; equivalence: string }

export interface OntologyIndexStore {
  beginBuild(systemId: string, ontologyType: string, sourcePath: string): Promise<void>;
  clearIndex(systemId: string): Promise<void>;
  bulkInsertNodes(systemId: string, rows: NodeRow[]): Promise<void>;
  bulkInsertEdges(systemId: string, rows: EdgeRow[]): Promise<void>;
  bulkInsertPanelMembers(systemId: string, rows: PanelMember[]): Promise<void>;
  bulkInsertAnswerOptions(systemId: string, rows: AnswerRow[]): Promise<void>;
  bulkInsertSpecimens(systemId: string, rows: SpecimenRow[]): Promise<void>;
  finishBuild(systemId: string, opts: { ontologyType: string; sourcePath: string; nodeCount: number; edgeCount: number; manifest: unknown }): Promise<void>;
  failBuild(systemId: string, ontologyType: string, sourcePath: string, error: string): Promise<void>;
}

// Buffers adapter writes, flushing to the store in chunks to bound memory.
class BufferedWriter implements IndexWriter {
  nodes: NodeRow[] = []; edges: EdgeRow[] = []; panels: PanelMember[] = [];
  answers: AnswerRow[] = []; specimens: SpecimenRow[] = [];
  insertNode(n: NodeRow) { this.nodes.push(n); }
  insertEdge(parent: string, child: string, seq: number, label: string | null = null) { this.edges.push({ parent, child, seq, label }); }
  insertPanelMember(m: PanelMember) { this.panels.push(m); }
  insertAnswerOption(a: AnswerRow) { this.answers.push(a); }
  insertSpecimenMap(m: SpecimenRow) { this.specimens.push(m); }
}

const CHUNK = 5000;
async function flushChunked<T>(rows: T[], fn: (chunk: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) await fn(rows.slice(i, i + CHUNK));
}

export async function buildOntologyDistribution(
  systemId: string, sourcePath: string, store: OntologyIndexStore,
  onProgress: (p: OntologyBuildProgress) => void,
): Promise<void> {
  const detected = detectAdapter(sourcePath);
  if (!detected) throw new Error('No LOINC / SNOMED CT / RxNorm distribution found in that folder.');
  const { adapter, dist } = detected;
  await store.beginBuild(systemId, adapter.type, sourcePath);
  try {
    await store.clearIndex(systemId);
    const writer = new BufferedWriter();
    await adapter.buildIndex(dist, writer, (p) => onProgress({ ...p, codingSystemId: systemId }));
    await flushChunked(writer.nodes, (c) => store.bulkInsertNodes(systemId, c));
    await flushChunked(writer.edges, (c) => store.bulkInsertEdges(systemId, c));
    await flushChunked(writer.panels, (c) => store.bulkInsertPanelMembers(systemId, c));
    await flushChunked(writer.answers, (c) => store.bulkInsertAnswerOptions(systemId, c));
    await flushChunked(writer.specimens, (c) => store.bulkInsertSpecimens(systemId, c));
    await store.finishBuild(systemId, {
      ontologyType: adapter.type, sourcePath, nodeCount: writer.nodes.length, edgeCount: writer.edges.length,
      manifest: { schemaVersion: INDEX_SCHEMA_VERSION, ontologyType: adapter.type, sourcePath, fileStats: dist.fileStats },
    });
  } catch (err) {
    await store.failBuild(systemId, adapter.type, sourcePath, (err as Error).message);
    throw err;
  }
}
```

- [ ] **Step 3: build.test.ts** — fake in-memory `OntologyIndexStore` + the LOINC fixture dir:
```ts
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { buildOntologyDistribution, type OntologyIndexStore } from './build';

function fakeStore() {
  const state: any = { status: 'none', nodes: [], edges: [], built: null, error: null };
  const store: OntologyIndexStore = {
    beginBuild: async (_id, t) => { state.status = 'building'; state.type = t; },
    clearIndex: async () => { state.nodes = []; state.edges = []; },
    bulkInsertNodes: async (_id, r) => { state.nodes.push(...r); },
    bulkInsertEdges: async (_id, r) => { state.edges.push(...r); },
    bulkInsertPanelMembers: async () => {}, bulkInsertAnswerOptions: async () => {}, bulkInsertSpecimens: async () => {},
    finishBuild: async (_id, o) => { state.status = 'ready'; state.built = o; },
    failBuild: async (_id, _t, _p, e) => { state.status = 'error'; state.error = e; },
  };
  return { store, state };
}

describe('buildOntologyDistribution', () => {
  it('builds the LOINC fixture to ready with node/edge counts', async () => {
    const { store, state } = fakeStore();
    await buildOntologyDistribution('cs-loinc', join(__dirname, 'adapters', '__fixtures__', 'loinc'), store, () => {});
    expect(state.status).toBe('ready');
    expect(state.built.nodeCount).toBeGreaterThan(0);
    expect(state.built.edgeCount).toBeGreaterThan(0);
    expect(state.built.manifest.ontologyType).toBe('loinc');
  });
  it('fails on a folder with no recognized distribution', async () => {
    const { store, state } = fakeStore();
    await expect(buildOntologyDistribution('cs-x', join(__dirname, 'adapters', '__fixtures__'), store, () => {})).rejects.toThrow(/No LOINC/);
    expect(state.status).toBe('error');
  });
});
```

- [ ] **Step 4:** `pnpm --filter @openldr/terminology test -- build` → PASS. Commit `feat(terminology): ontology build orchestrator + detectAdapter (P2-TERM)`.

---

## Task 7: Staleness

**Files:** Create `packages/terminology/src/ontology/staleness.ts` (+ `.test.ts`).

- [ ] **Step 1:** Port corlix `distributions.stalenessReason` as a pure manifest-driven fn:
```ts
import { statSync } from 'node:fs';
import { INDEX_SCHEMA_VERSION, type FileStat } from './types';

export interface OntologyManifest { schemaVersion: number; ontologyType: string; sourcePath: string; fileStats: FileStat[] }

/** Why a built index is out of date, or null if current. Pure fs over the stored manifest. */
export function stalenessReason(manifest: OntologyManifest | null | undefined): 'schema' | 'files' | null {
  if (!manifest) return null;
  if (manifest.schemaVersion !== INDEX_SCHEMA_VERSION) return 'schema';
  if (!manifest.fileStats || manifest.fileStats.length === 0) return 'files';
  for (const fs of manifest.fileStats) {
    try {
      const st = statSync(fs.path);
      if (st.size !== fs.size || Math.abs(st.mtimeMs - fs.mtimeMs) > 1) return 'files';
    } catch { return 'files'; }
  }
  return null;
}
export function isStale(manifest: OntologyManifest | null | undefined): boolean {
  return stalenessReason(manifest) !== null;
}
```

- [ ] **Step 2: Test** — write a temp file, build a manifest pointing at it (matching size/mtime) → null; bump `schemaVersion` → 'schema'; mutate the file → 'files'; missing path → 'files'. Run → PASS.

- [ ] **Step 3: Export** in `packages/terminology/src/ontology/index.ts`:
```ts
export * from './types';
export * from './build';
export * from './staleness';
export { detectAdapter, adapters } from './adapters/index';
```
and add `export * from './ontology/index';` to `packages/terminology/src/index.ts`.

- [ ] **Step 4:** Typecheck + commit `feat(terminology): ontology staleness detection + package exports (P2-TERM)`.

---

## Task 8: Ontology store (`@openldr/db`)

**Files:** Create `packages/db/src/ontology-store.ts` (+ `.test.ts`). Export from `packages/db/src/index.ts`.

- [ ] **Step 1: Decide import direction** (see conventions). Import the ontology types from `@openldr/terminology` if acyclic; else define the small row/`OntologyNode`/`OntologyBreadcrumb`/`OntologyDistribution` types locally in this file. Record the choice in the commit. The store must satisfy the `OntologyIndexStore` shape from Task 6 **structurally** (it need not import the interface).

- [ ] **Step 2: Write failing tests** (pg-mem). Build a store over `makeMigratedDb()`; assert:
```ts
describe('ontology-store', () => {
  it('bulk-inserts nodes/edges and walks roots → children → node', async () => {
    const db = await makeMigratedDb(); const store = createOntologyStore(db);
    const S = 'cs-1';
    await store.bulkInsertNodes(S, [
      { code: 'ROOT-A', display: 'Root A', kind: 'category', extra: null },
      { code: 'CHILD-1', display: 'Child One', kind: 'term', extra: null },
    ]);
    await store.bulkInsertEdges(S, [
      { parent: '__ROOT__', child: 'ROOT-A', seq: 0, label: null },
      { parent: 'ROOT-A', child: 'CHILD-1', seq: 0, label: null },
    ]);
    const roots = await store.roots(S);
    expect(roots.map((n) => n.code)).toEqual(['ROOT-A']);
    expect(roots[0]!.childCount).toBe(1);
    const kids = await store.children(S, 'ROOT-A');
    expect(kids.map((n) => n.code)).toEqual(['CHILD-1']);
    expect((await store.node(S, 'CHILD-1'))?.display).toBe('Child One');
    expect((await store.search(S, 'child')).map((n) => n.code)).toEqual(['CHILD-1']);
    expect((await store.path(S, 'CHILD-1')).map((b) => b.code)).toEqual(['ROOT-A', 'CHILD-1']);
    await db.destroy();
  });
  it('round-trips panel/answer/specimen rows and unlink clears everything', async () => {
    const db = await makeMigratedDb(); const store = createOntologyStore(db); const S = 'cs-2';
    await store.beginBuild(S, 'loinc', '/tmp/loinc');
    await store.bulkInsertNodes(S, [{ code: 'X', display: 'X', kind: 'term', extra: null }]);
    await store.bulkInsertPanelMembers(S, [{ panelLoinc: 'P', memberLoinc: 'X', memberName: 'X', displayName: 'X', sequence: 1, required: true }]);
    await store.bulkInsertAnswerOptions(S, [{ loinc: 'X', seq: 0, value: 'LA1', label: 'Yes' }]);
    await store.bulkInsertSpecimens(S, [{ loinc: 'X', snomedCode: '119297000', equivalence: 'equivalent' }]);
    await store.finishBuild(S, { ontologyType: 'loinc', sourcePath: '/tmp/loinc', nodeCount: 1, edgeCount: 0, manifest: { schemaVersion: 1, fileStats: [] } });
    expect((await store.get(S))?.indexStatus).toBe('ready');
    expect(await store.panelMembers(S, 'P')).toHaveLength(1);
    expect(await store.answerOptions(S, 'X')).toEqual([{ value: 'LA1', label: 'Yes' }]);
    expect(await store.specimenCodes(S, 'X')).toEqual([{ snomedCode: '119297000', equivalence: 'equivalent' }]);
    await store.unlink(S);
    expect(await store.get(S)).toBeNull();
    expect(await store.node(S, 'X')).toBeNull();
    await db.destroy();
  });
});
```

- [ ] **Step 3: Implement** `createOntologyStore(db)`. Key points: jsonb via `JSON.stringify`; child counts via a **grouped** query (not correlated subquery — pg-mem); `search` via `lower(display) LIKE`; `path` via an iterative parent walk.

```ts
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

const ROOT_CODE = '__ROOT__';

export interface OntoNode { code: string; display: string; kind: string; extra: Record<string, unknown> | null; childCount: number; group: string | null }
export interface OntoBreadcrumb { code: string; display: string }
export interface OntoDistribution {
  codingSystemId: string; ontologyType: string; sourcePath: string; indexStatus: string;
  indexError: string | null; nodeCount: number | null; edgeCount: number | null;
  manifest: unknown | null; builtAt: string | null; updatedAt: string;
}

export function createOntologyStore(db: Kysely<InternalSchema>) {
  const parseExtra = (v: unknown): Record<string, unknown> | null =>
    v == null ? null : (typeof v === 'string' ? JSON.parse(v) : (v as Record<string, unknown>));

  // child_count for a set of codes, via one grouped query (pg-mem-safe).
  async function childCounts(systemId: string, codes: string[]): Promise<Map<string, number>> {
    if (codes.length === 0) return new Map();
    const rows = await db.selectFrom('ontology_edges')
      .select((eb) => ['parent_code', eb.fn.countAll<number>().as('n')])
      .where('coding_system_id', '=', systemId).where('parent_code', 'in', codes)
      .groupBy('parent_code').execute();
    return new Map(rows.map((r) => [r.parent_code, Number(r.n)]));
  }

  async function children(systemId: string, parentCode: string): Promise<OntoNode[]> {
    const rows = await db.selectFrom('ontology_edges as e')
      .innerJoin('ontology_nodes as n', (j) => j.onRef('n.code', '=', 'e.child_code').on('n.coding_system_id', '=', systemId))
      .select(['n.code', 'n.display', 'n.kind', 'n.extra', 'e.label as group', 'e.seq'])
      .where('e.coding_system_id', '=', systemId).where('e.parent_code', '=', parentCode)
      .orderBy('e.seq').orderBy('n.display').execute();
    const counts = await childCounts(systemId, rows.map((r) => r.code));
    return rows.map((r) => ({ code: r.code, display: r.display, kind: r.kind ?? '', extra: parseExtra(r.extra), childCount: counts.get(r.code) ?? 0, group: (r as { group: string | null }).group ?? null }));
  }

  async function node(systemId: string, code: string): Promise<OntoNode | null> {
    const r = await db.selectFrom('ontology_nodes').selectAll().where('coding_system_id', '=', systemId).where('code', '=', code).executeTakeFirst();
    if (!r) return null;
    const counts = await childCounts(systemId, [code]);
    return { code: r.code, display: r.display, kind: r.kind ?? '', extra: parseExtra(r.extra), childCount: counts.get(code) ?? 0, group: null };
  }

  const distRow = (r: {
    coding_system_id: string; ontology_type: string; source_path: string; index_status: string;
    index_error: string | null; node_count: number | null; edge_count: number | null; manifest: unknown; built_at: string | null; updated_at: string;
  }): OntoDistribution => ({
    codingSystemId: r.coding_system_id, ontologyType: r.ontology_type, sourcePath: r.source_path,
    indexStatus: r.index_status, indexError: r.index_error, nodeCount: r.node_count, edgeCount: r.edge_count,
    manifest: parseExtra(r.manifest), builtAt: r.built_at, updatedAt: r.updated_at,
  });

  async function upsertDist(systemId: string, fields: Record<string, unknown>): Promise<void> {
    await db.insertInto('ontology_distributions').values({
      coding_system_id: systemId, ontology_type: String(fields.ontology_type ?? ''), source_path: String(fields.source_path ?? ''),
      index_status: (fields.index_status as string) ?? 'none', index_error: (fields.index_error as string) ?? null,
      node_count: (fields.node_count as number) ?? null, edge_count: (fields.edge_count as number) ?? null,
      manifest: fields.manifest != null ? (JSON.stringify(fields.manifest) as never) : null,
      built_at: (fields.built_at as string) ?? null, updated_at: sql`now()`,
    } as never).onConflict((oc) => oc.column('coding_system_id').doUpdateSet((eb) => ({
      ontology_type: eb.ref('excluded.ontology_type'), source_path: eb.ref('excluded.source_path'),
      index_status: eb.ref('excluded.index_status'), index_error: eb.ref('excluded.index_error'),
      node_count: eb.ref('excluded.node_count'), edge_count: eb.ref('excluded.edge_count'),
      manifest: eb.ref('excluded.manifest'), built_at: eb.ref('excluded.built_at'), updated_at: sql`now()`,
    }))).execute();
  }

  return {
    // ── distributions ──
    async list(): Promise<OntoDistribution[]> {
      return (await db.selectFrom('ontology_distributions').selectAll().execute()).map(distRow);
    },
    async get(systemId: string): Promise<OntoDistribution | null> {
      const r = await db.selectFrom('ontology_distributions').selectAll().where('coding_system_id', '=', systemId).executeTakeFirst();
      return r ? distRow(r) : null;
    },
    async beginBuild(systemId: string, ontologyType: string, sourcePath: string) {
      await upsertDist(systemId, { ontology_type: ontologyType, source_path: sourcePath, index_status: 'building', index_error: null });
    },
    async finishBuild(systemId: string, opts: { ontologyType: string; sourcePath: string; nodeCount: number; edgeCount: number; manifest: unknown }) {
      await upsertDist(systemId, { ontology_type: opts.ontologyType, source_path: opts.sourcePath, index_status: 'ready', index_error: null, node_count: opts.nodeCount, edge_count: opts.edgeCount, manifest: opts.manifest, built_at: new Date().toISOString() });
    },
    async failBuild(systemId: string, ontologyType: string, sourcePath: string, error: string) {
      await upsertDist(systemId, { ontology_type: ontologyType, source_path: sourcePath, index_status: 'error', index_error: error });
    },
    async clearIndex(systemId: string) {
      for (const t of ['ontology_nodes', 'ontology_edges', 'ontology_panel_members', 'ontology_answer_options', 'ontology_specimen_map'] as const) {
        await db.deleteFrom(t).where('coding_system_id', '=', systemId).execute();
      }
    },
    async unlink(systemId: string) {
      await this.clearIndex(systemId);
      await db.deleteFrom('ontology_distributions').where('coding_system_id', '=', systemId).execute();
    },
    // ── bulk writes ──
    async bulkInsertNodes(systemId: string, rows: { code: string; display: string; kind: string | null; extra: Record<string, unknown> | null }[]) {
      if (!rows.length) return;
      await db.insertInto('ontology_nodes').values(rows.map((r) => ({ coding_system_id: systemId, code: r.code, display: r.display, kind: r.kind, extra: r.extra != null ? (JSON.stringify(r.extra) as never) : null })) as never)
        .onConflict((oc) => oc.columns(['coding_system_id', 'code']).doUpdateSet((eb) => ({ display: eb.ref('excluded.display'), kind: eb.ref('excluded.kind'), extra: eb.ref('excluded.extra') }))).execute();
    },
    async bulkInsertEdges(systemId: string, rows: { parent: string; child: string; seq: number; label: string | null }[]) {
      if (!rows.length) return;
      await db.insertInto('ontology_edges').values(rows.map((r) => ({ coding_system_id: systemId, parent_code: r.parent, child_code: r.child, seq: r.seq, label: r.label })) as never).execute();
    },
    async bulkInsertPanelMembers(systemId: string, rows: { panelLoinc: string; memberLoinc: string; memberName: string; displayName: string; sequence: number; required: boolean }[]) {
      if (!rows.length) return;
      await db.insertInto('ontology_panel_members').values(rows.map((m) => ({ coding_system_id: systemId, panel_loinc: m.panelLoinc, member_loinc: m.memberLoinc, member_name: m.memberName, display_name: m.displayName, sequence: m.sequence, required: m.required })) as never).execute();
    },
    async bulkInsertAnswerOptions(systemId: string, rows: { loinc: string; seq: number; value: string; label: string }[]) {
      if (!rows.length) return;
      await db.insertInto('ontology_answer_options').values(rows.map((a) => ({ coding_system_id: systemId, loinc: a.loinc, seq: a.seq, value: a.value, label: a.label })) as never).execute();
    },
    async bulkInsertSpecimens(systemId: string, rows: { loinc: string; snomedCode: string; equivalence: string }[]) {
      if (!rows.length) return;
      await db.insertInto('ontology_specimen_map').values(rows.map((m) => ({ coding_system_id: systemId, loinc: m.loinc, snomed_code: m.snomedCode, equivalence: m.equivalence })) as never).execute();
    },
    // ── browse ──
    roots: (systemId: string) => children(systemId, ROOT_CODE),
    children,
    node,
    async search(systemId: string, query: string, limit = 50): Promise<OntoNode[]> {
      const q = query.trim(); if (!q) return [];
      const like = `%${q.toLowerCase()}%`;
      const rows = await db.selectFrom('ontology_nodes').select(['code', 'display', 'kind', 'extra'])
        .where('coding_system_id', '=', systemId)
        .where((eb) => eb.or([eb(sql`lower(display)`, 'like', like), eb(sql`lower(code)`, 'like', like)]))
        .orderBy('display').limit(limit).execute();
      const counts = await childCounts(systemId, rows.map((r) => r.code));
      return rows.map((r) => ({ code: r.code, display: r.display, kind: r.kind ?? '', extra: parseExtra(r.extra), childCount: counts.get(r.code) ?? 0, group: null }));
    },
    async path(systemId: string, code: string): Promise<OntoBreadcrumb[]> {
      const out: OntoBreadcrumb[] = []; const seen = new Set<string>();
      let current: string | null = code;
      while (current && current !== ROOT_CODE && !seen.has(current)) {
        seen.add(current);
        const n = await db.selectFrom('ontology_nodes').select(['code', 'display']).where('coding_system_id', '=', systemId).where('code', '=', current).executeTakeFirst();
        if (n) out.unshift({ code: n.code, display: n.display });
        const p = await db.selectFrom('ontology_edges').select(['parent_code']).where('coding_system_id', '=', systemId).where('child_code', '=', current).limit(1).executeTakeFirst();
        current = p?.parent_code ?? null;
      }
      return out;
    },
    async panelMembers(systemId: string, panelLoinc: string) {
      const rows = await db.selectFrom('ontology_panel_members').selectAll().where('coding_system_id', '=', systemId).where('panel_loinc', '=', panelLoinc).orderBy('sequence').orderBy('member_loinc').execute();
      return rows.map((r) => ({ panelLoinc: r.panel_loinc, memberLoinc: r.member_loinc, memberName: r.member_name, displayName: r.display_name, sequence: r.sequence, required: r.required }));
    },
    async answerOptions(systemId: string, loinc: string) {
      const rows = await db.selectFrom('ontology_answer_options').select(['value', 'label']).where('coding_system_id', '=', systemId).where('loinc', '=', loinc).orderBy('seq').execute();
      return rows.map((r) => ({ value: r.value, label: r.label }));
    },
    async specimenCodes(systemId: string, loinc: string) {
      const rows = await db.selectFrom('ontology_specimen_map').select(['snomed_code', 'equivalence']).where('coding_system_id', '=', systemId).where('loinc', '=', loinc).execute();
      return rows.map((r) => ({ snomedCode: r.snomed_code, equivalence: r.equivalence }));
    },
  };
}
export type OntologyStore = ReturnType<typeof createOntologyStore>;
```
> Match the `onConflict … doUpdateSet((eb) => …)` idiom to exactly what SP3's `terminology-store`/`terminology-admin-store` already use (copy that form). Export `createOntologyStore` + `OntologyStore` from `packages/db/src/index.ts`.

- [ ] **Step 4:** `pnpm --filter @openldr/db test -- ontology-store` → PASS. Commit `feat(db): ontology store — distributions + bulk writes + browse queries (P2-TERM)`.

---

## Task 9: Bootstrap wiring (`ctx.terminology.ontology`)

**Files:** Modify `packages/bootstrap/src/terminology-context.ts`, `packages/bootstrap/src/index.ts`.

- [ ] **Step 1:** In both files, build the ontology store + facade and attach to `terminology`. In `terminology-context.ts` (which already has `db`):
```ts
import { createOntologyStore } from '@openldr/db';
import { buildOntologyDistribution, stalenessReason, type OntologyManifest } from '@openldr/terminology';
// …
  const ontologyStore = createOntologyStore(db);
  const ontology = {
    listDistributions: () => ontologyStore.list(),
    async getDistribution(systemId: string) {
      const d = await ontologyStore.get(systemId);
      return d ? { ...d, stale: stalenessReason(d.manifest as OntologyManifest | null) !== null } : null;
    },
    build: (systemId: string, sourcePath: string, onProgress: (p: unknown) => void) =>
      buildOntologyDistribution(systemId, sourcePath, ontologyStore, onProgress as never),
    async rebuild(systemId: string, onProgress: (p: unknown) => void) {
      const d = await ontologyStore.get(systemId);
      if (!d) throw new Error('No distribution linked.');
      return buildOntologyDistribution(systemId, d.sourcePath, ontologyStore, onProgress as never);
    },
    unlink: (systemId: string) => ontologyStore.unlink(systemId),
    roots: (s: string) => ontologyStore.roots(s),
    children: (s: string, parent: string) => ontologyStore.children(s, parent),
    node: (s: string, code: string) => ontologyStore.node(s, code),
    search: (s: string, q: string) => ontologyStore.search(s, q),
    path: (s: string, code: string) => ontologyStore.path(s, code),
    panelMembers: (s: string, p: string) => ontologyStore.panelMembers(s, p),
    answerOptions: (s: string, l: string) => ontologyStore.answerOptions(s, l),
    specimenCodes: (s: string, l: string) => ontologyStore.specimenCodes(s, l),
  };
  // add `ontology` to the returned terminology object + the TerminologyContext type.
```
Mirror in `index.ts` where the `terminology` object is assembled, and extend its type (`packages/bootstrap/src/index.ts` ~line 52 `terminology: { ops; admin; ontology }`).

- [ ] **Step 2:** `pnpm --filter @openldr/bootstrap typecheck` → PASS. Commit `feat(bootstrap): wire ctx.terminology.ontology (P2-TERM)`.

---

## Task 10: REST + SSE routes

**Files:** Create `apps/server/src/ontology-routes.ts`; register it where `registerTerminologyAdminRoutes` is registered.

- [ ] **Step 1:** Implement reads + SSE build. `redact()` on errors; all data via `ctx.terminology.ontology`.
```ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { redact } from '@openldr/core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerOntologyRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const onto = ctx.terminology.ontology;
  type IdParam = { id: string };
  const q = (req: { query: unknown }, k: string) => (req.query as Record<string, string>)[k];

  app.get('/api/terminology/ontology/distributions', async () => onto.listDistributions());
  app.get('/api/terminology/ontology/distributions/:id', async (req) => onto.getDistribution((req.params as IdParam).id));
  app.delete('/api/terminology/ontology/distributions/:id', async (req, reply) => {
    try { await onto.unlink((req.params as IdParam).id); reply.code(204); return null; }
    catch (e) { reply.code(500); return { error: redact(e instanceof Error ? e.message : String(e)) }; }
  });

  app.get('/api/terminology/ontology/:id/roots', async (req) => onto.roots((req.params as IdParam).id));
  app.get('/api/terminology/ontology/:id/children', async (req) => onto.children((req.params as IdParam).id, q(req, 'parent') ?? '__ROOT__'));
  app.get('/api/terminology/ontology/:id/node', async (req) => onto.node((req.params as IdParam).id, q(req, 'code') ?? ''));
  app.get('/api/terminology/ontology/:id/search', async (req) => onto.search((req.params as IdParam).id, q(req, 'q') ?? ''));
  app.get('/api/terminology/ontology/:id/path', async (req) => onto.path((req.params as IdParam).id, q(req, 'code') ?? ''));
  app.get('/api/terminology/ontology/:id/panels', async (req) => onto.panelMembers((req.params as IdParam).id, q(req, 'loinc') ?? ''));
  app.get('/api/terminology/ontology/:id/answers', async (req) => onto.answerOptions((req.params as IdParam).id, q(req, 'loinc') ?? ''));
  app.get('/api/terminology/ontology/:id/specimens', async (req) => onto.specimenCodes((req.params as IdParam).id, q(req, 'loinc') ?? ''));

  async function sse(req: { params: unknown; query: unknown }, reply: FastifyReply, run: (id: string, path: string | undefined, onP: (p: unknown) => void) => Promise<void>) {
    const id = (req.params as IdParam).id;
    const path = (req.query as Record<string, string>).path;
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      await run(id, path, (p) => write('progress', p));
      write('done', await onto.getDistribution(id));
    } catch (e) {
      write('error', { message: redact(e instanceof Error ? e.message : String(e)) });
    } finally {
      reply.raw.end();
    }
  }

  app.get('/api/terminology/ontology/:id/build', async (req, reply) =>
    sse(req, reply, (id, path, onP) => {
      if (!path) throw new Error('A server-side distribution path is required.');
      return onto.build(id, path, onP);
    }));
  app.get('/api/terminology/ontology/:id/rebuild', async (req, reply) =>
    sse(req, reply, (id, _path, onP) => onto.rebuild(id, onP)));
}
```
> Confirm the SSE/`reply.hijack()` + `reply.raw` idiom against any existing streaming or file-download route in `apps/server` (e.g. the value-set export from SP3, or a CSV download). Match that idiom exactly; if the app uses a plugin for SSE, use it instead.

- [ ] **Step 2:** Register `registerOntologyRoutes(app, ctx)` next to the terminology-admin registration (find `registerTerminologyAdminRoutes(` in the server bootstrap and add the sibling call + import).

- [ ] **Step 3:** Typecheck + run server tests. Add a contract test (seed ontology rows via the store/ctx, or build the committed LOINC fixture): GET roots/children returns expected; for SSE, use Fastify `inject`, read the streamed body string, and assert it contains a `event: done` line. Commit `feat(server): ontology REST + SSE build routes (P2-TERM)`.

---

## Task 11: CLI `ontology build/rebuild/list/unlink`

**Files:** Modify `packages/cli/src/terminology.ts`, `packages/cli/src/index.ts`.

- [ ] **Step 1:** Add runners in `terminology.ts` (the `ctx` is `createTerminologyContext(...)`; it must expose `ontology` — add it to the `TerminologyContext` interface + returned object in `terminology-context.ts` if not already there from Task 9):
```ts
export async function runOntologyBuild(systemId: string, dir: string, opts: { json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    await ctx.ontology.build(systemId, dir, (p) => process.stderr.write(`${p.phase}: ${p.processed}${p.total != null ? '/' + p.total : ''}\r`));
    const d = await ctx.ontology.getDistribution(systemId);
    out(opts.json ?? false, d, `\nbuilt ${d?.ontologyType} index: ${d?.nodeCount} nodes, ${d?.edgeCount} edges`);
    return 0;
  } catch (err) { process.stderr.write(`\nontology build failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}
export async function runOntologyRebuild(systemId: string, opts: { json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    await ctx.ontology.rebuild(systemId, (p) => process.stderr.write(`${p.phase}: ${p.processed}${p.total != null ? '/' + p.total : ''}\r`));
    const d = await ctx.ontology.getDistribution(systemId);
    out(opts.json ?? false, d, `\nrebuilt ${d?.ontologyType} index: ${d?.nodeCount} nodes, ${d?.edgeCount} edges`);
    return 0;
  } catch (err) { process.stderr.write(`\nontology rebuild failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}
export async function runOntologyList(opts: { json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try {
    const rows = await ctx.ontology.listDistributions();
    if (opts.json) console.log(JSON.stringify(rows, null, 2));
    else for (const d of rows) console.log(`${d.codingSystemId}\t${d.ontologyType}\t${d.indexStatus}\t${d.nodeCount ?? '—'} nodes\t${d.edgeCount ?? '—'} edges`);
    return 0;
  } catch (err) { process.stderr.write(`ontology list failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}
export async function runOntologyUnlink(systemId: string, opts: { json?: boolean }): Promise<number> {
  const ctx = await createTerminologyContext(loadConfig());
  try { await ctx.ontology.unlink(systemId); out(opts.json ?? false, { ok: true }, `unlinked ontology index for ${systemId}`); return 0; }
  catch (err) { process.stderr.write(`ontology unlink failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}
```

- [ ] **Step 2:** Register `terminology ontology build|rebuild|list|unlink` in `index.ts`, mirroring the existing `terminology <noun> <verb>` wiring exactly.

- [ ] **Step 3:** Typecheck + commit `feat(cli): terminology ontology build/rebuild/list/unlink (P2-TERM)`.

---

## Task 12: Web API client (ontology + EventSource build)

**Files:** Modify `apps/web/src/api.ts`.

- [ ] **Step 1:** Add types + read fns (copy the existing fetch-wrapper idiom — `apiGet`/etc. as used by SP1–SP3):
```ts
export type OntologyType = 'loinc' | 'snomed' | 'rxnorm';
export interface OntologyNode { code: string; display: string; kind: string; extra: Record<string, unknown> | null; childCount: number; group: string | null }
export interface OntologyBreadcrumb { code: string; display: string }
export interface OntologyDistribution {
  codingSystemId: string; ontologyType: OntologyType; sourcePath: string; indexStatus: string;
  indexError: string | null; nodeCount: number | null; edgeCount: number | null; builtAt: string | null; updatedAt: string; stale?: boolean;
}
export interface OntologyBuildProgress { codingSystemId: string; phase: string; processed: number; total: number | null }
export interface PanelMember { panelLoinc: string; memberLoinc: string; memberName: string; displayName: string; sequence: number; required: boolean }
export interface AnswerOption { value: string; label: string }
export interface SpecimenCode { snomedCode: string; equivalence: string }

export const listOntologyDistributions = (): Promise<OntologyDistribution[]> => apiGet('/api/terminology/ontology/distributions');
export const getOntologyDistribution = (id: string): Promise<(OntologyDistribution & { stale: boolean }) | null> => apiGet(`/api/terminology/ontology/distributions/${id}`);
export const unlinkOntologyDistribution = (id: string): Promise<void> => apiDelete(`/api/terminology/ontology/distributions/${id}`);
export const ontologyRoots = (id: string): Promise<OntologyNode[]> => apiGet(`/api/terminology/ontology/${id}/roots`);
export const ontologyChildren = (id: string, parent: string): Promise<OntologyNode[]> => apiGet(`/api/terminology/ontology/${id}/children?parent=${encodeURIComponent(parent)}`);
export const ontologyNodeDetail = (id: string, code: string): Promise<OntologyNode | null> => apiGet(`/api/terminology/ontology/${id}/node?code=${encodeURIComponent(code)}`);
export const ontologySearch = (id: string, q: string): Promise<OntologyNode[]> => apiGet(`/api/terminology/ontology/${id}/search?q=${encodeURIComponent(q)}`);
export const ontologyPath = (id: string, code: string): Promise<OntologyBreadcrumb[]> => apiGet(`/api/terminology/ontology/${id}/path?code=${encodeURIComponent(code)}`);
```

- [ ] **Step 2:** Add the EventSource build helper:
```ts
export function buildOntology(
  id: string, opts: { path?: string; rebuild?: boolean }, onProgress: (p: OntologyBuildProgress) => void,
): { promise: Promise<OntologyDistribution>; cancel: () => void } {
  const url = opts.rebuild
    ? `/api/terminology/ontology/${id}/rebuild`
    : `/api/terminology/ontology/${id}/build?path=${encodeURIComponent(opts.path ?? '')}`;
  const es = new EventSource(url);
  const promise = new Promise<OntologyDistribution>((resolve, reject) => {
    es.addEventListener('progress', (e) => { try { onProgress(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ } });
    es.addEventListener('done', (e) => { es.close(); resolve(JSON.parse((e as MessageEvent).data)); });
    es.addEventListener('error', (e) => {
      const data = (e as MessageEvent).data;        // a real SSE 'error' event carries data; a transport drop does not
      es.close();
      reject(new Error(data ? (JSON.parse(data).message ?? 'build failed') : 'connection lost'));
    });
  });
  return { promise, cancel: () => es.close() };
}
```
> If `api.ts` prefixes requests with a base URL/origin, build the EventSource URL with the same base. Confirm the Vite dev proxy forwards `/api` (incl. SSE) to the server.

- [ ] **Step 3:** Typecheck + commit `feat(web): ontology API client + EventSource build helper (P2-TERM)`.

---

## Task 13: OntologyBrowser (port)

**Files:** Create `apps/web/src/terminology/ontology/OntologyBrowser.tsx`.

- [ ] **Step 1:** Port `corlix/apps/desktop/src/renderer/components/ontology/OntologyBrowser.tsx` verbatim, with transforms:
  - imports: shadcn primitives from `../../components/ui/*` (Badge/Button/Input); icons from `lucide-react` unchanged; types from `../../api` (`OntologyNode`, `OntologyBreadcrumb`, `OntologyType`).
  - replace `window.api.ontology.roots/children/node/search/path` with `ontologyRoots/ontologyChildren/ontologyNodeDetail/ontologySearch/ontologyPath` from `../../api`.
  - replace every `t("…")` with English literals (read corlix's `en` locale for `terminology.ontology.*`, or use: "Search the ontology…", "Searching…", "No matches.", "Select a node to see details.", "This index is empty.", "Children", "FHIR coding", "Copy FHIR coding", "Copy code", "Copy code + display", "Copied", "Use as target", group-count → `` `${label} (${count})` ``, and corlix's RxNorm US-catalog caveat sentence).
  - keep ALL behavior verbatim: lazy tree + child cache, RxNorm group sections, debounced search (300ms), result-click path-walk + highlight + select, detail pane, RxNorm breadcrumb/FHIR-coding/caveat, picker mode `onPick`.

- [ ] **Step 2:** Typecheck → PASS. Commit `feat(web): OntologyBrowser (ported from corlix) (P2-TERM)`.

---

## Task 14: OntologyPickerDialog + OntologyDistributionDialog (port + adapt)

**Files:** Create `apps/web/src/terminology/ontology/OntologyPickerDialog.tsx`, `…/OntologyDistributionDialog.tsx`.

- [ ] **Step 1: OntologyPickerDialog** — port corlix's verbatim: a right-side `Sheet` (`sm:max-w-[920px]`, full-height `h-[calc(100vh-3.25rem)]`) wrapping `<OntologyBrowser …>`; on `onPick` → `onOpenChange(false)`. shadcn `Sheet*` from `../../components/ui/sheet`; English title. Accept a `mode?: 'browse' | 'picker'` prop and forward it to `<OntologyBrowser>` (default `'picker'`).

- [ ] **Step 2: OntologyDistributionDialog** — port corlix's, with the build-mechanism adaptation:
  - State + reload via `getOntologyDistribution(id)`; stale/error banners; ready metadata (type/nodes/edges/builtAt) — verbatim.
  - **Replace** the native-folder "Link folder" button with a **server-side path text input** (`Input`) + a **Build** button (enabled when path non-empty). Build → `const { promise } = buildOntology(id, { path }, setProgress); await promise;` then `onChanged?.()` + reload; on reject show the error.
  - **Rebuild** (status ready/stale/error) → `buildOntology(id, { rebuild: true }, setProgress)`.
  - **Unlink** → `unlinkOntologyDistribution(id)` behind `DangerConfirmDialog`/`ConfirmDialog`, then `onChanged?.()` + close.
  - Live progress line from the `onProgress` callback (`{phase}: {processed}{/total?}`) + a busy spinner; disable actions while busy.
  - English strings; shadcn `Dialog*`, `Button`, `Badge`, `Input`.

- [ ] **Step 3:** Typecheck → PASS. Commit `feat(web): OntologyPickerDialog + OntologyDistributionDialog (P2-TERM)`.

---

## Task 15: Wire the Terminology page (enable kebab + mount browser/dialog)

**Files:** Modify `apps/web/src/pages/Terminology.tsx`.

- [ ] **Step 1: Load distributions.** Add `const [distributions, setDistributions] = useState<Record<string, OntologyDistribution>>({});` and, in `reload()`, also call `listOntologyDistributions()` → reduce to a map keyed by `codingSystemId`. Add state `const [browseSystem, setBrowseSystem] = useState<CodingSystem | null>(null);` and `const [distDialogSystem, setDistDialogSystem] = useState<CodingSystem | null>(null);`. Import the ontology dialogs + `listOntologyDistributions`/`type OntologyDistribution` from `../api`.

- [ ] **Step 2: Enable the kebab items.** In the breadcrumb `⋯` "Code system" submenu and each code-system row's `⋯`, the "Browse ontology" + "Ontology distribution…" items are currently `disabled`. For the breadcrumb (acts on `selectedSystem`):
```tsx
  <DropdownMenuItem disabled={!selectedSystem || distributions[selectedSystem.id]?.indexStatus !== 'ready'}
    onClick={() => { if (selectedSystem) setBrowseSystem(selectedSystem); }}>Browse ontology</DropdownMenuItem>
  <DropdownMenuItem disabled={!selectedSystem}
    onClick={() => { if (selectedSystem) setDistDialogSystem(selectedSystem); }}>Ontology distribution…</DropdownMenuItem>
```
For each row's `⋯`, use that row's `s` instead of `selectedSystem`:
```tsx
  <DropdownMenuItem disabled={distributions[s.id]?.indexStatus !== 'ready'} onClick={() => setBrowseSystem(s)}>Browse ontology</DropdownMenuItem>
  <DropdownMenuItem onClick={() => setDistDialogSystem(s)}>Ontology distribution…</DropdownMenuItem>
```

- [ ] **Step 3: Mount the dialogs** near the other dialogs:
```tsx
  <OntologyPickerDialog
    open={!!browseSystem}
    onOpenChange={(o) => { if (!o) setBrowseSystem(null); }}
    codingSystemId={browseSystem?.id ?? ''}
    systemName={browseSystem?.systemName ?? ''}
    ontologyType={browseSystem ? distributions[browseSystem.id]?.ontologyType : undefined}
    mode="browse"
    onPick={() => { /* browse mode: no target selection */ }}
    title={browseSystem ? `Browse ${browseSystem.systemName}` : undefined}
  />
  <OntologyDistributionDialog
    open={!!distDialogSystem}
    onOpenChange={(o) => { if (!o) setDistDialogSystem(null); }}
    codingSystemId={distDialogSystem?.id ?? ''}
    systemName={distDialogSystem?.systemName ?? ''}
    onChanged={() => void reload()}
  />
```
> In `mode="browse"` the browser's "Use as target" button doesn't render, so the no-op `onPick` is fine.

- [ ] **Step 4:** Typecheck → PASS. Manual smoke: build the LOINC index via CLI, then open Browse. Commit `feat(web): enable + wire ontology Browse/Manage on the Terminology page (P2-TERM)`.

---

## Task 16: Wire the mapping dialog's "Browse ontology" picker

**Files:** Modify `apps/web/src/terminology/TermMappingDialog.tsx`; pass a `distributions` map from `Terminology.tsx`.

- [ ] **Step 1:** Thread the page's `distributions` map into the dialog (add a `distributions: Record<string, OntologyDistribution>` prop where the page mounts `TermMappingDialog`/`TermDialog`; if the mapping dialog is nested inside `TermDialog`, pass it through). Replace the disabled "Browse ontology" button + `browseDisabledHint` with a real button:
```tsx
const [browseOpen, setBrowseOpen] = useState(false);
const targetSystemId = systems.find((s) => s.url === toSystem)?.id ?? null;   // resolve id from the target url
const targetReady = !!targetSystemId && distributions[targetSystemId]?.indexStatus === 'ready';
// …in JSX, replacing the disabled button + hint:
<Button variant="outline" size="sm" disabled={!targetReady} onClick={() => setBrowseOpen(true)}>Browse ontology</Button>
{!targetReady && <span className="text-[11px] text-muted-foreground">Available once the target system's ontology index is built.</span>}
{targetSystemId && (
  <OntologyPickerDialog
    open={browseOpen} onOpenChange={setBrowseOpen} mode="picker"
    codingSystemId={targetSystemId} systemName={toSystem}
    ontologyType={distributions[targetSystemId]?.ontologyType}
    onPick={(n) => { setToCode(n.code); setToDisplay(n.display); setBrowseOpen(false); }}
  />
)}
```
> Use the dialog's real target-state setters (whatever it calls `toCode`/`toDisplay`). The dialog already has the `systems` list (or pass it); if not, accept it as a prop alongside `distributions`. Keep a `Tooltip` hint if the dialog already uses one (SP2 added a tooltip primitive).

- [ ] **Step 2:** Typecheck → PASS. Commit `feat(web): enable Browse-ontology target picker in TermMappingDialog (P2-TERM)`.

---

## Task 17: Staleness notifier (best-effort)

**Files:** Possibly port `corlix .../ontology/staleNotify.ts`; depends on what CE has.

- [ ] **Step 1:** Search CE for a notification/outbox primitive (`grep -ri "notification\|outbox\|publishNotification" packages apps`). If one exists, port `scanStaleOntologyIndexes` + a 15-min `startStaleOntologyScanScheduler` that uses it (compute staleness via `ctx.terminology.ontology.getDistribution(...).stale`, title "Terminology index needs rebuilding"), started from the server bootstrap.
- [ ] **Step 2:** If **no** suitable primitive exists, **skip the background notifier** — the dialog's stale **banner** (wired in Task 14 via `getDistribution(...).stale`) is the must-have. Leave a one-line comment noting the deferral. Do NOT invent a notification system.
- [ ] **Step 3:** Typecheck + commit (`feat: ontology stale-index notifier (best-effort)` or `docs: note stale-notifier deferral`).

---

## Task 18: e2e + live acceptance + gates + docs + memory + finish

**Files:** Modify `e2e/tests/terminology.spec.ts`; verification otherwise.

- [ ] **Step 1: e2e.** Add a spec that (a) makes a ready LOINC index for a system — **simplest reliable path: seed the ontology rows directly via a test helper / the store before navigating** (building via SSE in headless Chromium may be flaky); (b) opens that system's `⋯` → "Browse ontology"; (c) expands a root and asserts a child row appears; (d) types in search and selects a node (detail pane shows the code); (e) opens a mapping and uses "Browse ontology" to pick a target, asserting the target code field is filled. Idempotent via `RUN=Date.now()`. Comment which path (seed vs build) was used and why.

- [ ] **Step 2: Live-PG acceptance.** With a real LOINC distribution dir on the server box: `pnpm --filter @openldr/cli exec node dist/index.js terminology ontology build <loincSystemId> <dir>` → `… ontology list` shows `ready` + counts → `curl …/api/terminology/ontology/<id>/roots | jq length` > 0 → page browse + mapping pick. Record commands + outputs in the commit.

- [ ] **Step 3: Gates.** `pnpm turbo typecheck lint test build` + `pnpm depcruise` → all green. Confirm **no `@openldr/db` ↔ `@openldr/terminology` cycle** (Task 8 decision).

- [ ] **Step 4: Docs.** `pnpm docs:screenshots` → regenerate (include the ontology browser). Review the diff.

- [ ] **Step 5: Memory.** Append an SP4 entry to `C:\Users\Fredrick\.claude\projects\D--Projects-Repositories-openldr-ce\memory\openldr-ce-build-plan.md`: SP4 merged; migration 015 + ontology tables; ported LOINC/SNOMED/RxNorm adapters via `IndexWriter`; build orchestrator + SSE + staleness; ontology-store browse queries (`lower() LIKE`, not FTS); `ctx.terminology.ontology`; browser/picker/distribution UI; the two formerly-disabled "Browse ontology" buttons now wired; **Terminology Management UI is now complete (SP1–SP4)**; list the deferred items (bundled content, form-builder answer/specimen wiring, real-time file watching, the stale-notifier if skipped).

- [ ] **Step 6: Finish.** Use **superpowers:finishing-a-development-branch** → merge SP4 to `main` (Option 1, local `--no-ff`), per SP1–SP3. Don't push unless asked.

---

## Self-Review

**Spec coverage:** §1 data model → T1; §2 types/adapters/build/staleness → T2–T7; §3 store → T8; §4 bootstrap → T9; §5 REST+SSE → T10; §6 CLI → T11; §7 api client → T12; §8 UI (browser/picker/dist-dialog/page/mapping) → T13–T16; §9 notifier → T17; §10 testing → spread T1–T18; §11 non-goals → not built. All covered.

**Type consistency:** `OntologyNode`/`OntologyBreadcrumb`/`OntologyDistribution`/`OntologyBuildProgress`/`PanelMember`/`AnswerOption`/`SpecimenCode` defined in T2 (`@openldr/terminology`), mirrored in T12 (`apps/web/src/api.ts`) — intentional cross-boundary duplication (web imports neither db nor terminology), matching SP1–SP3. `IndexWriter` (T2) consumed by adapters (T3–T5) + `BufferedWriter` (T6). `OntologyIndexStore` (T6) satisfied structurally by `createOntologyStore` (T8), consumed via `ctx.terminology.ontology.build` (T9). `ROOT_CODE='__ROOT__'` consistent T2/T8. Web client names the node-detail fn `ontologyNodeDetail` (not `node`/`ontologyNode`) to avoid the DOM `Node` clash; the browser (T13) calls `ontologyNodeDetail`.

**Risks flagged in-plan (not hidden):** (a) db↔terminology cycle — T8 Step 1 decides with a local-type fallback, verified acyclic in T18; (b) Fastify `reply.hijack()`/`reply.raw` SSE idiom — T10 Step 1 says verify against an existing streaming/download route; (c) EventSource base-URL/Vite proxy — T12 Step 2 flags it; (d) pg-mem can't do expression indexes / correlated subqueries — T1 skips the `lower()` index, T8 uses a grouped child-count query; (e) e2e SSE flakiness — T18 uses a seed-rows path instead of building in-browser; (f) the stale **notifier** depends on a CE notification primitive that may not exist — T17 makes it best-effort with the banner (T14) as the must-have.
```
