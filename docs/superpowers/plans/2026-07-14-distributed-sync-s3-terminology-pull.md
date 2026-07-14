# Distributed Sync S3 — Terminology Pull (central → lab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A central instance's terminology (code systems + concepts, concept maps, and the small publishers/coding_systems/central term_mappings metadata) propagates down to each enrolled lab — mirrored, kept in sync (adds/edits/removals), without touching the lab's own locally-imported terminology — proven by a two-Postgres round-trip including a paged bulk concept transfer.

**Architecture:** Two layers over the existing S2 pull substrate (`reference_change_log` + `'sync-pull'` cursor + `createSyncPullWorker` + `POST /api/sync/pull` + `applyReferenceChange`). **Layer A** treats the small PK'd metadata (publishers/coding_systems/term_mappings) exactly like S2 config entities (new entity types + `managed_origin` + store capture + serve + apply). **Layer B** handles the large, unversioned bulk: a per-system/map `generation` signal (one deduped `reference_change_log` row per import-operation, NOT per concept), keyset-paginated bulk transfer endpoints, and a lab-side whole-system reconcile that runs in the worker/deps layer (network + DB) while the pure `applyReferenceChange` stays DB-only.

**Tech Stack:** TypeScript, Kysely, Fastify (`apps/server`), Vitest, pg-mem for units, real Postgres for the two-DB acceptance.

**Spec:** `docs/superpowers/specs/2026-07-14-distributed-sync-s3-terminology-pull-design.md`

**Key substrate to read first (all exist, from S2):**
- `packages/db/src/reference-change-log.ts` (`ReferenceEntityType`, `ReferenceOp`, `recordReferenceChange(trx, entityType, entityId, op, contentHash)` — hash-deduped append).
- `packages/db/src/reference-capture.ts` (`ReferenceCapture` interface, `referenceCapture` binding, `CENTER_OWNED_SETTING_KEYS`).
- `packages/db/src/reference-apply.ts` (`createReferenceApplier` + `ReferenceRecord` + the per-entity row mappers + `upsertOrDelete` delete-guard — the model for Layer A apply cases).
- `apps/server/src/sync-routes.ts` (`registerSyncRoutes`, `sitePrincipal`, `POST /api/sync/pull`, `fetchReferenceBody` — where Layer A serve branches + the bulk endpoints go).
- `packages/sync/src/batch.ts` (`PullRecord.entityType`) + `packages/sync/src/pull-worker.ts` (`createSyncPullRunner`, `PullDeps.applyRecord`).
- `packages/bootstrap/src/index.ts` (the `if (syncCfg)` block: `applyRecord: (rec) => referenceApplier(rec)`, `createReferenceApplier`, token provider, `'sync-pull'` cursor, `syncPullWorker`).
- `packages/bootstrap/src/sync-pull-worker.ts` (host loop).
- `packages/db/src/terminology-store.ts` (`createTerminologyStore`, `upsertConcepts`/`saveSystem`/`upsertMapElements`, `ConceptRecord`/`MapElement`) + `packages/db/src/terminology-admin-store.ts` (`createTerminologyAdminStore`, `publishers`/`codingSystems`/`termMappings`/`terms` method groups).
- Terminology import-completion points: `packages/db/src/loaders/loinc.ts`, `loaders/whonet.ts`, the generic `importTerminologyResource`, and `apps/server/src/terminology-admin-routes.ts` (`POST /api/terminology/systems/:id/terms/import`, `POST /api/terminology/import/loinc`).
- `scripts/sync-pull-live-acceptance.ts` (the S2 two-PG harness — model for `sync:terminology:accept`).

**Migration numbering:** highest internal migration is `048_managed_origin`. New ones below are `049`/`050` — confirm by listing `packages/db/src/migrations/internal/` and register each in `migrations/internal/index.ts` the same way `048` is registered.

**Global rules:** Use `pnpm exec`/`pnpm --filter`, never raw `node_modules/.bin/*`. NEVER add a `Co-Authored-By` trailer. bigint reads back as string on real PG → `Number()`.

---

## Task 0: Cut the branch

- [ ] Run:
```bash
git checkout main
git checkout -b feat/sync-s3-terminology
git branch --show-current
```
Expected: `feat/sync-s3-terminology`. Clean tree (spec + plan committed on `main`).

---

# LAYER A — small metadata (publishers / coding_systems / term_mappings) via the S2 per-row model

## Task A1: entity types + `managed_origin` on the three metadata tables

**Files:** Create `packages/db/src/migrations/internal/049_terminology_managed_origin.ts` + register; Modify `packages/db/src/schema/internal.ts`; Modify `packages/db/src/reference-change-log.ts` (`ReferenceEntityType`); Modify `packages/sync/src/batch.ts` (`PullRecord.entityType`); Test the migration.

- [ ] **Step 1: Migration** (`049_terminology_managed_origin.ts`) — adds `managed_origin text` (nullable) to the three metadata tables (Layer B's `terminology_systems` marker is added in B1):
```ts
import { type Kysely } from 'kysely';
const TABLES = ['publishers', 'coding_systems', 'term_mappings'] as const;
export async function up(db: Kysely<any>): Promise<void> {
  for (const t of TABLES) await db.schema.alterTable(t).addColumn('managed_origin', 'text').execute();
}
export async function down(db: Kysely<any>): Promise<void> {
  for (const t of TABLES) await db.schema.alterTable(t).dropColumn('managed_origin').execute();
}
```
Register `'049_terminology_managed_origin'` in `migrations/internal/index.ts`.

- [ ] **Step 2: schema types** — add `managed_origin: string | null;` to the `publishers`, `coding_systems`, `term_mappings` table interfaces in `packages/db/src/schema/internal.ts`.

- [ ] **Step 3: entity types** — extend BOTH enums to the full S3 set (add all five now so later tasks don't re-touch these files):
  - `packages/db/src/reference-change-log.ts`: `export type ReferenceEntityType = 'form' | 'dashboard' | 'report' | 'setting' | 'publisher' | 'coding_system' | 'term_mapping' | 'terminology_system' | 'concept_map';`
  - `packages/sync/src/batch.ts`: set `PullRecord.entityType` to the SAME union.

- [ ] **Step 4: migration test** (`049_terminology_managed_origin.test.ts`) — mirror `048_managed_origin.test.ts`: migrate a pg-mem db, insert a `publishers` row without `managed_origin` → null; update to `'central'` → round-trips. (Fill the real NOT NULL columns of `publishers` from `012_terminology_admin.ts`.)

- [ ] **Step 5:** typecheck + test + commit:
```bash
pnpm --filter @openldr/db exec vitest run src/migrations/internal/049_terminology_managed_origin.test.ts
pnpm --filter @openldr/db --filter @openldr/sync exec tsc --noEmit
git add packages/db/src/migrations packages/db/src/schema/internal.ts packages/db/src/reference-change-log.ts packages/sync/src/batch.ts
git commit -m "feat(db): terminology managed_origin + S3 reference entity types (sync S3)"
```

---

## Task A2: capture metadata writes in `terminology-admin-store`

**Files:** Modify `packages/db/src/terminology-admin-store.ts` (accept + use `capture?: ReferenceCapture`); Modify its construction sites (`packages/bootstrap/src/index.ts` + wherever it's built); Test.

Read S2's `report-store.ts` capture pattern (write + `capture.record` in one `db.transaction()`, `canonicalHash` over the entity's content). Apply the SAME to the metadata write groups.

- [ ] **Step 1:** add `capture?: ReferenceCapture` as a param to `createTerminologyAdminStore(db, projection?, capture?)` (append it so existing 1–2 arg callers still compile). Import `canonicalHash` from `@openldr/core`, `ReferenceCapture` from `./reference-capture`.

- [ ] **Step 2: publishers** — wrap `publishers.create`/`update`/`delete` in a transaction that captures:
  - create/update → `capture?.record(trx, 'publisher', id, 'upsert', canonicalHash({ name, role, icon, matchPrefixes, sortOrder }))` (the seed-relevant fields; NOT id).
  - delete → `capture?.record(trx, 'publisher', id, 'delete', null)`.

- [ ] **Step 3: codingSystems** — `create`/`update`/`upsertByUrl`/`delete`. The entity id is `coding_systems.id`. `upsertByUrl` conflicts on `url` — after the upsert, read back the row's `id` inside the trx and capture `'coding_system'` with `canonicalHash({ systemCode, systemName, url, systemVersion, description, active, publisherId })`. delete → `'delete'`.

- [ ] **Step 4: termMappings** — `create`/`update`/`delete` (these already run in a transaction that also writes `concept_map_elements` under `LOCAL_MAP_URL` — add the capture INSIDE that existing transaction). Capture `'term_mapping'` keyed by the mapping `id`, `canonicalHash({ fromSystem, fromCode, toSystem, toCode, toDisplay, mapType, relationship, isActive })`. delete → `'delete'`. NOTE: capture is UNCONDITIONAL (like S2 — a lab's own term_mapping is captured into the lab's inert log; ownership is enforced at apply time via `managed_origin`, not here). Do NOT gate on `owner`.

- [ ] **Step 5:** wire `referenceCapture` at the construction site(s): find every `createTerminologyAdminStore(...)` call (bootstrap `index.ts`, `terminology-context.ts`, tests) and pass `referenceCapture` as the new arg in the PRODUCTION wiring (`index.ts`). CRITICAL (S2 lesson): the store bootstrap actually uses MUST get `referenceCapture` or capture is inert. Confirm which instance the admin ROUTES use and pass capture to it.

- [ ] **Step 6: tests** — construct the admin store WITH a real `referenceCapture` against a migrated pg-mem db; assert a publisher/coding_system/term_mapping create → one `reference_change_log` upsert row (stable hash); update → upsert; delete → delete. Construct WITHOUT capture → no rows (no regression). Run the existing terminology-admin tests too.

- [ ] **Step 7:** typecheck + tests + commit (`feat(sync): capture terminology metadata writes (publishers/coding_systems/term_mappings) (sync S3)`).

---

## Task A3: serve + apply the three metadata entities

**Files:** Modify `apps/server/src/sync-routes.ts` (`fetchReferenceBody`); Modify `packages/db/src/reference-apply.ts` (new cases); Tests in both.

- [ ] **Step 1: serve** — in `fetchReferenceBody(ctx, entityType, id)` add branches returning the LIVE row for each (read via `ctx.internalDb` or the admin store's read methods — match how the form branch reads the raw row):
  - `publisher` → the `publishers` row for `id` (or null).
  - `coding_system` → the `coding_systems` row for `id`.
  - `term_mapping` → the `term_mappings` row for `id`.
  Return a plain object (camelCase or the raw row — must match what the applier writes in Step 2; keep them consistent, ideally serve the raw snake_case row and have the applier map it, OR serve a defined shape and map in the applier — pick one and be consistent, mirroring the dashboard/report round-trip).

- [ ] **Step 2: apply** — in `reference-apply.ts` add `publisher`/`coding_system`/`term_mapping` cases. Extend `ManagedTable` to include `'publishers' | 'coding_systems' | 'term_mappings'` and add row mappers mirroring each table's columns (+ `managed_origin: MANAGED`). Reuse `upsertOrDelete` (its delete-guard `WHERE managed_origin='central'` already protects lab-local rows). For `publishers`/`term_mappings` the PK is `id`; `coding_systems` PK is `id` too (conflict on `id`). Serialization: `publishers.match_prefixes` is jsonb → `JSON.stringify`; others are scalar text/boolean.

- [ ] **Step 3: tests** — endpoint: a `reference_change_log` `publisher` row → served body = the live publishers row; applier: upsert stamps `managed_origin='central'`, delete removes a central-managed row but not a lab-local (`managed_origin` NULL) one (mirror the S2 delete-guard test per entity).

- [ ] **Step 4:** typecheck (`@openldr/db` + `@openldr/server`) + tests + commit (`feat(sync): serve + apply terminology metadata entities (sync S3)`).

---

# LAYER B — bulk concepts + concept maps

## Task B1: generation signal + `mark*` helpers

**Files:** Create `packages/db/src/migrations/internal/050_terminology_generation.ts` + register; Modify `packages/db/src/schema/internal.ts`; Create `packages/db/src/terminology-sync.ts` + test.

- [ ] **Step 1: migration** (`050_terminology_generation.ts`):
```ts
import { type Kysely, sql } from 'kysely';
export async function up(db: Kysely<any>): Promise<void> {
  // per-system change signal + ownership marker
  await db.schema.alterTable('terminology_systems').addColumn('generation', 'bigint', (c) => c.notNull().defaultTo(0)).execute();
  await db.schema.alterTable('terminology_systems').addColumn('managed_origin', 'text').execute();
  // per-concept-map change signal + ownership (concept_map_elements has no PK/registry row)
  await db.schema.createTable('concept_map_state')
    .addColumn('map_url', 'text', (c) => c.primaryKey())
    .addColumn('generation', 'bigint', (c) => c.notNull().defaultTo(0))
    .addColumn('managed_origin', 'text')
    .execute();
}
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('concept_map_state').execute();
  await db.schema.alterTable('terminology_systems').dropColumn('managed_origin').execute();
  await db.schema.alterTable('terminology_systems').dropColumn('generation').execute();
}
```
Register `'050_terminology_generation'`. Add `generation` + `managed_origin` to the `terminology_systems` interface and a new `concept_map_state` table type in `schema/internal.ts`. (Confirm whether an imported ConceptMap already creates a `terminology_systems` row via `saveSystem(kind='ConceptMap')` — if it does, you MAY reuse `terminology_systems` for maps instead of `concept_map_state`; but `concept_map_state` keyed by `map_url` is the safe explicit choice since `map_url` ≠ a system url. Keep `concept_map_state`.)

- [ ] **Step 2: `packages/db/src/terminology-sync.ts`** — the mark helpers:
```ts
import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';
import { recordReferenceChange } from './reference-change-log';

/** Bump a code-system's generation and emit ONE reference_change_log signal (deduped by generation).
 *  Call at import-OPERATION completion (not per 1000-row batch) so an import emits a single signal.
 *  Runs its own transaction; safe to call after the concept writes committed. */
export async function markTerminologyChanged(db: Kysely<InternalSchema>, systemUrl: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    // ensure a row exists, then bump generation
    const cur = await trx.selectFrom('terminology_systems').select('generation').where('url', '=', systemUrl).executeTakeFirst();
    const nextGen = (cur ? Number(cur.generation) : 0) + 1;
    if (cur) {
      await trx.updateTable('terminology_systems').set({ generation: nextGen }).where('url', '=', systemUrl).execute();
    } else {
      // a concept-only import with no saveSystem: create a minimal registry row so the signal has a home
      await trx.insertInto('terminology_systems').values({ url: systemUrl, version: null, kind: 'CodeSystem', resource_id: '', generation: nextGen }).execute();
    }
    await recordReferenceChange(trx, 'terminology_system', systemUrl, 'upsert', String(nextGen));
  });
}

export async function markConceptMapChanged(db: Kysely<InternalSchema>, mapUrl: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const cur = await trx.selectFrom('concept_map_state').select('generation').where('map_url', '=', mapUrl).executeTakeFirst();
    const nextGen = (cur ? Number(cur.generation) : 0) + 1;
    await trx.insertInto('concept_map_state').values({ map_url: mapUrl, generation: nextGen })
      .onConflict((oc) => oc.column('map_url').doUpdateSet({ generation: nextGen })).execute();
    await recordReferenceChange(trx, 'concept_map', mapUrl, 'upsert', String(nextGen));
  });
}
```
Verify the minimal `terminology_systems` insert satisfies its NOT NULL columns (`kind`, `resource_id` are NOT NULL — `resource_id: ''` is a pragmatic placeholder for a concept-only system; note it). If `resource_id` NOT NULL rejects `''`, adjust (make it nullable in a follow-up or supply a sentinel). Export both helpers from the `@openldr/db` barrel.

- [ ] **Step 3: tests** (pg-mem): `markTerminologyChanged` on a fresh url → creates the system row (generation 1) + one `reference_change_log` `terminology_system` upsert with `content_hash='1'`; a second call → generation 2, a NEW log row (`'2'`); the endpoint dedup/worker will collapse repeats, but each mark is a real bump. `markConceptMapChanged` → `concept_map_state` row + `concept_map` log row.

- [ ] **Step 4:** typecheck + test + commit (`feat(db): terminology generation signal + mark helpers (sync S3)`).

---

## Task B2: instrument import-completion points to `mark*`

**Files:** Modify the loaders + admin term write paths + `upsertMapElements` callers. Tests.

The rule: **one `mark*` per import operation / per concept edit**, at COMPLETION (after the concept rows are written), NOT inside the batched `upsertConcepts`.

- [ ] **Step 1:** find every place that changes a system's concepts and call `markTerminologyChanged(db, systemUrl)` once after it finishes:
  - `packages/db/src/loaders/loinc.ts` (after the stream fully flushes) → mark the LOINC system url.
  - `loaders/whonet.ts` + the generic `importTerminologyResource` (after import) → mark the imported system url.
  - `terminology-admin-store.ts` `terms.importRows` → after the batch, mark the system (`rows[0].system`, all rows share a system in one import; if not, mark each distinct system).
  - `terms.create`/`terms.update`/`terms.delete` → mark that concept's `system` (inside/after the existing write).
  - The admin route `POST /api/terminology/systems/:id/terms/import` → the store call it delegates to should mark (prefer marking in the store method so all callers are covered, not in the route).
- [ ] **Step 2:** find every `upsertMapElements` caller (termMappings curation writes `LOCAL_MAP_URL`; imported ConceptMaps write their map_url) → call `markConceptMapChanged(db, mapUrl)` per affected map AFTER the write. **EXCEPTION: do NOT mark `LOCAL_MAP_URL`** — the lab's local curated map is lab-local and must not be pulled (it has no central origin). Only mark imported/central ConceptMap urls. (Gate: `if (mapUrl !== LOCAL_MAP_URL) markConceptMapChanged(...)`.)

  Decision to preserve correctness: prefer to place the `mark*` calls in the STORE methods (`terminology-store.ts` / `terminology-admin-store.ts`) so every caller (route, CLI, seed) is covered uniformly, rather than sprinkling them across routes/loaders. If a store method can't tell "operation complete" (e.g. `upsertConcepts` is per-batch), then mark in the higher-level operation (loader/route) and document why. State your choice.

- [ ] **Step 3: tests** — after a simulated import (call the loader/store import path against pg-mem), assert exactly ONE `terminology_system` `reference_change_log` row for the system (not one-per-batch); a single `terms.update` → one more signal; a `LOCAL_MAP_URL` mapping write → NO `concept_map` signal; an imported ConceptMap → one `concept_map` signal.

- [ ] **Step 4:** typecheck + tests + commit (`feat(sync): signal terminology changes at import-completion (sync S3)`).

---

## Task B3: bulk transfer endpoints (keyset-paginated)

**Files:** Modify `apps/server/src/sync-routes.ts` (2 new routes + serve branch for the signal); Test.

- [ ] **Step 1: serve the signal body** — in `fetchReferenceBody`, add `terminology_system` → return the small descriptor `{ url, version, kind, resourceId, generation }` from `terminology_systems` (NOT the concepts); `concept_map` → `{ mapUrl, generation }` from `concept_map_state`. These let the worker know which system/map to bulk-drain + at what generation.

- [ ] **Step 2: `POST /api/sync/terminology/concepts`** — reuse `sitePrincipal` (auth-only). Body `{ systemUrl: string, afterCode?: string, limit?: number }`:
```ts
app.post('/api/sync/terminology/concepts', async (req, reply) => {
  const principal = await sitePrincipal(req, reply, ctx);
  if (!principal) return;
  const b = req.body as { systemUrl?: string; afterCode?: string; limit?: number };
  if (typeof b?.systemUrl !== 'string' || !b.systemUrl) { reply.code(400).send({ error: 'systemUrl required' }); return; }
  const limit = Number.isFinite(b.limit) && (b.limit as number) > 0 ? Math.min(b.limit as number, 5000) : 1000;
  let q = ctx.internalDb.selectFrom('terminology_concepts').selectAll().where('system', '=', b.systemUrl);
  if (typeof b.afterCode === 'string' && b.afterCode) q = q.where('code', '>', b.afterCode);
  const rows = await q.orderBy('code', 'asc').limit(limit).execute();
  const concepts = rows.map((r) => ({ code: r.code, display: r.display, status: r.status, properties: r.properties == null ? null : (typeof r.properties === 'string' ? JSON.parse(r.properties) : r.properties) }));
  const nextCode = rows.length === limit ? rows[rows.length - 1].code : null; // null ⇒ done
  reply.send({ concepts, nextCode });
});
```
Keyset by `code` (stable + resumable). `nextCode=null` signals the last page. `properties` parsed to an object for the wire.

- [ ] **Step 3: `POST /api/sync/terminology/map-elements`** — same shape for a `mapUrl`, keyset over `(source_system, source_code)`:
  Body `{ mapUrl, afterSourceSystem?, afterSourceCode?, limit? }` → `{ elements: [...], nextKey: { sourceSystem, sourceCode } | null }`. Query `WHERE map_url=? AND (source_system, source_code) > (?, ?) ORDER BY source_system, source_code LIMIT n` (use a row-value comparison or an equivalent `OR` predicate). Return the elements + next key.

- [ ] **Step 4: tests** — auth 401/403; a system with N concepts + limit L → first page L concepts, `nextCode` = Lth code; follow-up with `afterCode` → next page; last (short) page → `nextCode=null`; unknown system → empty + null. Fix the test fake to sort-then-limit (the S2 T7 lesson — model `orderBy` THEN `limit`).

- [ ] **Step 5:** typecheck + tests + commit (`feat(server): keyset bulk terminology transfer endpoints (sync S3)`).

---

## Task B4: lab-side bulk-sync + whole-system/map reconcile

**Files:** Create `packages/sync/src/terminology-sync.ts` (the bulk-sync routine) + test. (Placed in `@openldr/sync` since it orchestrates transport + apply, like the pull runner.)

- [ ] **Step 1: types + deps**
```ts
import type { Kysely } from 'kysely';
export interface ConceptWire { code: string; display: string | null; status: string | null; properties: Record<string, unknown> | null }
export interface ConceptsPage { concepts: ConceptWire[]; nextCode: string | null }
export interface MapElementWire { sourceSystem: string; sourceCode: string; targetSystem: string; targetCode: string; equivalence: string | null }
export interface MapElementsPage { elements: MapElementWire[]; nextKey: { sourceSystem: string; sourceCode: string } | null }

export interface TerminologyBulkDeps {
  labDb: Kysely<any>;                       // the lab's internal db (Kysely<InternalSchema>)
  fetchConceptsPage: (systemUrl: string, afterCode: string | null, token: string) => Promise<ConceptsPage>;
  fetchMapElementsPage: (mapUrl: string, afterKey: { sourceSystem: string; sourceCode: string } | null, token: string) => Promise<MapElementsPage>;
  getToken: () => Promise<string>;
  logger: { warn(o: unknown, m: string): void; info(o: unknown, m: string): void };
}
export function createTerminologyBulkSync(deps: TerminologyBulkDeps): {
  syncSystem(systemUrl: string, signalBody: unknown): Promise<void>;
  syncConceptMap(mapUrl: string, signalBody: unknown): Promise<void>;
};
```

- [ ] **Step 2: `syncSystem`** — page all concepts, then whole-system reconcile in ONE transaction:
```ts
async syncSystem(systemUrl, signalBody) {
  const token = await deps.getToken();
  // 1. drain all pages (network) into memory (or a staging list of codes) — bounded batches.
  const all: ConceptWire[] = [];
  let after: string | null = null;
  do {
    const page = await deps.fetchConceptsPage(systemUrl, after, token);
    all.push(...page.concepts);
    after = page.nextCode;
  } while (after !== null);
  const codes = all.map((c) => c.code);
  // 2. reconcile in a transaction: upsert pulled + delete central-managed concepts not in the pulled set,
  //    scoped to this system; stamp the system managed_origin='central' + the pulled generation.
  await deps.labDb.transaction().execute(async (trx: any) => {
    // upsert concepts (batch in chunks of ~1000 to bound statement size)
    for (let i = 0; i < all.length; i += 1000) {
      const chunk = all.slice(i, i + 1000).map((c) => ({ system: systemUrl, code: c.code, display: c.display, status: c.status, properties: c.properties == null ? null : JSON.stringify(c.properties) }));
      await trx.insertInto('terminology_concepts').values(chunk)
        .onConflict((oc: any) => oc.columns(['system', 'code']).doUpdateSet((eb: any) => ({ display: eb.ref('excluded.display'), status: eb.ref('excluded.status'), properties: eb.ref('excluded.properties') })))
        .execute();
    }
    // delete concepts of THIS system that are no longer present (whole-system reconcile). Only central-managed
    // systems reach here, so all concepts of this system are central-owned.
    let del = trx.deleteFrom('terminology_concepts').where('system', '=', systemUrl);
    if (codes.length) del = del.where('code', 'not in', codes);   // if empty pull, delete all for the system
    await del.execute();
    // stamp the system row managed_origin='central' + record the generation we synced to.
    const gen = Number((signalBody as { generation?: number } | undefined)?.generation ?? 0);
    const desc = signalBody as { version?: string | null; kind?: string; resourceId?: string } | undefined;
    await trx.insertInto('terminology_systems').values({ url: systemUrl, version: desc?.version ?? null, kind: desc?.kind ?? 'CodeSystem', resource_id: desc?.resourceId ?? '', generation: gen, managed_origin: 'central' })
      .onConflict((oc: any) => oc.column('url').doUpdateSet({ version: desc?.version ?? null, kind: desc?.kind ?? 'CodeSystem', resource_id: desc?.resourceId ?? '', generation: gen, managed_origin: 'central' }))
      .execute();
  });
  deps.logger.info({ systemUrl, count: all.length }, 'terminology system synced');
}
```
NOTE the `code 'not in' codes` with a large `codes` array: for very large systems this is a huge IN list. For the plan, chunk-delete is acceptable at S3 scale (few hundred concepts in the acceptance); document that a staging-table anti-join is the S7 optimization for 100k-row deletes. If `codes` is empty (system emptied), delete all of the system's rows.

- [ ] **Step 3: `syncConceptMap`** — drain all elements, then whole-map replace: `DELETE FROM concept_map_elements WHERE map_url=?` then bulk insert the pulled elements (mirrors central's `upsertMapElements` model); upsert `concept_map_state` managed_origin='central' + generation. In one transaction.

- [ ] **Step 4: tests** (fakes for the page fetchers + a real pg-mem `labDb`): a system with 3 concepts across 2 pages → all 3 upserted, system stamped central; a re-sync after central drops one concept → the dropped concept is deleted (whole-system reconcile); a lab-local system with a DIFFERENT url present → untouched; a page-fetch throw → the reconcile transaction never runs (no partial apply) and the error propagates (the worker holds the cursor — Task B5). Map: whole-map replace verified.

- [ ] **Step 5:** typecheck + tests + commit (`feat(sync): lab terminology bulk-sync + whole-system reconcile (sync S3)`).

---

## Task B5: worker `applyRecord` routing + bootstrap wiring + cursor cap

**Files:** Modify `packages/sync/src/pull-worker.ts` (cursor cap for mixed batches); Modify `packages/bootstrap/src/index.ts` (route terminology records to bulk-sync + build the bulk deps). Tests.

- [ ] **Step 1: pull-worker cursor cap.** Today `createSyncPullRunner` applies every record then advances to `nextSeq` (per-record failures quarantined). Terminology bulk records are all-or-nothing: a failed `syncSystem` must NOT advance the cursor past that record. Change `runCycle` to process records in `seq` order and track the highest **contiguously-succeeded** seq; advance the cursor to `min(nextSeq, lastContiguousSuccessSeq-or-nextSeq)`. Precisely: iterate records in seq order; for each, call `applyRecord(rec)`; if it throws AND the record is a "hold" kind (bulk), STOP advancing at the previous record's seq (do not process further this cycle — return); if it throws and is a "quarantine" kind (the S2/Layer-A pure-apply records), log + skip + keep going (as today). To know which kind, `applyRecord` should signal it — simplest: `applyRecord` returns `'applied' | 'skipped'` normally and THROWS for a bulk hold; the runner catches, and decides hold-vs-quarantine by a predicate on `rec.entityType` (`terminology_system`/`concept_map` = hold; else quarantine). Pass an optional `isHoldRecord?: (rec) => boolean` dep (default: the two terminology types). On a hold failure: advance the cursor only to the seq BEFORE the failed record (or don't advance if it's the first), and return. Add tests for: a hold-record failure stops advance at the prior seq; a quarantine failure still advances; a mix advances to the last contiguous success.

- [ ] **Step 2: bootstrap routing.** In `index.ts`, replace `applyRecord: (rec) => referenceApplier(rec)` with a dispatcher:
```ts
const termBulk = createTerminologyBulkSync({
  labDb: internal.db,
  getToken: () => tokenProvider.getToken(),
  fetchConceptsPage: async (systemUrl, afterCode, token) => postJson(`${syncCfg.centralUrl}/api/sync/terminology/concepts`, { systemUrl, afterCode: afterCode ?? undefined }, token),
  fetchMapElementsPage: async (mapUrl, afterKey, token) => postJson(`${syncCfg.centralUrl}/api/sync/terminology/map-elements`, { mapUrl, afterSourceSystem: afterKey?.sourceSystem, afterSourceCode: afterKey?.sourceCode }, token),
  logger,
});
const applyRecord = async (rec: import('@openldr/sync').PullRecord) => {
  if (rec.entityType === 'terminology_system') { await termBulk.syncSystem(rec.entityId, rec.body); return 'applied' as const; }
  if (rec.entityType === 'concept_map') { await termBulk.syncConceptMap(rec.entityId, rec.body); return 'applied' as const; }
  return referenceApplier(rec);
};
// ...createSyncPullRunner({ ..., applyRecord, isHoldRecord: (r) => r.entityType === 'terminology_system' || r.entityType === 'concept_map' })
```
where `postJson(url, body, token)` is a small helper (POST + Bearer + throw on non-2xx with status only, no token). Reuse/extract the existing `postPull` fetch shape.

- [ ] **Step 2b:** typecheck + the WHOLE bootstrap suite (the full-boot `index.test.ts` must stay green; the routing is only inside `if (syncCfg)`).

- [ ] **Step 3:** commit (`feat(bootstrap): route terminology signals to bulk-sync + cursor-hold for bulk records (sync S3)`).

---

## Task C1: Two-Postgres terminology acceptance (`pnpm sync:terminology:accept`)

**Files:** Create `scripts/sync-terminology-live-acceptance.ts`; add `"sync:terminology:accept": "tsx scripts/sync-terminology-live-acceptance.ts"` to root `package.json`.

- [ ] Model on `scripts/sync-pull-live-acceptance.ts`. Two internal PG DBs (`openldr_s3_central` + `openldr_s3_lab`), migrated. Central: build the terminology store + admin store WITH `referenceCapture`. Steps + assertions (in-process `postPull`/`fetchConceptsPage`/`fetchMapElementsPage` replicating the endpoints — flag the shortcut):
  1. Central authors a publisher, a coding_system, a central term_mapping (metadata) + imports a code system with ~300 concepts (call `upsertConcepts` then `markTerminologyChanged`) + a concept map (`upsertMapElements` on a non-LOCAL map_url + `markConceptMapChanged`). Assert the expected `reference_change_log` rows: 1 `terminology_system`, 1 `concept_map`, 3 metadata upserts.
  2. Lab pre-holds: a lab-local system (distinct url) with concepts, a lab-local `term_mapping` (managed_origin NULL), a `LOCAL_MAP_URL` element.
  3. Drain pull (loop `runCycle` until 0; the bulk-sync pages the 300 concepts) → assert: lab has all 300 concepts for the central system, `terminology_systems.managed_origin='central'`; metadata mirrored + stamped; concept map mirrored.
  4. Lab-local system + concepts + lab-local term_mapping + LOCAL_MAP_URL element ALL untouched.
  5. Central adds a concept + removes one + re-marks (generation bump) → drain → lab reflects the add AND the removal (whole-system reconcile deleted the dropped concept).
  6. Shared-URL: give the lab a system with the SAME url as central's (pre-pull, managed_origin NULL) → after pull it's managed_origin='central' and matches central.
  7. Re-drain, no central change → 0 applied, `'sync-pull'` cursor unchanged.
- [ ] Run `docker compose up -d postgres && pnpm sync:terminology:accept` → PASS, exit 0. Paste full output. Commit (`test(sync): two-PG terminology pull acceptance (sync S3)`).

---

## Task C2: Whole-slice review, gate, merge & push

- [ ] **Gate:** `pnpm turbo run typecheck test --force --filter=@openldr/core --filter=@openldr/db --filter=@openldr/sync --filter=@openldr/server --filter=@openldr/bootstrap` — PASS, no NEW failures (verify known-flaky pkgs in isolation; never pipe turbo through `tail`). Re-run ALL THREE acceptance harnesses: `pnpm sync:accept` (S1), `pnpm sync:pull:accept` (S2), `pnpm sync:terminology:accept` (S3) — the store instrumentation + entity-type + worker changes touched shared code, so S1/S2 must not regress.
- [ ] **Whole-slice review** (dispatch a fresh reviewer over `git diff main..HEAD`): capture wired into the PRODUCTION terminology admin store (the S2 inert-capture trap — confirm `referenceCapture` reaches the instance the routes use); `mark*` at import-completion (one signal per import, not per batch); `LOCAL_MAP_URL` never signalled; bulk-sync whole-system reconcile deletes only central-managed systems' concepts; the cursor-hold means a bulk failure retries (no skipped systems) while per-row records still quarantine; lab-local systems/maps/term_mappings untouched; no token leak in the bulk fetchers; `managed_origin` guards on every delete; entity-type unions consistent across `@openldr/db` + `@openldr/sync`; the `terminology_systems.resource_id=''` placeholder for concept-only systems is sound or fixed. No `Co-Authored-By`.
- [ ] **Merge:**
```bash
git checkout main
git merge --no-ff feat/sync-s3-terminology -m "Merge branch 'feat/sync-s3-terminology': distributed sync S3 — terminology pull central->lab"
```
- [ ] **Push:** ask the user before `git push origin main` (pushes are discretionary per project convention).
- [ ] **Update memory:** `distributed-sync-central-workstream.md` + `sync-s1-starting-point.md` — S3 (terminology pull) DONE; the generation-signal + bulk-transfer + `managed_origin`-per-unit substrate; new `origin/main` SHA (if pushed); next = S4 (Sync UI + enrollment + config-surface reconciliation) / S5 store-and-forward / S7 (delta optimization, staging-table deletes, gzip, compaction).

---

## Self-review notes

- **Spec coverage:** Layer A managed_origin+entity types (§Design.A1)→A1; metadata capture (§A.3)→A2; metadata serve+apply (§A.4-5)→A3; generation signal + mark (§B1)→B1; import-completion instrumentation (§B1)→B2; bulk endpoints (§B2)→B3; lab bulk-sync + reconcile (§B3)→B4; worker routing + cursor policy (§B3, §Worker wiring)→B5; concept-map state (§B4)→B1(concept_map_state); two-PG proof (§Testing)→C1; gate/merge→C2. All covered.
- **Ordering safety:** entity types + managed_origin before capture; capture before serve/apply; generation+mark before instrumentation; endpoints before bulk-sync; bulk-sync before worker routing; everything before the acceptance proof. Layer A (mechanical S2 mirror) fully lands + is provable before Layer B's novel bulk path.
- **Type consistency:** `ReferenceEntityType` (`@openldr/db`) == `PullRecord.entityType` (`@openldr/sync`) — both get the full 9-value union in A1. `applyReferenceChange` handles the 4 S2 + 3 metadata types; the worker's `applyRecord` dispatcher handles the 2 bulk types BEFORE delegating to `applyReferenceChange`. Bulk-sync `ConceptWire`/`MapElementWire` == the endpoints' response shapes.
- **The S2 lessons carried in:** (1) wire `referenceCapture` into the PRODUCTION store instance (A2 Step 5 — the exact trap the S2 whole-slice review caught); (2) test fakes must sort-then-limit (B3 Step 4); (3) capture hashes the persisted content, is content-hash-deduped; (4) delete guarded by `managed_origin`.
- **Deliberate shortcuts (flagged):** in-process endpoints in C1; whole-system re-transfer (no deltas); generation (not content-hash) signal; large `NOT IN` delete (staging-table anti-join deferred to S7); `resource_id=''` placeholder for concept-only systems; no gzip/LISTEN.
```
