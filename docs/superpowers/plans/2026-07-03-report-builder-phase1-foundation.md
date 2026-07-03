# Report Builder — Phase 1: Data Foundation (schema + store + API + CLI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a persisted `ReportTemplate` model — a new `@openldr/report-builder` package (Zod schema + helpers), a `report_templates` DB table + `ReportTemplateStore`, CRUD API routes (`/api/report-templates`) gated to admins/managers, and `openldr report-template` CLI commands — with no UI and no PDF renderer yet.

**Architecture:** A new leaf package `@openldr/report-builder` holds the pure Zod schema (`./pure` subpath, browser-safe) and a Kysely-backed store. The store, routes, and CLI mirror the existing **dashboards** and **forms** feature slices exactly. Block queries reuse `WidgetQuery` from `@openldr/dashboards`; parameters reuse `ReportParamMeta` from `@openldr/reporting`. Later phases (renderer, builder UI, library coexistence) build on this foundation and are out of scope here.

**Tech Stack:** TypeScript (ESM), Zod, Kysely, Fastify, commander (CLI), Vitest + pg-mem.

**Spec:** `docs/superpowers/specs/2026-07-03-report-builder-design.md`

---

## Scope for this plan (Phase 1 only)

**In:** package scaffold; `ReportTemplate` Zod schema + `createEmptyTemplate()` + `interpolate()`; DB migration `040_report_templates` + schema type; `ReportTemplateStore`; `AppContext.reportTemplates` wiring; `/api/report-templates` CRUD routes (role-gated writes, audit); `openldr report-template list|export|import|delete` CLI.

**Out (later phases):** pdfkit renderer + `computeLayout` (Phase 2); builder UI (Phase 3); catalog coexistence / run / schedule wiring (Phase 4). Do **not** touch `ctx.reporting`, `reports-routes.ts`, or the report catalog in this plan.

## File map

| File | Responsibility |
| --- | --- |
| `packages/report-builder/package.json` (create) | New workspace package `@openldr/report-builder` with `.` and `./pure` exports |
| `packages/report-builder/tsconfig.json` (create) | Extends base tsconfig |
| `packages/report-builder/src/schema.ts` (create) | Pure Zod schema + types for `ReportTemplate` (no node imports) |
| `packages/report-builder/src/helpers.ts` (create) | `createEmptyTemplate()`, `interpolate()` — pure |
| `packages/report-builder/src/pure.ts` (create) | Browser-safe barrel: re-exports `schema` + `helpers` |
| `packages/report-builder/src/store.ts` (create) | `ReportTemplateStore` (Kysely over `InternalSchema`) |
| `packages/report-builder/src/index.ts` (create) | Server barrel: re-exports `pure` + `store` |
| `packages/report-builder/src/schema.test.ts` (create) | Schema validation tests |
| `packages/report-builder/src/helpers.test.ts` (create) | Helper tests |
| `packages/report-builder/src/store.test.ts` (create) | Store CRUD tests (pg-mem) |
| `packages/db/src/migrations/internal/040_report_templates.ts` (create) | Table migration |
| `packages/db/src/migrations/internal/040_report_templates.test.ts` (create) | Migration test |
| `packages/db/src/migrations/internal/index.ts` (modify) | Register `040_report_templates` |
| `packages/db/src/schema/internal.ts` (modify) | Add `ReportTemplatesTable` + `report_templates` to `InternalSchema` |
| `packages/bootstrap/src/index.ts` (modify) | Add `reportTemplates: ReportTemplateStore` to `AppContext` + construct it |
| `apps/server/src/report-templates-routes.ts` (create) | `/api/report-templates` CRUD routes |
| `apps/server/src/report-templates-routes.test.ts` (create) | Route tests (CRUD, role gate, audit) |
| `apps/server/src/app.ts` (modify) | Register the new routes |
| `packages/cli/src/report-template.ts` (create) | CLI command handlers |
| `packages/cli/src/report-template.test.ts` (create) | CLI handler tests |
| `packages/cli/src/index.ts` (modify) | Register `report-template` command |

---

## Task 1: Scaffold the `@openldr/report-builder` package

**Files:**
- Create: `packages/report-builder/package.json`
- Create: `packages/report-builder/tsconfig.json`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@openldr/report-builder",
  "version": "0.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./pure": "./src/pure.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo \"no lint\""
  },
  "dependencies": {
    "@openldr/db": "workspace:*",
    "@openldr/dashboards": "workspace:*",
    "@openldr/reporting": "workspace:*",
    "kysely": "^0.27.5",
    "zod": "3.24.0"
  },
  "devDependencies": {
    "pg-mem": "^3.0.14",
    "typescript": "5.7.2",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Install so the workspace link resolves**

Run: `pnpm install`
Expected: completes; `@openldr/report-builder` is linked into the workspace. (No `src` yet — that's fine; typecheck/test run in later tasks.)

- [ ] **Step 4: Commit**

```bash
git add packages/report-builder/package.json packages/report-builder/tsconfig.json pnpm-lock.yaml
git commit -m "feat(report-builder): scaffold @openldr/report-builder package"
```

---

## Task 2: Define the `ReportTemplate` Zod schema

The schema reuses `WidgetQuerySchema` (from `@openldr/dashboards`) for block queries and mirrors `ReportParamMeta` (from `@openldr/reporting`) for parameters. Kept in a dedicated file with **no node imports** so it is browser-safe for the future builder UI.

**Files:**
- Create: `packages/report-builder/src/schema.ts`
- Test: `packages/report-builder/src/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { ReportTemplateSchema } from './schema';

const minimal = {
  id: 'rt1',
  name: 'AMR facility summary',
  description: '',
  category: 'amr',
  status: 'draft',
  page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
  parameters: [],
  rows: [],
};

describe('ReportTemplateSchema', () => {
  it('parses a minimal template and applies defaults', () => {
    const t = ReportTemplateSchema.parse(minimal);
    expect(t.rows).toEqual([]);
    expect(t.page.size).toBe('A4');
  });

  it('parses a header row with a title block and a table cell bound to the primary dataset', () => {
    const t = ReportTemplateSchema.parse({
      ...minimal,
      dataset: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] },
      rows: [
        { id: 'r1', repeat: 'header', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Summary', style: {} } }] },
        { id: 'r2', cells: [{ colSpan: 12, block: { kind: 'table', source: 'primary', columns: [] } }] },
      ],
    });
    expect(t.rows[0].repeat).toBe('header');
    expect(t.rows[1].cells[0].block.kind).toBe('table');
  });

  it('rejects an unknown block kind', () => {
    expect(() => ReportTemplateSchema.parse({
      ...minimal,
      rows: [{ id: 'r1', cells: [{ colSpan: 12, block: { kind: 'nope' } }] }],
    })).toThrow();
  });

  it('rejects a colSpan outside 1..12', () => {
    expect(() => ReportTemplateSchema.parse({
      ...minimal,
      rows: [{ id: 'r1', cells: [{ colSpan: 13, block: { kind: 'divider' } }] }],
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/report-builder test`
Expected: FAIL — `Cannot find module './schema'`.

- [ ] **Step 3: Write `schema.ts`**

```ts
import { z } from 'zod';
import { WidgetQuerySchema } from '@openldr/dashboards';

export const REPORT_CATEGORIES = ['amr', 'operational', 'quality', 'regulatory'] as const;

export const PageSchema = z.object({
  size: z.enum(['A4', 'Letter']).default('A4'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  margins: z.object({
    top: z.number(), right: z.number(), bottom: z.number(), left: z.number(),
  }).default({ top: 40, right: 40, bottom: 40, left: 40 }),
});

// Mirrors @openldr/reporting ReportParamMeta so built reports plug into the existing
// ReportParametersBar in a later phase.
export const ReportParamSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['daterange', 'select', 'text']),
  required: z.boolean().default(false),
  optionsKey: z.string().optional(),
});

const BlockStyleSchema = z.object({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  fontSize: z.number().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
}).default({});

export const BlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('title'), text: z.string().default(''), style: BlockStyleSchema }),
  z.object({ kind: z.literal('text'), content: z.string().default(''), style: BlockStyleSchema }),
  z.object({ kind: z.literal('kpi'), query: WidgetQuerySchema, label: z.string().default(''), format: z.string().optional() }),
  z.object({ kind: z.literal('chart'), query: WidgetQuerySchema, chartType: z.enum(['bar', 'line', 'pie']), visual: z.record(z.unknown()).default({}) }),
  z.object({
    kind: z.literal('table'),
    source: z.union([z.literal('primary'), WidgetQuerySchema]),
    columns: z.array(z.object({ key: z.string(), label: z.string() })).default([]),
  }),
  z.object({ kind: z.literal('image'), src: z.string() }),
  z.object({ kind: z.literal('divider') }),
  z.object({ kind: z.literal('spacer'), height: z.number().default(12) }),
  z.object({ kind: z.literal('pageBreak') }),
]);
export type Block = z.infer<typeof BlockSchema>;

export const ReportCellSchema = z.object({
  colSpan: z.number().int().min(1).max(12),
  block: BlockSchema,
});

export const ReportRowSchema = z.object({
  id: z.string(),
  repeat: z.enum(['header', 'footer']).optional(),
  cells: z.array(ReportCellSchema).default([]),
});

export const ReportTemplateSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(''),
  category: z.enum(REPORT_CATEGORIES).default('operational'),
  status: z.enum(['draft', 'published']).default('draft'),
  page: PageSchema.default({}),
  parameters: z.array(ReportParamSchema).default([]),
  dataset: WidgetQuerySchema.optional(),
  rows: z.array(ReportRowSchema).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type ReportTemplate = z.infer<typeof ReportTemplateSchema>;
export type ReportParam = z.infer<typeof ReportParamSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/report-builder test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/report-builder/src/schema.ts packages/report-builder/src/schema.test.ts
git commit -m "feat(report-builder): ReportTemplate Zod schema (grid rows, blocks, reused WidgetQuery)"
```

---

## Task 3: Add `createEmptyTemplate()` and `interpolate()` helpers

`interpolate()` resolves `{{param.<id>}}` and `{{dataset.<field>}}` tokens in title/text blocks. Pure — used by both the future renderer and the builder preview.

**Files:**
- Create: `packages/report-builder/src/helpers.ts`
- Test: `packages/report-builder/src/helpers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createEmptyTemplate, interpolate } from './helpers';
import { ReportTemplateSchema } from './schema';

describe('createEmptyTemplate', () => {
  it('produces a schema-valid draft with the given id and name', () => {
    const t = createEmptyTemplate('rt1', 'My report');
    expect(() => ReportTemplateSchema.parse(t)).not.toThrow();
    expect(t.id).toBe('rt1');
    expect(t.name).toBe('My report');
    expect(t.status).toBe('draft');
    expect(t.rows).toEqual([]);
  });
});

describe('interpolate', () => {
  const ctx = { params: { facility: 'Ndola' }, dataset: { name: 'Central Lab', total: 1284 } };

  it('replaces param and dataset tokens', () => {
    expect(interpolate('{{param.facility}} — {{dataset.name}}', ctx)).toBe('Ndola — Central Lab');
  });

  it('stringifies non-string dataset values', () => {
    expect(interpolate('n={{dataset.total}}', ctx)).toBe('n=1284');
  });

  it('leaves unknown tokens as empty string', () => {
    expect(interpolate('a{{param.missing}}b', ctx)).toBe('ab');
  });

  it('ignores malformed tokens', () => {
    expect(interpolate('literal {{ not a token }}', ctx)).toBe('literal {{ not a token }}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/report-builder test helpers`
Expected: FAIL — `Cannot find module './helpers'`.

- [ ] **Step 3: Write `helpers.ts`**

```ts
import type { ReportTemplate } from './schema';

export function createEmptyTemplate(id: string, name: string): ReportTemplate {
  return {
    id,
    name,
    description: '',
    category: 'operational',
    status: 'draft',
    page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    parameters: [],
    rows: [],
  };
}

export interface InterpolateContext {
  params?: Record<string, unknown>;
  dataset?: Record<string, unknown>;
}

// Replaces {{param.<id>}} and {{dataset.<field>}} tokens. A token is `{{`, optional space,
// `param.`|`dataset.`, a dotless key of word chars, optional space, `}}`. Anything not matching
// (e.g. `{{ not a token }}`) is left verbatim. Unknown keys resolve to ''.
const TOKEN = /\{\{\s*(param|dataset)\.(\w+)\s*\}\}/g;

export function interpolate(input: string, ctx: InterpolateContext): string {
  return input.replace(TOKEN, (_m, scope: string, key: string) => {
    const bag = scope === 'param' ? ctx.params : ctx.dataset;
    const v = bag?.[key];
    return v === undefined || v === null ? '' : String(v);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/report-builder test helpers`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/report-builder/src/helpers.ts packages/report-builder/src/helpers.test.ts
git commit -m "feat(report-builder): createEmptyTemplate + interpolate helpers"
```

---

## Task 4: Add the `pure` and server barrels

**Files:**
- Create: `packages/report-builder/src/pure.ts`
- Create: `packages/report-builder/src/index.ts`

- [ ] **Step 1: Write `pure.ts` (browser-safe — schema + helpers only, no store)**

```ts
export * from './schema';
export * from './helpers';
```

- [ ] **Step 2: Write `index.ts` (server barrel — adds the store, created in Task 6)**

```ts
export * from './pure';
export * from './store';
```

Note: `./store` does not exist yet, so typecheck will fail until Task 6. That is expected — commit the barrels together with the store in Task 6's final commit. For now, create only `pure.ts` and commit it alone; add `index.ts` in Task 6.

- [ ] **Step 3: Commit `pure.ts`**

```bash
git add packages/report-builder/src/pure.ts
git commit -m "feat(report-builder): browser-safe pure barrel"
```

---

## Task 5: DB migration `040_report_templates` + schema type

**Files:**
- Create: `packages/db/src/migrations/internal/040_report_templates.ts`
- Create: `packages/db/src/migrations/internal/040_report_templates.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/schema/internal.ts`

- [ ] **Step 1: Write the failing migration test**

```ts
import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('040_report_templates', () => {
  it('creates report_templates and round-trips a row', async () => {
    const db = await makeMigratedDb();

    await db
      .insertInto('report_templates')
      .values({
        id: 'rt-1',
        name: 'AMR facility summary',
        description: 'demo',
        category: 'amr',
        status: 'draft',
        page: JSON.stringify({ size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } }),
        parameters: JSON.stringify([]),
        dataset: null,
        rows: JSON.stringify([]),
      } as never)
      .execute();

    const row = await db
      .selectFrom('report_templates')
      .select(['id', 'name', 'category', 'status', 'rows'])
      .where('id', '=', 'rt-1')
      .executeTakeFirstOrThrow();

    expect(row).toMatchObject({ id: 'rt-1', name: 'AMR facility summary', category: 'amr', status: 'draft' });
    expect(row.rows).toBeTruthy();

    await db.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/db test 040_report_templates`
Expected: FAIL — relation `report_templates` does not exist (migration not registered).

- [ ] **Step 3: Write the migration `040_report_templates.ts`**

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('report_templates')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('category', 'text', (c) => c.notNull().defaultTo('operational'))
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('draft'))
    .addColumn('page', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('parameters', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('dataset', 'jsonb')
    .addColumn('rows', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('report_templates').ifExists().execute();
}
```

- [ ] **Step 4: Register the migration in `index.ts`**

Add the import after the `m039` import line (`packages/db/src/migrations/internal/index.ts:40`):

```ts
import * as m040 from './040_report_templates';
```

Add the entry after the `'039_workflow_runs_correlation'` line in the `internalMigrations` record:

```ts
  '040_report_templates': { up: m040.up, down: m040.down },
```

- [ ] **Step 5: Add the table type to `internal.ts`**

Add this interface next to `AppSettingsTable` (near `packages/db/src/schema/internal.ts:456`). `Generated` is already imported in that file:

```ts
export interface ReportTemplatesTable {
  id: string;
  name: string;
  description: Generated<string>;
  category: Generated<string>;
  status: Generated<string>;
  page: unknown;
  parameters: unknown;
  dataset: unknown | null;
  rows: unknown;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
```

Add the property to the `InternalSchema` interface after `app_settings: AppSettingsTable;` (`packages/db/src/schema/internal.ts:504`):

```ts
  report_templates: ReportTemplatesTable;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm -C packages/db test 040_report_templates`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/migrations/internal/040_report_templates.ts packages/db/src/migrations/internal/040_report_templates.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts
git commit -m "feat(db): report_templates table + migration 040"
```

---

## Task 6: `ReportTemplateStore` (Kysely) + server barrel

Mirrors `createDashboardStore` — JSON columns are stringified on write, parsed + Zod-validated on read; idempotent create via `ON CONFLICT DO NOTHING`.

**Files:**
- Create: `packages/report-builder/src/store.ts`
- Create: `packages/report-builder/src/index.ts`
- Test: `packages/report-builder/src/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { createReportTemplateStore } from './store';
import { createEmptyTemplate } from './helpers';

let db: Kysely<any>;
beforeEach(async () => {
  const mem = newDb();
  db = mem.adapters.createKysely();
  await db.schema.createTable('report_templates')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text')
    .addColumn('description', 'text')
    .addColumn('category', 'text')
    .addColumn('status', 'text')
    .addColumn('page', 'jsonb').addColumn('parameters', 'jsonb')
    .addColumn('dataset', 'jsonb').addColumn('rows', 'jsonb')
    .addColumn('created_at', 'text').addColumn('updated_at', 'text').execute();
});

describe('ReportTemplateStore', () => {
  it('creates, lists, gets, updates, deletes', async () => {
    const store = createReportTemplateStore(db);
    const created = await store.create(createEmptyTemplate('rt1', 'Main'));
    expect(created.name).toBe('Main');
    expect((await store.list()).length).toBe(1);
    expect((await store.get('rt1'))?.status).toBe('draft');

    await store.update('rt1', { ...created, name: 'Renamed', status: 'published' });
    const updated = await store.get('rt1');
    expect(updated?.name).toBe('Renamed');
    expect(updated?.status).toBe('published');

    await store.remove('rt1');
    expect(await store.get('rt1')).toBeUndefined();
  });

  it('round-trips dataset + rows JSON', async () => {
    const store = createReportTemplateStore(db);
    const t = createEmptyTemplate('rt2', 'Bound');
    t.dataset = { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] };
    t.rows = [{ id: 'r1', repeat: 'header', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Hi', style: {} } }] }];
    await store.create(t);
    const got = await store.get('rt2');
    expect(got?.dataset).toMatchObject({ mode: 'builder', model: 'observations' });
    expect(got?.rows[0].cells[0].block.kind).toBe('title');
  });

  it('create is idempotent on id — the second create returns the existing row', async () => {
    const store = createReportTemplateStore(db);
    const first = await store.create(createEmptyTemplate('dup', 'First'));
    const second = await store.create({ ...createEmptyTemplate('dup', 'Second') });
    expect(second.id).toBe('dup');
    expect(second.name).toBe(first.name);
    expect((await store.list()).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/report-builder test store`
Expected: FAIL — `Cannot find module './store'`.

- [ ] **Step 3: Write `store.ts`**

```ts
import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { type ReportTemplate, ReportTemplateSchema } from './schema';

function toRow(t: ReportTemplate) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    status: t.status,
    page: JSON.stringify(t.page),
    parameters: JSON.stringify(t.parameters),
    dataset: t.dataset ? JSON.stringify(t.dataset) : null,
    rows: JSON.stringify(t.rows),
  };
}

function fromRow(r: Record<string, unknown>): ReportTemplate {
  const parse = (v: unknown, fallback: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? fallback));
  return ReportTemplateSchema.parse({
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    category: r.category ?? 'operational',
    status: r.status ?? 'draft',
    page: parse(r.page, {}),
    parameters: parse(r.parameters, []),
    dataset: r.dataset == null ? undefined : parse(r.dataset, undefined),
    rows: parse(r.rows, []),
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  });
}

export interface ReportTemplateStore {
  list(): Promise<ReportTemplate[]>;
  get(id: string): Promise<ReportTemplate | undefined>;
  create(t: ReportTemplate): Promise<ReportTemplate>;
  update(id: string, t: ReportTemplate): Promise<ReportTemplate>;
  remove(id: string): Promise<void>;
}

export function createReportTemplateStore(db: Kysely<InternalSchema>): ReportTemplateStore {
  const t = () => db.selectFrom('report_templates');
  const store: ReportTemplateStore = {
    async list() {
      const rows = await t().selectAll().orderBy('name').execute();
      return rows.map((r) => fromRow(r as Record<string, unknown>));
    },
    async get(id) {
      const r = await t().selectAll().where('id', '=', id).executeTakeFirst();
      return r ? fromRow(r as Record<string, unknown>) : undefined;
    },
    async create(tpl) {
      // Idempotent insert: mirrors the dashboard store — a duplicate id no-ops instead of
      // raising a PK violation, and the existing row is returned.
      const inserted = await db
        .insertInto('report_templates')
        .values(toRow(tpl) as never)
        .onConflict((oc) => oc.column('id').doNothing())
        .returningAll()
        .executeTakeFirst();
      if (inserted) return fromRow(inserted as Record<string, unknown>);
      return (await store.get(tpl.id))!;
    },
    async update(id, tpl) {
      await db.updateTable('report_templates').set({ ...toRow({ ...tpl, id }) } as never).where('id', '=', id).execute();
      return (await store.get(id))!;
    },
    async remove(id) { await db.deleteFrom('report_templates').where('id', '=', id).execute(); },
  };
  return store;
}
```

- [ ] **Step 4: Write `index.ts` (server barrel)**

```ts
export * from './pure';
export * from './store';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C packages/report-builder test`
Expected: PASS (all schema + helper + store tests).

- [ ] **Step 6: Typecheck the package**

Run: `pnpm -C packages/report-builder typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/report-builder/src/store.ts packages/report-builder/src/index.ts packages/report-builder/src/store.test.ts
git commit -m "feat(report-builder): ReportTemplateStore (Kysely) + server barrel"
```

---

## Task 7: Wire `reportTemplates` into `AppContext`

**Files:**
- Modify: `packages/bootstrap/src/index.ts`
- Modify: `packages/bootstrap/package.json`

- [ ] **Step 1: Add the dependency to bootstrap**

In `packages/bootstrap/package.json`, add to `dependencies` (alphabetical near the other `@openldr/*` entries):

```json
    "@openldr/report-builder": "workspace:*",
```

Run: `pnpm install`
Expected: completes; bootstrap can import `@openldr/report-builder`.

- [ ] **Step 2: Import the store factory + type**

Add an import near the other `@openldr/*` imports at the top of `packages/bootstrap/src/index.ts`:

```ts
import { createReportTemplateStore, type ReportTemplateStore } from '@openldr/report-builder';
```

- [ ] **Step 3: Add the field to the `AppContext` interface**

In the `AppContext` interface, add after `dashboards: DashboardsApi;` (`packages/bootstrap/src/index.ts:147`):

```ts
  reportTemplates: ReportTemplateStore;
```

- [ ] **Step 4: Construct the store**

Near where `dashboardStore` is created (`const dashboardStore = createDashboardStore(internal.db);` at `packages/bootstrap/src/index.ts:268`), add:

```ts
  const reportTemplateStore = createReportTemplateStore(internal.db);
```

Then add `reportTemplates: reportTemplateStore,` to the returned context object next to `dashboards,` (near `packages/bootstrap/src/index.ts:636`).

- [ ] **Step 5: Typecheck bootstrap**

Run: `pnpm -C packages/bootstrap typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/index.ts packages/bootstrap/package.json pnpm-lock.yaml
git commit -m "feat(bootstrap): expose reportTemplates store on AppContext"
```

---

## Task 8: `/api/report-templates` CRUD routes

Writes gated to `lab_admin` + `lab_manager` (the `MANAGE` preHandler pattern from `reports-routes.ts`); reads open. Audit on create/update/delete via `recordAudit` (as forms/dashboards routes do).

**Files:**
- Create: `apps/server/src/report-templates-routes.ts`
- Create: `apps/server/src/report-templates-routes.test.ts`
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerReportTemplateRoutes } from './report-templates-routes';
import './auth-plugin';

function fakeCtx() {
  const data: any[] = [];
  const auditEvents: any[] = [];
  return {
    reportTemplates: {
      list: async () => data,
      get: async (id: string) => data.find((d) => d.id === id),
      create: async (d: any) => { data.push(d); return d; },
      update: async (id: string, d: any) => { const i = data.findIndex((x) => x.id === id); data[i] = d; return d; },
      remove: async (id: string) => { const i = data.findIndex((x) => x.id === id); if (i >= 0) data.splice(i, 1); },
    },
    audit: { record: async (e: any) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    __auditEvents: auditEvents,
  } as any;
}

const minimal = {
  id: 'rt1', name: 'Report', description: '', category: 'operational', status: 'draft',
  page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
  parameters: [], rows: [],
};

function appWith(ctx: any, roles: string[] = ['lab_admin']) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { (req as any).user = { id: 'u', username: 'u', displayName: null, roles }; });
  registerReportTemplateRoutes(app, ctx);
  return app;
}

describe('report-template routes', () => {
  it('creates then lists a template (admin)', async () => {
    const ctx = fakeCtx();
    const app = appWith(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/report-templates', payload: minimal });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/api/report-templates' });
    expect(list.json().length).toBe(1);
    expect(ctx.__auditEvents.some((e: any) => e.action === 'report-template.create')).toBe(true);
  });

  it('rejects an invalid payload with 400', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/report-templates', payload: { id: 'x' } });
    expect(res.statusCode).toBe(400);
  });

  it('403s a create from a non-manager role', async () => {
    const app = appWith(fakeCtx(), ['lab_technician']);
    const res = await app.inject({ method: 'POST', url: '/api/report-templates', payload: minimal });
    expect(res.statusCode).toBe(403);
  });

  it('404s GET of an unknown id', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'GET', url: '/api/report-templates/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('updates and deletes (admin)', async () => {
    const ctx = fakeCtx();
    const app = appWith(ctx);
    await app.inject({ method: 'POST', url: '/api/report-templates', payload: minimal });
    const upd = await app.inject({ method: 'PUT', url: '/api/report-templates/rt1', payload: { ...minimal, name: 'Renamed' } });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().name).toBe('Renamed');
    const del = await app.inject({ method: 'DELETE', url: '/api/report-templates/rt1' });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/report-templates' })).json().length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/server test report-templates-routes`
Expected: FAIL — `Cannot find module './report-templates-routes'`.

- [ ] **Step 3: Write `report-templates-routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { ReportTemplateSchema } from '@openldr/report-builder/pure';
import { recordAudit } from './audit-helper';
import { requireRole } from './rbac';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerReportTemplateRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  const MANAGE = { preHandler: requireRole('lab_admin', 'lab_manager') };

  app.get('/api/report-templates', async () => ctx.reportTemplates.list());

  app.get('/api/report-templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await ctx.reportTemplates.get(id);
    if (!t) { reply.code(404); return { error: 'not found' }; }
    return t;
  });

  app.post('/api/report-templates', MANAGE, async (req, reply) => {
    const p = ReportTemplateSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const created = await ctx.reportTemplates.create(p.data);
    await recordAudit(ctx, req, { action: 'report-template.create', entityType: 'report-template', entityId: created.id, before: null, after: created });
    reply.code(201);
    return created;
  });

  app.put('/api/report-templates/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = ReportTemplateSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const before = await ctx.reportTemplates.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    const after = await ctx.reportTemplates.update(id, p.data);
    await recordAudit(ctx, req, { action: 'report-template.update', entityType: 'report-template', entityId: id, before, after });
    return after;
  });

  app.delete('/api/report-templates/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await ctx.reportTemplates.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    await ctx.reportTemplates.remove(id);
    await recordAudit(ctx, req, { action: 'report-template.delete', entityType: 'report-template', entityId: id, before, after: null });
    reply.code(204);
    return null;
  });
}
```

- [ ] **Step 4: Register in `app.ts`**

Add the import next to `registerFormsRoutes` (`apps/server/src/app.ts:17`):

```ts
import { registerReportTemplateRoutes } from './report-templates-routes';
```

Add the call next to `registerFormsRoutes(app, ctx);` (`apps/server/src/app.ts:82`):

```ts
  registerReportTemplateRoutes(app, ctx);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C apps/server test report-templates-routes`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/report-templates-routes.ts apps/server/src/report-templates-routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): /api/report-templates CRUD routes (role-gated writes + audit)"
```

---

## Task 9: `openldr report-template` CLI commands

Mirrors `packages/cli/src/forms.ts` (uses `createAppContext(loadConfig())` + `ctx.close()`). Provides `list`, `export <id>`, `import <file>`, `delete <id>` (destructive requires `--force`), sharing the store via `AppContext`.

**Files:**
- Create: `packages/cli/src/report-template.ts`
- Create: `packages/cli/src/report-template.test.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Write the failing test (pure functions, injected store)**

The handlers take a store so they can be unit-tested without a live `AppContext`.

```ts
import { describe, it, expect, vi } from 'vitest';
import { listTemplates, exportTemplate, importTemplate, deleteTemplate } from './report-template';
import { createEmptyTemplate } from '@openldr/report-builder/pure';

function fakeStore(seed: any[] = []) {
  const data = [...seed];
  return {
    list: async () => data,
    get: async (id: string) => data.find((d) => d.id === id),
    create: async (d: any) => { data.push(d); return d; },
    update: async (id: string, d: any) => { const i = data.findIndex((x) => x.id === id); data[i] = d; return d; },
    remove: async (id: string) => { const i = data.findIndex((x) => x.id === id); if (i >= 0) data.splice(i, 1); },
    __data: data,
  };
}

describe('report-template CLI handlers', () => {
  it('listTemplates emits ids and names', async () => {
    const out: string[] = [];
    const write = (s: string) => { out.push(s); };
    await listTemplates(fakeStore([createEmptyTemplate('rt1', 'Main')]) as any, { json: false }, write);
    expect(out.join('')).toContain('rt1');
    expect(out.join('')).toContain('Main');
  });

  it('exportTemplate writes the JSON of a known template', async () => {
    const out: string[] = [];
    await exportTemplate(fakeStore([createEmptyTemplate('rt1', 'Main')]) as any, 'rt1', (s) => out.push(s));
    expect(JSON.parse(out.join('')).id).toBe('rt1');
  });

  it('exportTemplate throws on unknown id', async () => {
    await expect(exportTemplate(fakeStore() as any, 'nope', () => {})).rejects.toThrow(/not found/);
  });

  it('importTemplate creates a validated template from JSON', async () => {
    const store = fakeStore();
    const json = JSON.stringify(createEmptyTemplate('rt2', 'Imported'));
    await importTemplate(store as any, json);
    expect(store.__data.find((d) => d.id === 'rt2')?.name).toBe('Imported');
  });

  it('importTemplate rejects invalid JSON payloads', async () => {
    await expect(importTemplate(fakeStore() as any, '{"id":"x"}')).rejects.toThrow();
  });

  it('deleteTemplate requires force', async () => {
    const store = fakeStore([createEmptyTemplate('rt1', 'Main')]);
    await expect(deleteTemplate(store as any, 'rt1', { force: false })).rejects.toThrow(/--force/);
    expect(store.__data.length).toBe(1);
    await deleteTemplate(store as any, 'rt1', { force: true });
    expect(store.__data.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/cli test report-template`
Expected: FAIL — `Cannot find module './report-template'`.

- [ ] **Step 3: Write `report-template.ts`**

```ts
import { readFileSync } from 'node:fs';
import { createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { ReportTemplateSchema, type ReportTemplate } from '@openldr/report-builder/pure';
import type { ReportTemplateStore } from '@openldr/report-builder';

type Writer = (s: string) => void;
const stdout: Writer = (s) => process.stdout.write(s);

// ── Pure handlers (store injected → unit-testable) ──────────────────────────
export async function listTemplates(store: ReportTemplateStore, opts: { json: boolean }, write: Writer = stdout): Promise<void> {
  const templates = await store.list();
  if (opts.json) { write(JSON.stringify(templates, null, 2) + '\n'); return; }
  const lines = templates.map((t) => `${t.id}\t${t.name}\t${t.category}\t${t.status}\t${t.rows.length} rows`);
  write((lines.length ? lines.join('\n') : '(no report templates)') + '\n');
}

export async function exportTemplate(store: ReportTemplateStore, id: string, write: Writer = stdout): Promise<void> {
  const t = await store.get(id);
  if (!t) throw new Error(`report template not found: ${id}`);
  write(JSON.stringify(t, null, 2) + '\n');
}

export async function importTemplate(store: ReportTemplateStore, json: string): Promise<ReportTemplate> {
  const parsed = ReportTemplateSchema.parse(JSON.parse(json));
  return store.create(parsed);
}

export async function deleteTemplate(store: ReportTemplateStore, id: string, opts: { force: boolean }): Promise<void> {
  if (!opts.force) throw new Error('refusing to delete without --force');
  await store.remove(id);
}

// ── Command entrypoints (open a real AppContext) ────────────────────────────
export async function runList(opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { await listTemplates(ctx.reportTemplates, opts); return 0; } finally { await ctx.close(); }
}
export async function runExport(id: string): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { await exportTemplate(ctx.reportTemplates, id); return 0; } finally { await ctx.close(); }
}
export async function runImport(file: string): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { const t = await importTemplate(ctx.reportTemplates, readFileSync(file, 'utf8')); process.stdout.write(`imported ${t.id}\n`); return 0; } finally { await ctx.close(); }
}
export async function runDelete(id: string, opts: { force: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { await deleteTemplate(ctx.reportTemplates, id, opts); process.stdout.write(`deleted ${id}\n`); return 0; } finally { await ctx.close(); }
}
```

- [ ] **Step 4: Register the command in `index.ts`**

Add the import near `runFormsList` (`packages/cli/src/index.ts:8`):

```ts
import { runList as runReportTemplateList, runExport as runReportTemplateExport, runImport as runReportTemplateImport, runDelete as runReportTemplateDelete } from './report-template';
```

Add the command block after the `forms` command block (`packages/cli/src/index.ts` around line 245, after the forms `.action(...)` closes):

```ts
const reportTemplate = program.command('report-template').description('Report Builder templates');
reportTemplate.command('list').description('List report templates').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runReportTemplateList(opts); } catch (err) { process.stderr.write(`report-template list failed: ${redactError(err)}\n`); process.exitCode = 1; }
});
reportTemplate.command('export <id>').description('Print a report template as JSON').action(async (id: string) => {
  try { process.exitCode = await runReportTemplateExport(id); } catch (err) { process.stderr.write(`report-template export failed: ${redactError(err)}\n`); process.exitCode = 1; }
});
reportTemplate.command('import <file>').description('Create a report template from a JSON file').action(async (file: string) => {
  try { process.exitCode = await runReportTemplateImport(file); } catch (err) { process.stderr.write(`report-template import failed: ${redactError(err)}\n`); process.exitCode = 1; }
});
reportTemplate.command('delete <id>').description('Delete a report template (destructive)').option('--force', 'confirm deletion', false).action(async (id: string, opts: { force: boolean }) => {
  try { process.exitCode = await runReportTemplateDelete(id, opts); } catch (err) { process.stderr.write(`report-template delete failed: ${redactError(err)}\n`); process.exitCode = 1; }
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C packages/cli test report-template`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck the CLI package**

Run: `pnpm -C packages/cli typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/report-template.ts packages/cli/src/report-template.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): openldr report-template list|export|import|delete"
```

---

## Task 10: Full gate — cross-package typecheck + tests

Shared-type changes (the new `InternalSchema` member, the new AppContext field) can break consumers that the per-package runs above don't cover. Run the forced gate.

- [ ] **Step 1: Cross-package typecheck (force — turbo cache hides cross-package breakage)**

Run: `pnpm turbo run typecheck --force`
Expected: all packages pass. If `@openldr/bootstrap`, `apps/server`, or `packages/db` fail, fix the referenced type mismatch before proceeding.

- [ ] **Step 2: Targeted test sweep for the touched packages**

Run: `pnpm -C packages/report-builder test && pnpm -C packages/db test && pnpm -C apps/server test && pnpm -C packages/cli test`
Expected: all pass. (Do not pipe turbo through `tail`; run package tests directly per repo convention.)

- [ ] **Step 3: Final commit if the gate produced any fixups**

```bash
git add -A
git commit -m "chore(report-builder): green cross-package gate for phase 1 foundation"
```

---

## Self-review notes (already reconciled)

- **Spec coverage:** schema (§Data model), store + migration + AppContext (§Infrastructure > Store), API (§Infrastructure > API, writes gated to admin+manager per §Permissions), CLI (§Infrastructure > CLI parity) all have tasks. Renderer/UI/coexistence are explicitly deferred to Phases 2–4 per the spec's phasing.
- **Type consistency:** `ReportTemplate`/`ReportTemplateSchema`/`createReportTemplateStore`/`ReportTemplateStore`/`createEmptyTemplate`/`interpolate` names are identical across schema, store, routes, and CLI tasks. Route + CLI import the schema from `@openldr/report-builder/pure` (browser-safe) and the store type from `@openldr/report-builder` (server).
- **No placeholders:** every code step contains full code; every run step states the exact command and expected result.
- **Reused contracts:** block queries use `WidgetQuerySchema` from `@openldr/dashboards`; parameters mirror `ReportParamMeta` from `@openldr/reporting` — no new query machinery invented.
