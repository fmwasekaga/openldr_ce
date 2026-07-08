# Report Designer — Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Report Designer designs durable — a `@openldr/report-designer` package (pure model + Zod schema + store + seed), a `report_designs` table, `ctx.reportDesigns`, `/api/report-designs` CRUD, a `/report-designer/:id` route with real Save/New/Delete, and a CLI.

**Architecture:** Mirror the report-builder persistence stack end-to-end. The designer model **moves out of studio** into `@openldr/report-designer/pure` (renamed `ReportTemplate`→`ReportDesign`); studio's `types.ts` becomes a re-export + `ReportTemplate` alias so no studio file needs a rename. Editing stays local; **Save is explicit**.

**Tech Stack:** TS monorepo (pnpm workspaces), Kysely + internal Postgres, Zod, Fastify, React (studio), Vitest.

**Reference (copy these patterns):** `@openldr/report-builder` (`src/{schema,store,index,pure}.ts`), `packages/db/src/migrations/internal/040_report_templates.ts` + `schema/internal.ts` + `migrations/internal/index.ts`, `packages/bootstrap/src/{index,seed}.ts` (reportTemplates), `apps/server/src/report-templates-routes.ts`(+`.test`), `apps/studio/src/api.ts` (dashboards CRUD style) + `ReportBuilderPage.tsx` (New→Save→Delete), `packages/cli/src/report-template.ts`.

**Spec:** `docs/superpowers/specs/2026-07-08-report-designer-persistence-design.md`

---

## File Structure

| File | Change |
|------|--------|
| `packages/report-designer/package.json` (new) | New workspace package. |
| `packages/report-designer/src/schema.ts` (new) | Model types + `ReportDesignSchema` (Zod). |
| `packages/report-designer/src/pure.ts` (new) | `export * from './schema'`. |
| `packages/report-designer/src/store.ts` (new) | `createReportDesignStore`. |
| `packages/report-designer/src/seed.ts` (new) | `seedReportDesigns` (3 defaults). |
| `packages/report-designer/src/index.ts` (new) | Barrel (store + seed + pure). |
| `apps/studio/src/report-designer/types.ts` (modify) | Re-export the package + `ReportTemplate` alias. |
| `apps/studio/package.json` (modify) | Add `@openldr/report-designer` dep. |
| `packages/db/src/schema/internal.ts` (modify) | `ReportDesignsTable` + `report_designs` in `InternalSchema`. |
| `packages/db/src/migrations/internal/042_report_designs.ts` (new) | Migration. |
| `packages/db/src/migrations/internal/index.ts` (modify) | Register `042_report_designs`. |
| `packages/db/src/migrations/migrations.test.ts` (modify) | Add `042_report_designs` to the expected list. |
| `packages/bootstrap/src/index.ts` (modify) | `ctx.reportDesigns` + construct. |
| `packages/bootstrap/src/seed.ts` (modify) | Seed designs. |
| `apps/server/src/report-designs-routes.ts` (new) + `app.ts` (modify) | CRUD routes. |
| `apps/studio/src/api.ts` (modify) | Client fns. |
| `apps/studio/src/App.tsx` (modify) | `/report-designer/:id` route. |
| `apps/studio/src/report-designer/ReportDesignerPage.tsx` (modify) | Load/Save/New/Delete. |
| `packages/cli/src/report-design.ts` (new) + entry (modify) | CLI. |

**Commands:** `pnpm --filter <pkg> exec vitest run <path>`, `pnpm --filter <pkg> typecheck`. After adding the package + dep: run `pnpm install` at the repo root once (Task 1 Step for it).

---

## Task 1: `@openldr/report-designer` package (pure model + schema)

**Files:** create `packages/report-designer/{package.json, src/schema.ts, src/pure.ts, src/index.ts, src/schema.test.ts}`; modify `apps/studio/src/report-designer/types.ts`, `apps/studio/package.json`.

- [ ] **Step 1: `packages/report-designer/package.json`**

```json
{
  "name": "@openldr/report-designer",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts", "./pure": "./src/pure.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run", "lint": "echo \"no lint\"" },
  "dependencies": { "@openldr/db": "workspace:*", "kysely": "^0.27.5", "zod": "3.24.0" },
  "devDependencies": { "pg-mem": "^3.0.14", "typescript": "5.7.2", "vitest": "2.1.8" }
}
```

Add a `tsconfig.json` mirroring another leaf package (copy `packages/report-builder/tsconfig.json` verbatim).

- [ ] **Step 2: `src/schema.ts`** (the model, moved+renamed from studio `types.ts`)

```ts
import { z } from 'zod';

export type ElementKind = 'text' | 'table' | 'image' | 'line' | 'rect' | 'datetime';
export type Paper = 'A4' | 'Letter';
export type Orientation = 'portrait' | 'landscape';
export type TextAlign = 'left' | 'center' | 'right';

export const RectSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type Rect = z.infer<typeof RectSchema>;

export const ElementStyleSchema = z.object({
  fontSize: z.number().optional(),
  bold: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  color: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
  fill: z.string().optional(),
});
export type ElementStyle = z.infer<typeof ElementStyleSchema>;

export const MarginsSchema = z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() });
export type Margins = z.infer<typeof MarginsSchema>;

export const DesignElementSchema = z.object({
  id: z.string(),
  kind: z.enum(['text', 'table', 'image', 'line', 'rect', 'datetime']),
  name: z.string(),
  rect: RectSchema,
  text: z.string().optional(),
  columns: z.array(z.string()).optional(),
  rows: z.array(z.array(z.string())).optional(),
  boundReport: z.string().optional(),
  style: ElementStyleSchema.optional(),
  src: z.string().optional(),
});
export type DesignElement = z.infer<typeof DesignElementSchema>;

export const DesignPageSchema = z.object({ id: z.string(), elements: z.array(DesignElementSchema).default([]) });
export type DesignPage = z.infer<typeof DesignPageSchema>;

export const TemplateParamSchema = z.object({ key: z.string(), label: z.string(), value: z.string() });
export type TemplateParam = z.infer<typeof TemplateParamSchema>;

export const ReportDesignSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  paper: z.enum(['A4', 'Letter']).default('A4'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  pages: z.array(DesignPageSchema).default([]),
  parameters: z.array(TemplateParamSchema).default([]),
  margins: MarginsSchema.optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type ReportDesign = z.infer<typeof ReportDesignSchema>;
```

- [ ] **Step 3: `src/pure.ts`** → `export * from './schema';`
- [ ] **Step 4: `src/index.ts`** → `export * from './pure';\nexport * from './store';\nexport * from './seed';` (store/seed land in Task 3; for Task 1 make index just `export * from './pure';` and extend it in Task 3).

- [ ] **Step 5: `src/schema.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { ReportDesignSchema } from './schema';

describe('ReportDesignSchema', () => {
  it('round-trips a full design and strips unknown keys', () => {
    const d = {
      id: 'd1', name: 'Test', paper: 'A4', orientation: 'portrait',
      margins: { top: 10, right: 10, bottom: 10, left: 10 },
      parameters: [{ key: 'p', label: 'P', value: 'v' }],
      pages: [{ id: 'p1', elements: [
        { id: 'e1', kind: 'text', name: 'T', rect: { x: 1, y: 2, w: 3, h: 4 }, text: 'hi', style: { bold: true, fontSize: 14 } },
        { id: 'e2', kind: 'rect', name: 'R', rect: { x: 0, y: 0, w: 9, h: 9 }, style: { fill: '#f00', strokeWidth: 2 }, junk: 1 },
      ] }],
    };
    const out = ReportDesignSchema.parse(d);
    expect(out.pages[0].elements[0].style).toEqual({ bold: true, fontSize: 14 });
    expect((out.pages[0].elements[1] as Record<string, unknown>).junk).toBeUndefined();
  });

  it('applies defaults for paper/orientation/pages/parameters', () => {
    const out = ReportDesignSchema.parse({ id: 'd', name: 'N' });
    expect(out).toMatchObject({ paper: 'A4', orientation: 'portrait', pages: [], parameters: [] });
  });

  it('rejects a design with no name', () => {
    expect(ReportDesignSchema.safeParse({ id: 'd', name: '' }).success).toBe(false);
  });
});
```

- [ ] **Step 6: Point studio at the package.** Replace `apps/studio/src/report-designer/types.ts` entirely with:

```ts
export * from '@openldr/report-designer/pure';
import type { ReportDesign } from '@openldr/report-designer/pure';
/** @deprecated The persisted entity is a ReportDesign; this alias keeps existing studio code compiling. */
export type ReportTemplate = ReportDesign;
```

Add to `apps/studio/package.json` dependencies: `"@openldr/report-designer": "workspace:*",`.

- [ ] **Step 7: Install + verify**

Run: `pnpm install` (repo root — links the new workspace package).
Run: `pnpm --filter @openldr/report-designer exec vitest run` (3 tests pass).
Run: `pnpm --filter @openldr/report-designer typecheck` and `pnpm --filter @openldr/studio typecheck` (both clean — the studio alias keeps all `ReportTemplate`/`DesignElement` usages valid).
Run: `pnpm --filter @openldr/studio exec vitest run src/report-designer` (still green — types are structurally identical).

- [ ] **Step 8: Commit**

```bash
git add packages/report-designer apps/studio/src/report-designer/types.ts apps/studio/package.json pnpm-lock.yaml
git commit -m "feat(report-designer): @openldr/report-designer package with pure model + Zod schema"
```

---

## Task 2: DB — `report_designs` table + migration

**Files:** modify `packages/db/src/schema/internal.ts`, `packages/db/src/migrations/internal/index.ts`, `packages/db/src/migrations/migrations.test.ts`; create `packages/db/src/migrations/internal/042_report_designs.ts` + `.test.ts`.

- [ ] **Step 1: Add the table interface** to `internal.ts` (after `ReportTemplatesTable`):

```ts
export interface ReportDesignsTable {
  id: string;
  name: string;
  paper: Generated<string>;
  orientation: Generated<string>;
  pages: unknown;
  parameters: unknown;
  margins: unknown | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
```

Add to the `InternalSchema` interface (near `report_templates`): `report_designs: ReportDesignsTable;`

- [ ] **Step 2: Migration** `042_report_designs.ts`:

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('report_designs')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('paper', 'text', (c) => c.notNull().defaultTo('A4'))
    .addColumn('orientation', 'text', (c) => c.notNull().defaultTo('portrait'))
    .addColumn('pages', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('parameters', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('margins', 'jsonb')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('report_designs').ifExists().execute();
}
```

- [ ] **Step 3: Register** in `migrations/internal/index.ts`: add `import * as m042 from './042_report_designs';` and `'042_report_designs': { up: m042.up, down: m042.down },` at the end of `internalMigrations`.

- [ ] **Step 4: Update the list assertion** in `migrations.test.ts` — append `'042_report_designs'` to the expected `Object.keys(internalMigrations)` array.

- [ ] **Step 5: Migration test** `042_report_designs.test.ts` (mirror `040_report_templates.test.ts` — create a pg-mem/SQLite internal db, run the migration, insert + read back a `report_designs` row with json pages).

```ts
import { describe, it, expect } from 'vitest';
import { makeTestInternalDb } from '../../test-helpers'; // use the same helper 040's test uses
import * as m from './042_report_designs';

describe('042_report_designs', () => {
  it('creates report_designs and round-trips a row', async () => {
    const db = await makeTestInternalDb(); // adjust import to match 040's test setup
    await m.up(db as never);
    await db.insertInto('report_designs').values({ id: 'd1', name: 'D', pages: JSON.stringify([]), parameters: JSON.stringify([]) } as never).execute();
    const row = await db.selectFrom('report_designs').selectAll().where('id', '=', 'd1').executeTakeFirst();
    expect(row?.name).toBe('D');
    await db.destroy?.();
  });
});
```
(Open `040_report_templates.test.ts` first and copy its exact db-setup/teardown; the helper name above is a placeholder for whatever 040 uses.)

- [ ] **Step 6: Verify** — `pnpm --filter @openldr/db exec vitest run src/migrations` (migrations list + new migration pass), `pnpm --filter @openldr/db typecheck` (clean).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/internal.ts packages/db/src/migrations/internal/042_report_designs.ts packages/db/src/migrations/internal/index.ts packages/db/src/migrations/migrations.test.ts packages/db/src/migrations/internal/042_report_designs.test.ts
git commit -m "feat(db): report_designs table + migration"
```

---

## Task 3: Package store + seed

**Files:** create `packages/report-designer/src/store.ts`, `src/seed.ts`, `src/store.test.ts`, `src/seed.test.ts`; extend `src/index.ts`.

- [ ] **Step 1: `store.ts`** (mirror report-builder `store.ts`)

```ts
import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { type ReportDesign, ReportDesignSchema } from './schema';

function toRow(d: ReportDesign) {
  return {
    id: d.id, name: d.name, paper: d.paper, orientation: d.orientation,
    pages: JSON.stringify(d.pages), parameters: JSON.stringify(d.parameters),
    margins: d.margins ? JSON.stringify(d.margins) : null,
  };
}
function fromRow(r: Record<string, unknown>): ReportDesign {
  const parse = (v: unknown, fb: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? fb));
  return ReportDesignSchema.parse({
    id: r.id, name: r.name, paper: r.paper ?? 'A4', orientation: r.orientation ?? 'portrait',
    pages: parse(r.pages, []), parameters: parse(r.parameters, []),
    margins: r.margins == null ? undefined : parse(r.margins, undefined),
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  });
}

export interface ReportDesignStore {
  list(): Promise<ReportDesign[]>;
  get(id: string): Promise<ReportDesign | undefined>;
  create(d: ReportDesign): Promise<ReportDesign>;
  update(id: string, d: ReportDesign): Promise<ReportDesign>;
  remove(id: string): Promise<void>;
}

export function createReportDesignStore(db: Kysely<InternalSchema>): ReportDesignStore {
  const t = () => db.selectFrom('report_designs');
  const store: ReportDesignStore = {
    async list() { return (await t().selectAll().orderBy('name').execute()).map((r) => fromRow(r as Record<string, unknown>)); },
    async get(id) { const r = await t().selectAll().where('id', '=', id).executeTakeFirst(); return r ? fromRow(r as Record<string, unknown>) : undefined; },
    async create(d) {
      const inserted = await db.insertInto('report_designs').values(toRow(d) as never)
        .onConflict((oc) => oc.column('id').doNothing()).returningAll().executeTakeFirst();
      if (inserted) return fromRow(inserted as Record<string, unknown>);
      return (await store.get(d.id))!;
    },
    async update(id, d) { await db.updateTable('report_designs').set({ ...toRow({ ...d, id }) } as never).where('id', '=', id).execute(); return (await store.get(id))!; },
    async remove(id) { await db.deleteFrom('report_designs').where('id', '=', id).execute(); },
  };
  return store;
}
```

- [ ] **Step 2: `seed.ts`** — the 3 defaults (copy the objects from `apps/studio/src/report-designer/mockTemplates.ts`'s `MOCK_TEMPLATES`, typed as `ReportDesign`):

```ts
import type { ReportDesign } from './schema';
import type { ReportDesignStore } from './store';

export const SEED_DESIGNS: ReportDesign[] = [
  /* paste the three MOCK_TEMPLATES objects from apps/studio/src/report-designer/mockTemplates.ts here,
     unchanged (they already satisfy ReportDesign) */
];

/** Idempotently insert the default designs. Returns how many were newly created. */
export async function seedReportDesigns(store: Pick<ReportDesignStore, 'get' | 'create'>): Promise<number> {
  let n = 0;
  for (const d of SEED_DESIGNS) {
    if (!(await store.get(d.id))) { await store.create(d); n += 1; }
  }
  return n;
}
```

- [ ] **Step 3: Extend `src/index.ts`** → `export * from './pure';\nexport * from './store';\nexport * from './seed';`

- [ ] **Step 4: Tests** — `store.test.ts` (mirror report-builder `store.test.ts`: migrate a test internal db incl. `042`, then create/get/list/update/remove + idempotent create) and `seed.test.ts` (seeds 3, second run seeds 0). Use the same test-db helper the report-builder store test uses (open `packages/report-builder/src/store.test.ts` and copy its setup, swapping the store + table).

- [ ] **Step 5: Verify** — `pnpm --filter @openldr/report-designer exec vitest run` (all pass), `pnpm --filter @openldr/report-designer typecheck` (clean).

- [ ] **Step 6: Commit**

```bash
git add packages/report-designer/src/store.ts packages/report-designer/src/seed.ts packages/report-designer/src/index.ts packages/report-designer/src/store.test.ts packages/report-designer/src/seed.test.ts
git commit -m "feat(report-designer): design store + seed defaults"
```

---

## Task 4: Bootstrap wiring

**Files:** modify `packages/bootstrap/src/index.ts`, `packages/bootstrap/src/seed.ts` (+ their tests as needed).

- [ ] **Step 1: `index.ts`** — import + construct + expose:
  - Add `import { createReportDesignStore, seedReportDesigns, type ReportDesignStore } from '@openldr/report-designer';`
  - Add to `AppContext`: `reportDesigns: ReportDesignStore;`
  - Near `const reportTemplateStore = createReportTemplateStore(internal.db);` add `const reportDesignStore = createReportDesignStore(internal.db);`
  - Add `@openldr/report-designer` to `packages/bootstrap/package.json` deps (`workspace:*`), then `pnpm install`.
  - In the returned ctx object (near `reportTemplates: reportTemplateStore,`) add `reportDesigns: reportDesignStore,`.

- [ ] **Step 2: `seed.ts`** — extend `FormSeedTarget` with `reportDesigns: Pick<ReportDesignStore, 'get' | 'create'>;` (import the type), add `reportDesignsSeeded: number;` to `SeedResult`, and in `seedDatabase` call `const reportDesignsSeeded = await seedReportDesigns(app.reportDesigns);` and include it in the returned result. Import `seedReportDesigns`, `ReportDesignStore` from `@openldr/report-designer`. `AppContext` already satisfies `reportDesigns` after Step 1, so the server's `seedDatabase(db, ctx)` call type-checks.

- [ ] **Step 3: Verify** — `pnpm --filter @openldr/bootstrap typecheck` (clean); `pnpm --filter @openldr/bootstrap exec vitest run` (existing bootstrap/seed tests pass; if `seed.test.ts` asserts the `SeedResult` shape, add `reportDesignsSeeded` there).

- [ ] **Step 4: Commit**

```bash
git add packages/bootstrap/src/index.ts packages/bootstrap/src/seed.ts packages/bootstrap/package.json pnpm-lock.yaml packages/bootstrap/src/seed.test.ts
git commit -m "feat(bootstrap): wire reportDesigns store + seed"
```

---

## Task 5: Server CRUD routes

**Files:** create `apps/server/src/report-designs-routes.ts` + `.test.ts`; modify `apps/server/src/app.ts`.

- [ ] **Step 1: Failing test** — `report-designs-routes.test.ts` (mirror `report-templates-routes.test.ts`): build the app with a fake `ctx.reportDesigns` (in-memory Map store) + audit spy; assert POST creates (201) + audits, GET lists/gets, PUT updates, DELETE 204s, GET missing → 404, POST bad body → 400, and a non-manager role → 403. Copy the harness from the report-templates test verbatim, swapping the resource.

- [ ] **Step 2: `report-designs-routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { ReportDesignSchema } from '@openldr/report-designer/pure';
import { recordAudit } from './audit-helper';
import { requireRole } from './rbac';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerReportDesignRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const MANAGE = { preHandler: requireRole('lab_admin', 'lab_manager') };

  app.get('/api/report-designs', async () => ctx.reportDesigns.list());

  app.get('/api/report-designs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = await ctx.reportDesigns.get(id);
    if (!d) { reply.code(404); return { error: 'not found' }; }
    return d;
  });

  app.post('/api/report-designs', MANAGE, async (req, reply) => {
    const p = ReportDesignSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const created = await ctx.reportDesigns.create(p.data);
    await recordAudit(ctx, req, { action: 'report-design.create', entityType: 'report-design', entityId: created.id, before: null, after: created });
    reply.code(201);
    return created;
  });

  app.put('/api/report-designs/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = ReportDesignSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const before = await ctx.reportDesigns.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    const after = await ctx.reportDesigns.update(id, p.data);
    await recordAudit(ctx, req, { action: 'report-design.update', entityType: 'report-design', entityId: id, before, after });
    return after;
  });

  app.delete('/api/report-designs/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await ctx.reportDesigns.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    await ctx.reportDesigns.remove(id);
    await recordAudit(ctx, req, { action: 'report-design.delete', entityType: 'report-design', entityId: id, before, after: null });
    reply.code(204);
    return null;
  });
}
```

- [ ] **Step 3: Register in `app.ts`** — import `registerReportDesignRoutes` and call it wherever `registerReportTemplateRoutes(app, ctx)` is called (same place, same args). Add `@openldr/report-designer` to `apps/server/package.json` deps if the import needs it (it imports `/pure` — likely already transitively available via bootstrap, but add the dep to be explicit), then `pnpm install`.

- [ ] **Step 4: Verify** — `pnpm --filter @openldr/server exec vitest run src/report-designs-routes.test.ts` (pass), `pnpm --filter @openldr/server typecheck` (clean).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/report-designs-routes.ts apps/server/src/report-designs-routes.test.ts apps/server/src/app.ts apps/server/package.json pnpm-lock.yaml
git commit -m "feat(server): /api/report-designs CRUD routes"
```

---

## Task 6: Studio client + page wiring

**Files:** modify `apps/studio/src/api.ts`, `apps/studio/src/App.tsx`, `apps/studio/src/report-designer/ReportDesignerPage.tsx`; add/extend tests.

- [ ] **Step 1: `api.ts` client fns** (use the existing `authFetch`/`okJson`/`json` helpers — mirror the dashboards CRUD block):

```ts
import type { ReportDesign } from '@openldr/report-designer/pure';
// ...
export const listReportDesigns = (): Promise<ReportDesign[]> =>
  authFetch('/api/report-designs').then((r) => okJson<ReportDesign[]>(r, 'list report designs'));
export const getReportDesign = (id: string): Promise<ReportDesign> =>
  authFetch(`/api/report-designs/${encodeURIComponent(id)}`).then((r) => okJson<ReportDesign>(r, 'get report design'));
export const createReportDesign = (d: ReportDesign): Promise<ReportDesign> =>
  authFetch('/api/report-designs', json(d)).then((r) => okJson<ReportDesign>(r, 'create report design'));
export const updateReportDesign = (id: string, d: ReportDesign): Promise<ReportDesign> =>
  authFetch(`/api/report-designs/${encodeURIComponent(id)}`, { ...json(d), method: 'PUT' }).then((r) => okJson<ReportDesign>(r, 'save report design'));
export const deleteReportDesign = async (id: string): Promise<void> => {
  const r = await authFetch(`/api/report-designs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`delete failed: ${r.status}`);
};
```
(If `json`/`okJson` aren't already exported/in-scope in `api.ts`, use the same local helpers the dashboards fns use — check the file.)

- [ ] **Step 2: Route** — in `App.tsx`, add next to the existing `/report-designer` route:
```tsx
<Route path="/report-designer/:id" element={<RequireRole roles={['lab_admin', 'lab_manager']}><ReportDesignerPage /></RequireRole>} />
```

- [ ] **Step 3: Rewire `ReportDesignerPage.tsx`** — replace mock-seeded local state with the store. Key changes (keep the editor's local `template` working state + undo history exactly as-is; only the source/persistence changes):

- Import `useParams`/`useNavigate` from `react-router-dom`; import `listReportDesigns`, `getReportDesign`, `createReportDesign`, `updateReportDesign`, `deleteReportDesign` from `../api`; import `newElement`... (unchanged) and `ReportDesign` type.
- State: keep `templates` (now the loaded list), `selectedId`, working `template`, etc. Replace `useState<ReportTemplate[]>(MOCK_TEMPLATES)` with `useState<ReportDesign[]>([])`; on mount, `listReportDesigns().then(setTemplates).catch(setError)`.
- `:id` effect: when `useParams().id` changes and it's not already the open template, `getReportDesign(id).then((d) => { setTemplates((ts) => upsert(ts, d)); setSelectedId(d.id); })`.
- Explorer `onSelect(id)` → `navigate('/report-designer/' + id)` (the `:id` effect loads it).
- `newTemplate`: create a transient design in state (fresh id, empty) + select it (no navigate yet — it isn't saved).
- `onSave` (replace the `noop`): `const saved = isTransient ? await createReportDesign(template) : await updateReportDesign(template.id, template); setTemplates(upsert(list, saved)); if (isTransient) navigate('/report-designer/' + saved.id); toast.success(...)`. Track transient-ness (e.g. a `savedIds` set or a `dirty`/`isNew` flag; simplest: an `unsavedId` state or compare against the loaded list).
- `onDelete` (replace `noop`): confirm via `ConfirmDialog` → `await deleteReportDesign(template.id); setTemplates(list.filter(...)); navigate('/report-designer')`.
- The Templates explorer keeps rendering `templates` (now the API list).

Keep it minimal and mirror `ReportBuilderPage.tsx`'s New→Save→navigate + Delete flow (read it for the exact transient-id + `navigate(..., { replace: true })` pattern).

- [ ] **Step 4: Tests** — `api.reportDesigns.test.ts` (mirror `api.reportTemplates.test.ts`: each fn hits the right URL/method via a mocked `authFetch`). Update `ReportDesignerPage.test.tsx`: mock `../api` (`listReportDesigns` returns the seed designs, `getReportDesign` returns one, `create/update/delete` resolve) + wrap in `MemoryRouter`; assert the list loads into the explorer, Save calls `create`/`update`, Delete calls `delete`. The existing pointer/inline/bulk tests keep working but now need the api mock + a template loaded — adjust their setup (render at `/report-designer/rt-amr-summary` with `getReportDesign` mocked to return `MOCK_TEMPLATES[0]`).

- [ ] **Step 5: Verify** — `pnpm --filter @openldr/studio exec vitest run src/report-designer src/api.reportDesigns.test.ts` (pass), `pnpm --filter @openldr/studio typecheck` (clean).

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/App.tsx apps/studio/src/report-designer/ReportDesignerPage.tsx apps/studio/src/report-designer/ReportDesignerPage.test.tsx apps/studio/src/api.reportDesigns.test.ts
git commit -m "feat(report-designer): persist designs (list/load/save/delete + :id route)"
```

---

## Task 7: CLI

**Files:** create `packages/cli/src/report-design.ts` + `.test.ts`; register in the CLI entry.

- [ ] **Step 1: `report-design.ts`** (mirror `report-template.ts`'s list/export/delete):

```ts
import { createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import type { ReportDesignStore } from '@openldr/report-designer';

type Writer = (s: string) => void;
const stdout: Writer = (s) => process.stdout.write(s);

export async function listDesigns(store: ReportDesignStore, opts: { json: boolean }, write: Writer = stdout): Promise<void> {
  const designs = await store.list();
  if (opts.json) { write(JSON.stringify(designs, null, 2) + '\n'); return; }
  const lines = designs.map((d) => `${d.id}\t${d.name}\t${d.paper}\t${d.orientation}\t${d.pages.length} pages`);
  write((lines.length ? lines.join('\n') : '(no report designs)') + '\n');
}
export async function deleteDesign(store: ReportDesignStore, id: string, opts: { force: boolean }): Promise<void> {
  if (!opts.force) throw new Error('refusing to delete without --force');
  await store.remove(id);
}
export async function runList(opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { await listDesigns(ctx.reportDesigns, opts); return 0; } finally { await ctx.close(); }
}
export async function runDelete(id: string, opts: { force: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { await deleteDesign(ctx.reportDesigns, id, opts); process.stdout.write(`deleted ${id}\n`); return 0; } finally { await ctx.close(); }
}
```

- [ ] **Step 2: Register** the `report-design list` (+ `delete --force`) subcommands in the CLI entry (find where `report-template` commands are registered — likely `packages/cli/src/index.ts`/`cli.ts` with commander — and add a parallel `report-design` command group calling `runList`/`runDelete`). Add `@openldr/report-designer` to `packages/cli/package.json` deps + `pnpm install`.

- [ ] **Step 3: Test** `report-design.test.ts` — `listDesigns` with a fake store (json + text output); `deleteDesign` throws without `--force`. Mirror `report-template.test.ts` if it exists.

- [ ] **Step 4: Verify** — `pnpm --filter @openldr/cli exec vitest run src/report-design.test.ts` (pass), `pnpm --filter @openldr/cli typecheck` (clean).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/report-design.ts packages/cli/src/report-design.test.ts packages/cli/src/index.ts packages/cli/package.json pnpm-lock.yaml
git commit -m "feat(cli): report-design list/delete"
```

---

## Task 8: Full gate + live smoke

- [ ] **Step 1: Whole-repo gate** — `pnpm turbo run typecheck test --force` (from memory: run periodically; NEVER pipe turbo through `tail`). Expect green except the two known flakes (studio `api.test.ts` dedupe flake; parallel-turbo package timeouts — re-run those in isolation). Fix any real cross-package breakage.

- [ ] **Step 2: Live smoke** (per [[playwright-live-troubleshooting]] / MEMORY): `docker compose up -d postgres`; run migrations; start API `node dev.mjs` (NO `--watch`) with `AUTH_DEV_BYPASS=true`; start vite studio. Then: open `/report-designer` → the 3 seeded designs load in the explorer; edit one (move/resize/style/inline) → **Save** → reload the page → the change persisted; **New template** → add elements → Save → it appears in the list + the URL is `/report-designer/:id`; **Delete** → it's gone after reload; `openldr report-design list` shows the rows.

---

## Self-Review

**Spec coverage:** §2 package (pure schema + store + seed) → Tasks 1, 3. §3 DB → Task 2. §4 bootstrap → Task 4. §5 routes → Task 5. §6 studio client + page (`/:id`, Save/New/Delete, explicit Save, seed-backed list) → Task 6. §7 CLI → Task 7. §8 deferrals (autosave, versioning, data-binding/export/preview) untouched. §9 tests present per task. ✓

**Placeholder scan:** The two spots that say "copy the exact test-db setup from `040`/report-builder store test" and "paste the three MOCK_TEMPLATES objects" reference concrete existing code the engineer must transcribe (not invent) — they're pointers to real source, not vague TODOs. Everything else is complete code or exact commands. The `ReportDesignerPage` rewire (Task 6 Step 3) is described as targeted changes against the current file + the `ReportBuilderPage` reference rather than a full re-paste, because the file is large and only its data-source/persistence seams change — the implementer reads both and edits.

**Type consistency:** `ReportDesign`/`ReportDesignSchema`/`createReportDesignStore`/`ReportDesignStore`/`seedReportDesigns`/`reportDesigns`/`report_designs`/`report-design` (audit) names are consistent across package, db, bootstrap, server, studio, cli. Studio's `ReportTemplate` alias = `ReportDesign` keeps existing studio code valid. The `report_designs` columns (`toRow`/`fromRow`) match the migration + `ReportDesignsTable` interface. Routes/client URLs align (`/api/report-designs`).
