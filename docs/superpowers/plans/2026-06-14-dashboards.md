# P2-DASH — Custom Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static report-card Dashboard with a Metabase-like system: a drag-resize widget grid, custom widgets built via a visual (Kysely-compiled) query builder plus a gated raw-SQL escape hatch, dashboard-level filters, and multi-dashboard CRUD — full corlix parity.

**Architecture:** A new `packages/dashboards` domain package owns the widget/query types, a query-model registry over `ExternalSchema`, a pure builder→Kysely compiler (returns the existing `ReportResult`), a gated SQL runner, and a `DashboardStore` persisted in the internal Postgres DB. Fastify routes under `/api/dashboards*` are wired through `bootstrap` exactly like `reporting`. The `apps/web` frontend adds a zustand store, a `react-grid-layout` grid, six widget renderers, and a CodeMirror-backed widget editor.

**Tech Stack:** TypeScript (ESM, strict), Kysely, Fastify, Zod, Vitest; React 18 + Vite + Tailwind v4 + shadcn + recharts (existing); new deps `react-grid-layout`, `zustand`, CodeMirror 6.

**Spec:** `docs/superpowers/specs/2026-06-14-dashboards-design.md`

**Conventions:** ESM, `import type`, no extension on local imports, barrel `src/index.ts`. Commits `<type>(dashboards): <desc> (P2-DASH)`, **no Co-Authored-By trailer**, gpg-sign off (`git -c commit.gpgsign=false commit`). Run all commands from repo root in the `feat/p2-dashboards` worktree. Verify with `pnpm -w turbo typecheck lint test` and `pnpm -w depcruise` (or `npx dependency-cruiser`).

---

## File Structure

**New package `packages/dashboards/`**
- `package.json`, `tsconfig.json`, `tsup.config.ts` — package scaffold (copy `packages/reporting` shape).
- `src/index.ts` — barrel.
- `src/types.ts` — `WidgetType`, `WidgetConfig`, `WidgetQuery`, `WidgetVisual`, `Dimension`, `Metric`, `QueryFilter`, `DashboardFilterDef`, `LayoutItem`, `Dashboard`.
- `src/models/registry.ts` — `QueryModel[]` over `ExternalSchema`; `getModel`, `listModels`.
- `src/compile.ts` — `compileBuilderQuery(model, query)` → Kysely query; `runBuilderQuery(db, query)` → `ReportResultData`.
- `src/sql-runner.ts` — `validateSelectSql`, `runSqlQuery(db, sql, params, opts)`.
- `src/store.ts` — `DashboardStore` interface + `createDashboardStore(db)` over `Kysely<InternalSchema>`.
- `src/seed.ts` — `DEFAULT_DASHBOARD` builder-only seed.

**Internal DB**
- `packages/db/src/migrations/internal/011_dashboards.ts` — `dashboards` table.
- `packages/db/src/migrations/internal/index.ts` — register `011`.
- `packages/db/src/schema/internal.ts` — add `DashboardsTable` + `dashboards` to `InternalSchema`.

**Config**
- `packages/config/src/schema.ts` — add `DASHBOARD_SQL_ENABLED`, `DASHBOARD_SQL_TIMEOUT_MS`, `DASHBOARD_SQL_ROW_CAP`.

**Bootstrap**
- `packages/bootstrap/src/index.ts` — add `dashboards` + `dashboardQuery` to `AppContext`.

**Server**
- `apps/server/src/dashboards-routes.ts` — `/api/dashboards*` routes.
- `apps/server/src/app.ts` — register the routes.

**Web (`apps/web/src/dashboard/`)**
- `store.ts` — zustand store.
- `api.ts` additions (in `apps/web/src/api.ts`) — dashboard fetch helpers + types.
- `DashboardPage.tsx`, `DashboardGrid.tsx`, `DashboardWidget.tsx`.
- `widgets/ChartWidget.tsx`, `widgets/KpiWidget.tsx`, `widgets/GaugeWidget.tsx`, `widgets/ProgressWidget.tsx`, `widgets/TrafficLightWidget.tsx`, `widgets/TableWidget.tsx`, `widgets/index.tsx` (router).
- `editor/WidgetEditorDialog.tsx`, `editor/BuilderForm.tsx`, `editor/SqlForm.tsx`.
- `filters/DashboardFilterBar.tsx`, `filters/DashboardFilterEditor.tsx`.
- `apps/web/src/App.tsx` — route `/` → `DashboardPage`.

**Tests** colocated `*.test.ts(x)`; e2e `e2e/tests/dashboard.spec.ts`.

---

## PHASE 1 — Domain package: types, registry, compiler

### Task 1: Scaffold `packages/dashboards`

**Files:**
- Create: `packages/dashboards/package.json`, `packages/dashboards/tsconfig.json`, `packages/dashboards/tsup.config.ts`, `packages/dashboards/src/index.ts`

- [ ] **Step 1: Copy the reporting package scaffold**

Read `packages/reporting/package.json`, `tsconfig.json`, `tsup.config.ts`. Create the three files identically but with name `@openldr/dashboards`. `package.json` dependencies: `kysely`, `zod`, `@openldr/db` (workspace:*). devDependencies mirror reporting. Keep `"type": "module"`, `exports` → `./dist/index.js`, scripts `build`/`build:check`/`typecheck`/`test`.

```json
{
  "name": "@openldr/dashboards",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsup", "build:check": "tsc -p tsconfig.json --noEmit",
    "typecheck": "tsc -p tsconfig.json --noEmit", "test": "vitest run"
  },
  "dependencies": { "kysely": "0.27.5", "zod": "3.24.0", "@openldr/db": "workspace:*" },
  "devDependencies": { "tsup": "8.3.5", "typescript": "5.7.2", "vitest": "2.1.8" }
}
```

- [ ] **Step 2: Create the barrel**

`packages/dashboards/src/index.ts`:
```ts
export * from './types';
export * from './models/registry';
export * from './compile';
export * from './sql-runner';
export * from './store';
export * from './seed';
```
(Files referenced are created in later tasks; the barrel will not typecheck until then — that's expected.)

- [ ] **Step 3: Install + verify workspace recognises the package**

Run: `pnpm install`
Expected: lockfile updates, `@openldr/dashboards` linked, no error.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboards/package.json packages/dashboards/tsconfig.json packages/dashboards/tsup.config.ts packages/dashboards/src/index.ts pnpm-lock.yaml
git -c commit.gpgsign=false commit -m "feat(dashboards): scaffold @openldr/dashboards package (P2-DASH)"
```

---

### Task 2: Core types

**Files:**
- Create: `packages/dashboards/src/types.ts`
- Test: `packages/dashboards/src/types.test.ts`

- [ ] **Step 1: Write the failing test** (`types.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { WidgetConfigSchema } from './types';

describe('WidgetConfigSchema', () => {
  it('accepts a builder widget', () => {
    const ok = WidgetConfigSchema.safeParse({
      id: 'w1', type: 'kpi', title: 'Orders', refreshIntervalSec: 0, visual: {},
      query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] },
    });
    expect(ok.success).toBe(true);
  });
  it('accepts a sql widget', () => {
    const ok = WidgetConfigSchema.safeParse({
      id: 'w2', type: 'table', title: 'Raw', refreshIntervalSec: 0, visual: {},
      query: { mode: 'sql', sql: 'select 1 as n' },
    });
    expect(ok.success).toBe(true);
  });
  it('rejects an unknown widget type', () => {
    const bad = WidgetConfigSchema.safeParse({
      id: 'w3', type: 'nope', title: 'x', refreshIntervalSec: 0, visual: {},
      query: { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] },
    });
    expect(bad.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/dashboards test`
Expected: FAIL — cannot find `./types`.

- [ ] **Step 3: Implement `types.ts`**

```ts
import { z } from 'zod';

export const WIDGET_TYPES = [
  'kpi', 'line-chart', 'bar-chart', 'area-chart', 'row-chart', 'pie-chart',
  'scatter-plot', 'funnel', 'progress-bar', 'gauge', 'table', 'traffic-light',
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const AGGS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const;
export type Agg = (typeof AGGS)[number];

export const FILTER_OPS = ['eq', 'in', 'contains', 'gte', 'lte', 'between'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export type DimensionKind = 'string' | 'date' | 'number';
export type DateGrain = 'day' | 'week' | 'month' | 'year';

export const MetricSchema = z.object({
  key: z.string(), label: z.string().optional(),
  agg: z.enum(AGGS), column: z.string().optional(),
});
export type Metric = z.infer<typeof MetricSchema>;

export const DimensionRefSchema = z.object({ key: z.string(), grain: z.enum(['day', 'week', 'month', 'year']).optional() });
export type DimensionRef = z.infer<typeof DimensionRefSchema>;

export const QueryFilterSchema = z.object({
  dimension: z.string(), op: z.enum(FILTER_OPS),
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]).nullable(),
});
export type QueryFilter = z.infer<typeof QueryFilterSchema>;

export const WidgetQuerySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('builder'),
    model: z.string(),
    metric: MetricSchema,
    dimension: DimensionRefSchema.optional(),
    filters: z.array(QueryFilterSchema).default([]),
    variableBindings: z.record(z.string()).optional(),
  }),
  z.object({
    mode: z.literal('sql'),
    sql: z.string(),
    variableBindings: z.record(z.string()).optional(),
  }),
]);
export type WidgetQuery = z.infer<typeof WidgetQuerySchema>;

export const WidgetVisualSchema = z.object({
  color: z.string().optional(), secondaryColor: z.string().optional(),
  xAxisKey: z.string().optional(), yAxisKey: z.string().optional(), sizeKey: z.string().optional(),
  suffix: z.string().optional(), trendEnabled: z.boolean().optional(),
  greenThreshold: z.number().optional(), amberThreshold: z.number().optional(),
  goalValue: z.number().optional(), minValue: z.number().optional(), maxValue: z.number().optional(),
  innerRadius: z.number().optional(), showLegend: z.boolean().optional(),
  columns: z.array(z.object({ key: z.string(), label: z.string() })).optional(),
  pageSize: z.number().optional(),
}).passthrough();
export type WidgetVisual = z.infer<typeof WidgetVisualSchema>;

export const WidgetConfigSchema = z.object({
  id: z.string(), type: z.enum(WIDGET_TYPES), title: z.string(),
  query: WidgetQuerySchema, refreshIntervalSec: z.number().default(0),
  visual: WidgetVisualSchema.default({}),
});
export type WidgetConfig = z.infer<typeof WidgetConfigSchema>;

export const LayoutItemSchema = z.object({
  i: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number(),
  minW: z.number().optional(), minH: z.number().optional(),
});
export type LayoutItem = z.infer<typeof LayoutItemSchema>;

export const DashboardFilterDefSchema = z.object({
  id: z.string(), label: z.string(),
  type: z.enum(['text', 'number', 'date', 'date-range']),
  defaultValue: z.union([z.string(), z.number()]).nullable().optional(),
  defaultRange: z.object({ from: z.string(), to: z.string() }).nullable().optional(),
  options: z.array(z.string()).optional(),
});
export type DashboardFilterDef = z.infer<typeof DashboardFilterDefSchema>;

export const DashboardSchema = z.object({
  id: z.string(), ownerId: z.string().nullable().default(null), name: z.string(),
  layout: z.array(LayoutItemSchema).default([]),
  widgets: z.array(WidgetConfigSchema).default([]),
  filters: z.array(DashboardFilterDefSchema).default([]),
  refreshIntervalSec: z.number().default(0), isDefault: z.boolean().default(false),
  createdAt: z.string().optional(), updatedAt: z.string().optional(),
});
export type Dashboard = z.infer<typeof DashboardSchema>;
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/dashboards test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/types.ts packages/dashboards/src/types.test.ts
git -c commit.gpgsign=false commit -m "feat(dashboards): widget/dashboard zod types (P2-DASH)"
```

---

### Task 3: Query-model registry

**Files:**
- Create: `packages/dashboards/src/models/registry.ts`
- Test: `packages/dashboards/src/models/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { listModels, getModel } from './registry';

describe('model registry', () => {
  it('exposes service_requests with count metric and date dimension', () => {
    const m = getModel('service_requests');
    expect(m).toBeDefined();
    expect(m!.metrics.some((x) => x.agg === 'count')).toBe(true);
    const authored = m!.dimensions.find((d) => d.key === 'authored_on');
    expect(authored?.kind).toBe('date');
    expect(authored?.dateGrain).toContain('month');
  });
  it('every dimension key is unique per model', () => {
    for (const m of listModels()) {
      const cols = m.dimensions.map((d) => d.key);
      expect(new Set(cols).size).toBe(cols.length);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/dashboards test registry`
Expected: FAIL — cannot find `./registry`.

- [ ] **Step 3: Implement `registry.ts`**

Columns are taken verbatim from `packages/db/src/schema/external.ts`. Only curated, non-PHI-identifying columns are exposed.

```ts
import type { ExternalSchema } from '@openldr/db';
import type { Agg, DateGrain, DimensionKind } from '../types';

export interface ModelDimension { key: string; label: string; column: string; kind: DimensionKind; dateGrain?: DateGrain[] }
export interface ModelMetric { key: string; label: string; agg: Agg; column?: string }
export interface QueryModel { id: string; label: string; table: keyof ExternalSchema; dimensions: ModelDimension[]; metrics: ModelMetric[] }

const DATE_GRAINS: DateGrain[] = ['day', 'week', 'month', 'year'];
const COUNT: ModelMetric = { key: 'count', label: 'Count', agg: 'count' };

export const MODELS: QueryModel[] = [
  {
    id: 'service_requests', label: 'Test Orders', table: 'service_requests',
    dimensions: [
      { key: 'status', label: 'Status', column: 'status', kind: 'string' },
      { key: 'intent', label: 'Intent', column: 'intent', kind: 'string' },
      { key: 'priority', label: 'Priority', column: 'priority', kind: 'string' },
      { key: 'code_text', label: 'Test', column: 'code_text', kind: 'string' },
      { key: 'authored_on', label: 'Authored', column: 'authored_on', kind: 'date', dateGrain: DATE_GRAINS },
    ],
    metrics: [COUNT, { key: 'distinct_subjects', label: 'Distinct Patients', agg: 'count_distinct', column: 'subject_ref' }],
  },
  {
    id: 'observations', label: 'Results', table: 'observations',
    dimensions: [
      { key: 'status', label: 'Status', column: 'status', kind: 'string' },
      { key: 'code_text', label: 'Analyte', column: 'code_text', kind: 'string' },
      { key: 'interpretation_code', label: 'Interpretation', column: 'interpretation_code', kind: 'string' },
      { key: 'value_unit', label: 'Unit', column: 'value_unit', kind: 'string' },
      { key: 'effective_date_time', label: 'Effective', column: 'effective_date_time', kind: 'date', dateGrain: DATE_GRAINS },
    ],
    metrics: [COUNT, { key: 'avg_value', label: 'Avg Value', agg: 'avg', column: 'value_quantity' }],
  },
  {
    id: 'diagnostic_reports', label: 'Reports', table: 'diagnostic_reports',
    dimensions: [
      { key: 'status', label: 'Status', column: 'status', kind: 'string' },
      { key: 'code_text', label: 'Report Type', column: 'code_text', kind: 'string' },
      { key: 'issued', label: 'Issued', column: 'issued', kind: 'date', dateGrain: DATE_GRAINS },
    ],
    metrics: [COUNT],
  },
  {
    id: 'specimens', label: 'Specimens', table: 'specimens',
    dimensions: [
      { key: 'status', label: 'Status', column: 'status', kind: 'string' },
      { key: 'type_text', label: 'Type', column: 'type_text', kind: 'string' },
      { key: 'origin', label: 'Origin', column: 'origin', kind: 'string' },
      { key: 'received_time', label: 'Received', column: 'received_time', kind: 'date', dateGrain: DATE_GRAINS },
    ],
    metrics: [COUNT],
  },
  {
    id: 'patients', label: 'Patients', table: 'patients',
    dimensions: [
      { key: 'gender', label: 'Gender', column: 'gender', kind: 'string' },
      { key: 'managing_organization', label: 'Facility', column: 'managing_organization', kind: 'string' },
    ],
    metrics: [COUNT],
  },
  {
    id: 'organizations', label: 'Facilities', table: 'organizations',
    dimensions: [{ key: 'type_text', label: 'Type', column: 'type_text', kind: 'string' }],
    metrics: [COUNT],
  },
  {
    id: 'locations', label: 'Locations', table: 'locations',
    dimensions: [
      { key: 'status', label: 'Status', column: 'status', kind: 'string' },
      { key: 'type_text', label: 'Type', column: 'type_text', kind: 'string' },
    ],
    metrics: [COUNT],
  },
];

export function listModels(): QueryModel[] { return MODELS; }
export function getModel(id: string): QueryModel | undefined { return MODELS.find((m) => m.id === id); }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/dashboards test registry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/models/registry.ts packages/dashboards/src/models/registry.test.ts
git -c commit.gpgsign=false commit -m "feat(dashboards): query-model registry over external schema (P2-DASH)"
```

---

### Task 4: Builder→Kysely compiler

**Files:**
- Create: `packages/dashboards/src/compile.ts`
- Test: `packages/dashboards/src/compile.test.ts`

The compiler validates every referenced model/dimension/metric column against the registry, then builds a Kysely query. SQL assertions use Kysely's `SqliteDialect` purely to render deterministic SQL in tests (no DB connection needed).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { Kysely, SqliteDialect } from 'kysely';
import { compileBuilderQuery } from './compile';
import { getModel } from './models/registry';

// A dummy Kysely instance just for .compile() — no real DB.
const db = new Kysely<any>({ dialect: new SqliteDialect({ database: {} as any }) });

describe('compileBuilderQuery', () => {
  it('builds count grouped by a string dimension', () => {
    const model = getModel('service_requests')!;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests',
      metric: { key: 'count', agg: 'count' },
      dimension: { key: 'status' }, filters: [],
    }).compile();
    expect(sql).toContain('from "service_requests"');
    expect(sql).toContain('count(*)');
    expect(sql).toContain('group by');
  });

  it('rejects an unknown dimension', () => {
    const model = getModel('service_requests')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests',
      metric: { key: 'count', agg: 'count' },
      dimension: { key: 'evil_column' }, filters: [],
    })).toThrow(/unknown dimension/i);
  });

  it('rejects a metric column not in the model', () => {
    const model = getModel('service_requests')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests',
      metric: { key: 'x', agg: 'avg', column: 'ssn' }, filters: [],
    })).toThrow(/unknown metric column/i);
  });

  it('applies an eq filter as a parameter', () => {
    const model = getModel('service_requests')!;
    const { parameters } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests',
      metric: { key: 'count', agg: 'count' }, filters: [{ dimension: 'status', op: 'eq', value: 'active' }],
    }).compile();
    expect(parameters).toContain('active');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/dashboards test compile`
Expected: FAIL — cannot find `./compile`.

- [ ] **Step 3: Implement `compile.ts`**

```ts
import { type Kysely, sql, type SelectQueryBuilder } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { QueryModel, ModelDimension } from './models/registry';
import type { WidgetQuery, Metric, QueryFilter, DateGrain } from './types';
import type { ReportResultData, ReportColumn, ChartHint } from '@openldr/reporting';

type BuilderQuery = Extract<WidgetQuery, { mode: 'builder' }>;
type AnyQB = SelectQueryBuilder<ExternalSchema, keyof ExternalSchema, unknown>;

function dim(model: QueryModel, key: string): ModelDimension {
  const d = model.dimensions.find((x) => x.key === key);
  if (!d) throw new Error(`unknown dimension: ${key}`);
  return d;
}

function metricExpr(model: QueryModel, m: Metric) {
  if (m.agg === 'count') return sql<number>`count(*)`;
  if (!m.column) throw new Error(`metric ${m.agg} requires a column`);
  const knownAsDimension = model.dimensions.some((d) => d.column === m.column);
  const knownAsMetric = model.metrics.some((x) => x.column === m.column);
  if (!knownAsDimension && !knownAsMetric) throw new Error(`unknown metric column: ${m.column}`);
  const col = sql.ref(m.column);
  switch (m.agg) {
    case 'count_distinct': return sql<number>`count(distinct ${col})`;
    case 'sum': return sql<number>`sum(${col})`;
    case 'avg': return sql<number>`avg(${col})`;
    case 'min': return sql<number>`min(${col})`;
    case 'max': return sql<number>`max(${col})`;
    default: throw new Error(`unsupported agg: ${m.agg}`);
  }
}

// Portable date grain bucketing happens in JS (repo convention: math in JS, not dialect SQL).
function grainKey(value: unknown, grain: DateGrain): string {
  const s = String(value ?? '');
  const d = s.slice(0, 10); // YYYY-MM-DD
  if (grain === 'year') return d.slice(0, 4);
  if (grain === 'month') return d.slice(0, 7);
  if (grain === 'day') return d;
  if (grain === 'week') {
    const dt = new Date(d + 'T00:00:00Z');
    const day = dt.getUTCDay();
    dt.setUTCDate(dt.getUTCDate() - day);
    return dt.toISOString().slice(0, 10);
  }
  return d;
}

function applyFilters(qb: AnyQB, model: QueryModel, filters: QueryFilter[]): AnyQB {
  let q = qb;
  for (const f of filters) {
    if (f.value === null) continue;
    const d = dim(model, f.dimension);
    const ref = d.column as never;
    switch (f.op) {
      case 'eq': q = q.where(ref, '=', f.value as never); break;
      case 'in': q = q.where(ref, 'in', (Array.isArray(f.value) ? f.value : [f.value]) as never); break;
      case 'contains': q = q.where(ref, 'like', `%${f.value}%` as never); break;
      case 'gte': q = q.where(ref, '>=', f.value as never); break;
      case 'lte': q = q.where(ref, '<=', f.value as never); break;
      case 'between':
        if (Array.isArray(f.value) && f.value.length === 2) {
          q = q.where(ref, '>=', f.value[0] as never).where(ref, '<=', f.value[1] as never);
        }
        break;
    }
  }
  return q;
}

/** Build the Kysely query (no grain bucketing — date grain is applied in JS after fetch). */
export function compileBuilderQuery(db: Kysely<ExternalSchema>, model: QueryModel, q: BuilderQuery): AnyQB {
  metricExpr(model, q.metric); // validate metric early
  let qb = db.selectFrom(model.table) as unknown as AnyQB;
  qb = qb.select(metricExpr(model, q.metric).as('value'));
  if (q.dimension) {
    const d = dim(model, q.dimension.key);
    qb = qb.select(sql.ref(d.column).as('label')).groupBy(d.column as never).orderBy(d.column as never);
  }
  qb = applyFilters(qb, model, q.filters ?? []);
  return qb;
}

/** Execute and shape into ReportResultData, applying date-grain bucketing in JS. */
export async function runBuilderQuery(
  db: Kysely<ExternalSchema>, model: QueryModel, q: BuilderQuery,
): Promise<ReportResultData> {
  const rows = (await compileBuilderQuery(db, model, q).execute()) as { value: number; label?: unknown }[];
  const d = q.dimension ? dim(model, q.dimension.key) : undefined;

  let shaped: Record<string, unknown>[];
  if (d && d.kind === 'date' && q.dimension?.grain) {
    const buckets = new Map<string, number>();
    for (const r of rows) {
      const key = grainKey(r.label, q.dimension.grain);
      buckets.set(key, (buckets.get(key) ?? 0) + Number(r.value ?? 0));
    }
    shaped = [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([label, value]) => ({ label, value }));
  } else if (d) {
    shaped = rows.map((r) => ({ label: r.label ?? '(none)', value: Number(r.value ?? 0) }));
  } else {
    shaped = [{ label: model.label, value: Number(rows[0]?.value ?? 0) }];
  }

  const columns: ReportColumn[] = [
    { key: 'label', label: d?.label ?? model.label, kind: d?.kind === 'date' ? 'date' : 'string' },
    { key: 'value', label: q.metric.label ?? 'Value', kind: 'number' },
  ];
  const chart: ChartHint = d
    ? { type: 'bar', x: 'label', y: 'value' }
    : { type: 'stat', value: String(shaped[0]?.value ?? 0), label: model.label };
  return { columns, rows: shaped, chart };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/dashboards test compile`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/compile.ts packages/dashboards/src/compile.test.ts
git -c commit.gpgsign=false commit -m "feat(dashboards): builder→Kysely query compiler (P2-DASH)"
```

---

### Task 5: SQL validator + runner (logic only; gating wired in bootstrap later)

**Files:**
- Create: `packages/dashboards/src/sql-runner.ts`
- Test: `packages/dashboards/src/sql-runner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { validateSelectSql } from './sql-runner';

describe('validateSelectSql', () => {
  it('accepts a single SELECT', () => { expect(() => validateSelectSql('SELECT 1')).not.toThrow(); });
  it('accepts a CTE (WITH)', () => { expect(() => validateSelectSql('WITH t AS (SELECT 1) SELECT * FROM t')).not.toThrow(); });
  it('rejects INSERT', () => { expect(() => validateSelectSql('INSERT INTO x VALUES (1)')).toThrow(); });
  it('rejects UPDATE/DELETE/DROP', () => {
    for (const s of ['UPDATE x SET a=1', 'DELETE FROM x', 'DROP TABLE x']) expect(() => validateSelectSql(s)).toThrow();
  });
  it('rejects multiple statements', () => { expect(() => validateSelectSql('SELECT 1; DROP TABLE x')).toThrow(); });
  it('strips a trailing comment so it does not smuggle a second statement', () => { expect(() => validateSelectSql('SELECT 1 -- ; DROP')).not.toThrow(); });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/dashboards test sql-runner`
Expected: FAIL — cannot find `./sql-runner`.

- [ ] **Step 3: Implement `sql-runner.ts`**

```ts
import { type Kysely, sql } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportResultData, ReportColumn } from '@openldr/reporting';

/** Strip line (`-- ...`) and block (slash-star ... star-slash) comments before structural checks. */
function stripComments(input: string): string {
  return input.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

export function validateSelectSql(rawSql: string): void {
  const stripped = stripComments(rawSql).trim();
  if (!stripped) throw new Error('empty query');
  // Reject multiple statements: any semicolon that is not the final char.
  const noTrailing = stripped.replace(/;\s*$/, '');
  if (noTrailing.includes(';')) throw new Error('only a single statement is allowed');
  if (!/^(select|with)\b/i.test(noTrailing)) throw new Error('only SELECT/WITH queries are allowed');
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|call|copy)\b/i.test(noTrailing)) {
    throw new Error('only read-only SELECT queries are allowed');
  }
}

export interface SqlRunOpts { timeoutMs: number; rowCap: number }

/** Run user SQL inside a READ ONLY transaction with a statement timeout and row cap. Postgres only. */
export async function runSqlQuery(
  db: Kysely<ExternalSchema>, rawSql: string, opts: SqlRunOpts,
): Promise<ReportResultData> {
  validateSelectSql(rawSql);
  const inner = rawSql.replace(/;\s*$/, '');
  const cap = Math.max(1, Math.floor(opts.rowCap));
  const capped = `select * from (${inner}) as _q limit ${cap}`;
  return db.connection().execute(async (conn) => {
    await sql`set transaction read only`.execute(conn);
    await sql.raw(`set local statement_timeout = ${Math.max(1, Math.floor(opts.timeoutMs))}`).execute(conn);
    const result = await sql.raw<Record<string, unknown>>(capped).execute(conn);
    const rows = result.rows;
    const keys = rows.length ? Object.keys(rows[0]) : [];
    const columns: ReportColumn[] = keys.map((k) => ({
      key: k, label: k,
      kind: typeof rows[0]?.[k] === 'number' ? 'number' : 'string',
    }));
    return { columns, rows, chart: { type: 'bar', x: keys[0] ?? 'label', y: keys[1] ?? 'value' } };
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/dashboards test sql-runner`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/sql-runner.ts packages/dashboards/src/sql-runner.test.ts
git -c commit.gpgsign=false commit -m "feat(dashboards): SELECT-only SQL validator + read-only runner (P2-DASH)"
```

---

## PHASE 2 — Persistence & store

### Task 6: Internal-DB migration + schema type

**Files:**
- Create: `packages/db/src/migrations/internal/011_dashboards.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/schema/internal.ts`

- [ ] **Step 1: Add the schema type** (`internal.ts`)

Add after `UsersTable`:
```ts
export interface DashboardsTable {
  id: string;
  owner_id: string | null;
  name: string;
  layout: JSONColumnType<unknown[]>;
  widgets: JSONColumnType<unknown[]>;
  filters: JSONColumnType<unknown[]>;
  refresh_interval_sec: Generated<number>;
  is_default: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
```
Add to `InternalSchema`: `dashboards: DashboardsTable;`

- [ ] **Step 2: Write the migration** (`011_dashboards.ts`)

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('dashboards')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('owner_id', 'text')
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('layout', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('widgets', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('filters', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('refresh_interval_sec', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('is_default', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('idx_dashboards_owner').ifNotExists().on('dashboards').column('owner_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('dashboards').ifExists().execute();
}
```

- [ ] **Step 3: Register the migration** (`index.ts`)

Add import `import * as m011 from './011_dashboards';` and entry `'011_dashboards': { up: m011.up, down: m011.down },`.

- [ ] **Step 4: Verify the package typechecks/builds**

Run: `pnpm --filter @openldr/db build:check`
Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/internal/011_dashboards.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts
git -c commit.gpgsign=false commit -m "feat(db): dashboards table migration + schema type (P2-DASH)"
```

---

### Task 7: `DashboardStore` (CRUD over internal DB)

**Files:**
- Create: `packages/dashboards/src/store.ts`
- Test: `packages/dashboards/src/store.test.ts`

The store maps the JSON DB columns ↔ the `Dashboard` type. Tests run against an in-memory SQLite Kysely to exercise CRUD logic without Postgres.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';
import { createDashboardStore } from './store';

let db: Kysely<any>;
beforeEach(async () => {
  db = new Kysely<any>({ dialect: new SqliteDialect({ database: new Database(':memory:') }) });
  await db.schema.createTable('dashboards')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('owner_id', 'text')
    .addColumn('name', 'text')
    .addColumn('layout', 'text').addColumn('widgets', 'text').addColumn('filters', 'text')
    .addColumn('refresh_interval_sec', 'integer').addColumn('is_default', 'integer')
    .addColumn('created_at', 'text').addColumn('updated_at', 'text').execute();
});

describe('DashboardStore', () => {
  it('creates, lists, gets, updates, deletes', async () => {
    const store = createDashboardStore(db);
    const created = await store.create({ id: 'd1', name: 'Main', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: true, ownerId: null });
    expect(created.name).toBe('Main');
    expect((await store.list()).length).toBe(1);
    const got = await store.get('d1');
    expect(got?.isDefault).toBe(true);
    await store.update('d1', { ...created, name: 'Renamed' });
    expect((await store.get('d1'))?.name).toBe('Renamed');
    await store.remove('d1');
    expect(await store.get('d1')).toBeUndefined();
  });
});
```
(Add `better-sqlite3` to `packages/dashboards` devDependencies for this test.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/dashboards test store`
Expected: FAIL — cannot find `./store`.

- [ ] **Step 3: Implement `store.ts`**

```ts
import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { type Dashboard, DashboardSchema } from './types';

function toRow(d: Dashboard) {
  return {
    id: d.id, owner_id: d.ownerId ?? null, name: d.name,
    layout: JSON.stringify(d.layout), widgets: JSON.stringify(d.widgets), filters: JSON.stringify(d.filters),
    refresh_interval_sec: d.refreshIntervalSec, is_default: d.isDefault,
  };
}
function fromRow(r: Record<string, unknown>): Dashboard {
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? []));
  return DashboardSchema.parse({
    id: r.id, ownerId: r.owner_id ?? null, name: r.name,
    layout: parse(r.layout), widgets: parse(r.widgets), filters: parse(r.filters),
    refreshIntervalSec: Number(r.refresh_interval_sec ?? 0), isDefault: Boolean(r.is_default),
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  });
}

export interface DashboardStore {
  list(): Promise<Dashboard[]>;
  get(id: string): Promise<Dashboard | undefined>;
  create(d: Dashboard): Promise<Dashboard>;
  update(id: string, d: Dashboard): Promise<Dashboard>;
  remove(id: string): Promise<void>;
}

export function createDashboardStore(db: Kysely<InternalSchema>): DashboardStore {
  const t = () => db.selectFrom('dashboards');
  const store: DashboardStore = {
    async list() {
      const rows = await t().selectAll().orderBy('name').execute();
      return rows.map((r) => fromRow(r as Record<string, unknown>));
    },
    async get(id) {
      const r = await t().selectAll().where('id', '=', id).executeTakeFirst();
      return r ? fromRow(r as Record<string, unknown>) : undefined;
    },
    async create(d) {
      await db.insertInto('dashboards').values(toRow(d) as never).execute();
      return (await store.get(d.id))!;
    },
    async update(id, d) {
      await db.updateTable('dashboards').set({ ...toRow({ ...d, id }) } as never).where('id', '=', id).execute();
      return (await store.get(id))!;
    },
    async remove(id) { await db.deleteFrom('dashboards').where('id', '=', id).execute(); },
  };
  return store;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/dashboards test store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/store.ts packages/dashboards/src/store.test.ts packages/dashboards/package.json pnpm-lock.yaml
git -c commit.gpgsign=false commit -m "feat(dashboards): DashboardStore CRUD over internal db (P2-DASH)"
```

---

### Task 8: Default-dashboard seed

**Files:**
- Create: `packages/dashboards/src/seed.ts`
- Test: `packages/dashboards/src/seed.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_DASHBOARD } from './seed';
import { DashboardSchema } from './types';
import { getModel } from './models/registry';

describe('DEFAULT_DASHBOARD', () => {
  it('is a valid dashboard whose widgets reference real models', () => {
    const d = DashboardSchema.parse(DEFAULT_DASHBOARD);
    expect(d.isDefault).toBe(true);
    for (const w of d.widgets) {
      if (w.query.mode === 'builder') expect(getModel(w.query.model)).toBeDefined();
    }
    expect(d.layout.length).toBe(d.widgets.length);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/dashboards test seed`
Expected: FAIL — cannot find `./seed`.

- [ ] **Step 3: Implement `seed.ts`**

```ts
import type { Dashboard } from './types';

export const DEFAULT_DASHBOARD: Dashboard = {
  id: 'default', ownerId: null, name: 'Overview', refreshIntervalSec: 0, isDefault: true,
  filters: [],
  widgets: [
    { id: 'w-orders', type: 'kpi', title: 'Total Orders', refreshIntervalSec: 0, visual: {},
      query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', label: 'Orders', agg: 'count' }, filters: [] } },
    { id: 'w-trend', type: 'line-chart', title: 'Orders by Month', refreshIntervalSec: 0, visual: { xAxisKey: 'label', yAxisKey: 'value' },
      query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', label: 'Orders', agg: 'count' }, dimension: { key: 'authored_on', grain: 'month' }, filters: [] } },
    { id: 'w-cat', type: 'bar-chart', title: 'Orders by Test', refreshIntervalSec: 0, visual: { xAxisKey: 'label', yAxisKey: 'value' },
      query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', label: 'Orders', agg: 'count' }, dimension: { key: 'code_text' }, filters: [] } },
  ],
  layout: [
    { i: 'w-orders', x: 0, y: 0, w: 3, h: 2 },
    { i: 'w-trend', x: 3, y: 0, w: 6, h: 4 },
    { i: 'w-cat', x: 0, y: 2, w: 6, h: 4 },
  ],
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/dashboards test seed`
Expected: PASS. Then run the whole package: `pnpm --filter @openldr/dashboards test` (all green) and `pnpm --filter @openldr/dashboards build`.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboards/src/seed.ts packages/dashboards/src/seed.test.ts
git -c commit.gpgsign=false commit -m "feat(dashboards): default-dashboard seed (P2-DASH)"
```

---

## PHASE 3 — Config, bootstrap wiring, API routes

### Task 9: Config flags for the SQL escape hatch

**Files:**
- Modify: `packages/config/src/schema.ts`
- Test: `packages/config/src/schema.test.ts` (append; if absent, create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { ConfigSchema } from './schema';

const base = {
  INTERNAL_DATABASE_URL: 'postgres://u:p@localhost/db', TARGET_DATABASE_URL: 'postgres://u:p@localhost/ext',
  S3_ENDPOINT: 'http://localhost:9000', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', S3_BUCKET: 'b',
  OIDC_ISSUER_URL: 'http://localhost:8080/realms/master',
};
describe('dashboard SQL config', () => {
  it('defaults DASHBOARD_SQL_ENABLED to false', () => {
    const cfg = ConfigSchema.parse(base);
    expect(cfg.DASHBOARD_SQL_ENABLED).toBe(false);
    expect(cfg.DASHBOARD_SQL_TIMEOUT_MS).toBeGreaterThan(0);
    expect(cfg.DASHBOARD_SQL_ROW_CAP).toBeGreaterThan(0);
  });
  it('parses DASHBOARD_SQL_ENABLED=true', () => {
    expect(ConfigSchema.parse({ ...base, DASHBOARD_SQL_ENABLED: 'true' }).DASHBOARD_SQL_ENABLED).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/config test`
Expected: FAIL — `DASHBOARD_SQL_ENABLED` undefined.

- [ ] **Step 3: Implement** — add inside the `ConfigSchema` object (near OIDC), reusing the existing `envBoolean` helper:

```ts
    // Custom dashboards — gated raw-SQL widget escape hatch (Postgres warehouse only).
    DASHBOARD_SQL_ENABLED: envBoolean(false),
    DASHBOARD_SQL_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    DASHBOARD_SQL_ROW_CAP: z.coerce.number().int().positive().default(10000),
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/config test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/config/src/schema.ts packages/config/src/schema.test.ts
git -c commit.gpgsign=false commit -m "feat(config): DASHBOARD_SQL_* flags for gated sql widgets (P2-DASH)"
```

---

### Task 10: Wire dashboards into `AppContext`

**Files:**
- Modify: `packages/bootstrap/src/index.ts`
- Modify: `packages/bootstrap/package.json` (add `@openldr/dashboards` dependency)
- Test: `packages/bootstrap/src/dashboards.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { DashboardQueryError } from './index';

describe('DashboardQueryError', () => {
  it('exists and carries a message', () => {
    const e = new DashboardQueryError('sql disabled');
    expect(e.message).toBe('sql disabled');
    expect(e.name).toBe('DashboardQueryError');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/bootstrap test dashboards`
Expected: FAIL — `DashboardQueryError` not exported.

- [ ] **Step 3: Implement** — in `index.ts`:

Add imports:
```ts
import { createDashboardStore, getModel, listModels, runBuilderQuery, runSqlQuery, type DashboardStore, type WidgetQuery } from '@openldr/dashboards';
```
(`ReportResult` is already imported from `@openldr/reporting`.)

Add error + API types (near `ReportNotFoundError`):
```ts
export class DashboardQueryError extends Error {
  constructor(msg: string) { super(msg); this.name = 'DashboardQueryError'; }
}

export interface DashboardsApi {
  store: DashboardStore;
  models(): ReturnType<typeof listModels>;
  query(q: WidgetQuery): Promise<ReportResult>;
}
```
Add `dashboards: DashboardsApi;` and `cfg: Config;` to `AppContext` (the `cfg` field is also used by Task 23).
In `createAppContext`, after `reporting` is built:
```ts
  const dashboardStore = createDashboardStore(internal.db);
  const runDashboardQuery = async (q: WidgetQuery): Promise<ReportResult> => {
    let data;
    if (q.mode === 'builder') {
      const model = getModel(q.model);
      if (!model) throw new DashboardQueryError(`unknown model: ${q.model}`);
      data = await runBuilderQuery(reportingDb, model, q);
    } else {
      if (!cfg.DASHBOARD_SQL_ENABLED || cfg.TARGET_STORE_ADAPTER !== 'pg') {
        throw new DashboardQueryError('raw SQL widgets are disabled');
      }
      data = await runSqlQuery(reportingDb, q.sql, { timeoutMs: cfg.DASHBOARD_SQL_TIMEOUT_MS, rowCap: cfg.DASHBOARD_SQL_ROW_CAP });
    }
    return { ...data, meta: { generatedAt: new Date().toISOString(), rowCount: data.rows.length } };
  };
  const dashboards: DashboardsApi = { store: dashboardStore, models: () => listModels(), query: runDashboardQuery };
```
Add `cfg` and `dashboards` to the returned object.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/bootstrap test dashboards` then `pnpm --filter @openldr/bootstrap build:check`
Expected: PASS / no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/index.ts packages/bootstrap/src/dashboards.test.ts packages/bootstrap/package.json pnpm-lock.yaml
git -c commit.gpgsign=false commit -m "feat(bootstrap): expose dashboards store + query + cfg on AppContext (P2-DASH)"
```

---

### Task 11: Dashboard API routes

**Files:**
- Create: `apps/server/src/dashboards-routes.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/src/dashboards-routes.test.ts`

- [ ] **Step 1: Write the failing test** (uses a fake ctx; no DB)

```ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerDashboardRoutes } from './dashboards-routes';

function fakeCtx() {
  const data: any[] = [];
  return {
    dashboards: {
      store: {
        list: async () => data,
        get: async (id: string) => data.find((d) => d.id === id),
        create: async (d: any) => { data.push(d); return d; },
        update: async (_id: string, d: any) => d,
        remove: async (id: string) => { const i = data.findIndex((x) => x.id === id); if (i >= 0) data.splice(i, 1); },
      },
      models: () => [{ id: 'service_requests', label: 'Test Orders', dimensions: [], metrics: [] }],
      query: async (q: any) => {
        if (q.mode === 'sql') { const e: any = new Error('raw SQL widgets are disabled'); e.name = 'DashboardQueryError'; throw e; }
        return { columns: [], rows: [], chart: { type: 'stat', value: '0', label: 'x' }, meta: { generatedAt: 'now', rowCount: 0 } };
      },
    },
  } as any;
}

describe('dashboard routes', () => {
  it('lists models', async () => {
    const app = Fastify(); registerDashboardRoutes(app, fakeCtx());
    const res = await app.inject({ method: 'GET', url: '/api/dashboards/models' });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].id).toBe('service_requests');
  });
  it('runs a builder query', async () => {
    const app = Fastify(); registerDashboardRoutes(app, fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/dashboards/query', payload: { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] } });
    expect(res.statusCode).toBe(200);
  });
  it('rejects a disabled sql query with 400', async () => {
    const app = Fastify(); registerDashboardRoutes(app, fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/dashboards/query', payload: { mode: 'sql', sql: 'select 1' } });
    expect(res.statusCode).toBe(400);
  });
  it('creates and lists a dashboard', async () => {
    const app = Fastify(); registerDashboardRoutes(app, fakeCtx());
    await app.inject({ method: 'POST', url: '/api/dashboards', payload: { id: 'd1', name: 'M', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: false, ownerId: null } });
    const res = await app.inject({ method: 'GET', url: '/api/dashboards' });
    expect(res.json().length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/server test dashboards`
Expected: FAIL — cannot find `./dashboards-routes`.

- [ ] **Step 3: Implement `dashboards-routes.ts`**

```ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { DashboardQueryError, type AppContext } from '@openldr/bootstrap';
import { DashboardSchema, WidgetQuerySchema } from '@openldr/dashboards';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerDashboardRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/dashboards/models', async () => ctx.dashboards.models());

  app.post('/api/dashboards/query', async (req, reply) => {
    try {
      const q = WidgetQuerySchema.parse(req.body);
      return await ctx.dashboards.query(q);
    } catch (err) { return mapError(err, reply); }
  });

  app.get('/api/dashboards', async () => ctx.dashboards.store.list());

  app.get('/api/dashboards/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = await ctx.dashboards.store.get(id);
    if (!d) { reply.code(404); return { error: `unknown dashboard: ${id}` }; }
    return d;
  });

  app.post('/api/dashboards', async (req, reply) => {
    try { return await ctx.dashboards.store.create(DashboardSchema.parse(req.body)); }
    catch (err) { return mapError(err, reply); }
  });

  app.put('/api/dashboards/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try { return await ctx.dashboards.store.update(id, DashboardSchema.parse(req.body)); }
    catch (err) { return mapError(err, reply); }
  });

  app.delete('/api/dashboards/:id', async (req) => {
    const { id } = req.params as { id: string };
    await ctx.dashboards.store.remove(id);
    return { ok: true };
  });
}

function mapError(err: unknown, reply: FastifyReply): { error: string } {
  if (err instanceof ZodError) { reply.code(400); return { error: 'invalid payload' }; }
  if (err instanceof DashboardQueryError) { reply.code(400); return { error: err.message }; }
  const msg = err instanceof Error ? err.message : String(err);
  const isConn = /ECONNREFUSED|ETIMEDOUT|connection|connect/i.test(msg);
  reply.code(isConn ? 503 : 500);
  return { error: msg };
}
```

- [ ] **Step 4: Register in `app.ts`**

Add `import { registerDashboardRoutes } from './dashboards-routes';` and call `registerDashboardRoutes(app, ctx);` alongside `registerReportRoutes(app, ctx);`.

- [ ] **Step 5: Run + verify**

Run: `pnpm --filter @openldr/server test dashboards`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/dashboards-routes.ts apps/server/src/dashboards-routes.test.ts apps/server/src/app.ts apps/server/package.json pnpm-lock.yaml
git -c commit.gpgsign=false commit -m "feat(server): /api/dashboards* routes (P2-DASH)"
```

---

### Task 12: Backend gate check (full backend green)

- [ ] **Step 1: Typecheck + test + lint the backend**

Run: `pnpm -w turbo typecheck test lint --filter=@openldr/dashboards --filter=@openldr/db --filter=@openldr/config --filter=@openldr/bootstrap --filter=@openldr/server`
Expected: all PASS.

- [ ] **Step 2: dependency-cruiser**

Run: `npx depcruise packages/dashboards/src --config .dependency-cruiser.cjs`
Expected: no violations (dashboards imports only `@openldr/db` / `@openldr/reporting` types).
If a rule forbids `dashboards` importing `reporting`, copy the three result types into `packages/dashboards/src/result-types.ts` (`ReportResultData`, `ReportColumn`, `ChartHint` — verbatim from `packages/reporting/src/types.ts`) and import from there instead. Re-run.

- [ ] **Step 3: Commit any fixups**

```bash
git add -A && git -c commit.gpgsign=false commit -m "chore(dashboards): backend gates green (P2-DASH)"
```

---

## PHASE 4 — Frontend foundation: deps, API client, store, grid, widget renderers

### Task 13: Add frontend deps + API client

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/api.ts`
- Test: `apps/web/src/api.dashboards.test.ts`

- [ ] **Step 1: Add deps**

Run: `pnpm --filter @openldr/web add react-grid-layout zustand codemirror @codemirror/lang-sql @codemirror/view @codemirror/state @codemirror/theme-one-dark` and `pnpm --filter @openldr/web add -D @types/react-grid-layout`.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runWidgetQuery, listDashboards } from './api';

afterEach(() => vi.restoreAllMocks());

describe('dashboard api client', () => {
  it('POSTs a widget query', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ columns: [], rows: [], chart: { type: 'stat', value: '1', label: 'x' }, meta: { generatedAt: 'now', rowCount: 0 } }), { status: 200 }));
    const r = await runWidgetQuery({ mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] });
    expect(r.meta.rowCount).toBe(0);
    expect(spy).toHaveBeenCalledWith('/api/dashboards/query', expect.objectContaining({ method: 'POST' }));
  });
  it('GETs dashboards', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    expect(await listDashboards()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @openldr/web test api.dashboards`
Expected: FAIL — `runWidgetQuery` not exported.

- [ ] **Step 4: Implement** — append to `apps/web/src/api.ts`:

```ts
export type WidgetQuery =
  | { mode: 'builder'; model: string; metric: { key: string; label?: string; agg: string; column?: string };
      dimension?: { key: string; grain?: string }; filters: { dimension: string; op: string; value: unknown }[];
      variableBindings?: Record<string, string> }
  | { mode: 'sql'; sql: string; variableBindings?: Record<string, string> };

export interface WidgetConfig {
  id: string; type: string; title: string; query: WidgetQuery; refreshIntervalSec: number; visual: Record<string, unknown>;
}
export interface LayoutItem { i: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number }
export interface DashboardFilterDef { id: string; label: string; type: 'text' | 'number' | 'date' | 'date-range'; defaultValue?: string | number | null; defaultRange?: { from: string; to: string } | null; options?: string[] }
export interface Dashboard {
  id: string; ownerId: string | null; name: string; layout: LayoutItem[]; widgets: WidgetConfig[];
  filters: DashboardFilterDef[]; refreshIntervalSec: number; isDefault: boolean; createdAt?: string; updatedAt?: string;
}
export interface ModelDimension { key: string; label: string; column: string; kind: 'string' | 'date' | 'number'; dateGrain?: string[] }
export interface ModelMetric { key: string; label: string; agg: string; column?: string }
export interface QueryModel { id: string; label: string; dimensions: ModelDimension[]; metrics: ModelMetric[] }

const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function listModels(): Promise<QueryModel[]> {
  const r = await fetch('/api/dashboards/models'); if (!r.ok) throw new Error(`models failed: ${r.status}`); return r.json();
}
export async function runWidgetQuery(q: WidgetQuery): Promise<ReportResult> {
  const r = await fetch('/api/dashboards/query', json(q));
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `query failed: ${r.status}`);
  return r.json();
}
export async function listDashboards(): Promise<Dashboard[]> {
  const r = await fetch('/api/dashboards'); if (!r.ok) throw new Error(`list failed: ${r.status}`); return r.json();
}
export async function getDashboard(id: string): Promise<Dashboard> {
  const r = await fetch(`/api/dashboards/${id}`); if (!r.ok) throw new Error(`get failed: ${r.status}`); return r.json();
}
export async function createDashboard(d: Dashboard): Promise<Dashboard> {
  const r = await fetch('/api/dashboards', json(d)); if (!r.ok) throw new Error(`create failed: ${r.status}`); return r.json();
}
export async function saveDashboard(d: Dashboard): Promise<Dashboard> {
  const r = await fetch(`/api/dashboards/${d.id}`, { ...json(d), method: 'PUT' }); if (!r.ok) throw new Error(`save failed: ${r.status}`); return r.json();
}
export async function deleteDashboard(id: string): Promise<void> {
  const r = await fetch(`/api/dashboards/${id}`, { method: 'DELETE' }); if (!r.ok) throw new Error(`delete failed: ${r.status}`);
}
```

- [ ] **Step 5: Run + verify**

Run: `pnpm --filter @openldr/web test api.dashboards`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/src/api.ts apps/web/src/api.dashboards.test.ts pnpm-lock.yaml
git -c commit.gpgsign=false commit -m "feat(web): dashboard api client + grid/zustand/codemirror deps (P2-DASH)"
```

---

### Task 14: zustand dashboard store

**Files:**
- Create: `apps/web/src/dashboard/store.ts`
- Test: `apps/web/src/dashboard/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useDashboardStore } from './store';

const blank = { id: 'd', ownerId: null, name: 'D', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: false };

beforeEach(() => useDashboardStore.setState({ current: structuredClone(blank), editing: false, dirty: false }));

describe('dashboard store', () => {
  it('adds a widget and marks dirty', () => {
    useDashboardStore.getState().addWidget({ id: 'w1', type: 'kpi', title: 'X', refreshIntervalSec: 0, visual: {}, query: { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] } });
    expect(useDashboardStore.getState().current!.widgets.length).toBe(1);
    expect(useDashboardStore.getState().current!.layout.length).toBe(1);
    expect(useDashboardStore.getState().dirty).toBe(true);
  });
  it('removes a widget and its layout item', () => {
    const s = useDashboardStore.getState();
    s.addWidget({ id: 'w1', type: 'kpi', title: 'X', refreshIntervalSec: 0, visual: {}, query: { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] } });
    s.removeWidget('w1');
    expect(useDashboardStore.getState().current!.widgets.length).toBe(0);
    expect(useDashboardStore.getState().current!.layout.length).toBe(0);
  });
  it('updates layout', () => {
    useDashboardStore.getState().setLayout([{ i: 'w1', x: 1, y: 2, w: 3, h: 4 }]);
    expect(useDashboardStore.getState().current!.layout[0].x).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/web test dashboard/store`
Expected: FAIL — cannot find `./store`.

- [ ] **Step 3: Implement `store.ts`**

```ts
import { create } from 'zustand';
import type { Dashboard, WidgetConfig, LayoutItem } from '../api';

const DEFAULT_SIZES: Record<string, { w: number; h: number }> = {
  kpi: { w: 3, h: 2 }, 'traffic-light': { w: 3, h: 2 }, 'progress-bar': { w: 3, h: 2 }, gauge: { w: 3, h: 3 },
  'pie-chart': { w: 4, h: 4 }, funnel: { w: 4, h: 4 },
  'bar-chart': { w: 6, h: 4 }, 'line-chart': { w: 6, h: 4 }, 'area-chart': { w: 6, h: 4 },
  'row-chart': { w: 6, h: 4 }, 'scatter-plot': { w: 6, h: 4 }, table: { w: 6, h: 4 },
};

interface State {
  current: Dashboard | null; editing: boolean; dirty: boolean;
  setCurrent(d: Dashboard): void; setEditing(v: boolean): void; markClean(): void;
  addWidget(w: WidgetConfig): void; updateWidget(w: WidgetConfig): void; removeWidget(id: string): void;
  setLayout(layout: LayoutItem[]): void; rename(name: string): void;
}

export const useDashboardStore = create<State>((set) => ({
  current: null, editing: false, dirty: false,
  setCurrent: (d) => set({ current: d, dirty: false }),
  setEditing: (v) => set({ editing: v }),
  markClean: () => set({ dirty: false }),
  addWidget: (w) => set((s) => {
    if (!s.current) return s;
    const size = DEFAULT_SIZES[w.type] ?? { w: 4, h: 3 };
    const y = s.current.layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    return { current: { ...s.current, widgets: [...s.current.widgets, w], layout: [...s.current.layout, { i: w.id, x: 0, y, ...size }] }, dirty: true };
  }),
  updateWidget: (w) => set((s) => s.current ? { current: { ...s.current, widgets: s.current.widgets.map((x) => x.id === w.id ? w : x) }, dirty: true } : s),
  removeWidget: (id) => set((s) => s.current ? { current: { ...s.current, widgets: s.current.widgets.filter((x) => x.id !== id), layout: s.current.layout.filter((l) => l.i !== id) }, dirty: true } : s),
  setLayout: (layout) => set((s) => s.current ? { current: { ...s.current, layout }, dirty: true } : s),
  rename: (name) => set((s) => s.current ? { current: { ...s.current, name }, dirty: true } : s),
}));
```

- [ ] **Step 4: Run + verify**

Run: `pnpm --filter @openldr/web test dashboard/store`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/dashboard/store.ts apps/web/src/dashboard/store.test.ts
git -c commit.gpgsign=false commit -m "feat(web): zustand dashboard store (P2-DASH)"
```

---

### Task 15: Widget renderers

**Files:**
- Create: `apps/web/src/dashboard/widgets/ChartWidget.tsx`, `KpiWidget.tsx`, `GaugeWidget.tsx`, `ProgressWidget.tsx`, `TrafficLightWidget.tsx`, `TableWidget.tsx`, `index.tsx`
- Test: `apps/web/src/dashboard/widgets/widgets.test.tsx`

Each renderer takes `{ config: WidgetConfig; result: ReportResult }`. `ChartWidget` covers the recharts-based types (line/bar/area/row/scatter/pie/funnel) via a switch; the four indicator widgets and the table are separate.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { renderWidget } from './index';
import type { ReportResult, WidgetConfig } from '../../api';

const result: ReportResult = { columns: [{ key: 'label', label: 'L', kind: 'string' }, { key: 'value', label: 'V', kind: 'number' }], rows: [{ label: 'A', value: 5 }, { label: 'B', value: 3 }], chart: { type: 'bar', x: 'label', y: 'value' }, meta: { generatedAt: 'now', rowCount: 2 } };
const cfg = (type: string): WidgetConfig => ({ id: 'w', type, title: 'T', refreshIntervalSec: 0, visual: {}, query: { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] } });

describe('renderWidget', () => {
  for (const t of ['kpi', 'line-chart', 'bar-chart', 'area-chart', 'row-chart', 'pie-chart', 'scatter-plot', 'funnel', 'progress-bar', 'gauge', 'table', 'traffic-light']) {
    it(`renders ${t} without crashing`, () => {
      const { container } = render(<div style={{ width: 400, height: 300 }}>{renderWidget(cfg(t), result)}</div>);
      expect(container).toBeTruthy();
    });
  }
  it('kpi shows the value', () => {
    const single: ReportResult = { ...result, rows: [{ label: 'X', value: 42 }], chart: { type: 'stat', value: '42', label: 'X' } };
    const { getByText } = render(renderWidget(cfg('kpi'), single));
    expect(getByText('42')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/web test widgets`
Expected: FAIL — cannot find `./index`.

- [ ] **Step 3: Implement the widgets**

`KpiWidget.tsx`:
```tsx
import type { ReportResult, WidgetConfig } from '../../api';
export function KpiWidget({ config, result }: { config: WidgetConfig; result: ReportResult }) {
  const v = result.rows[0]?.value ?? (result.chart.type === 'stat' ? result.chart.value : 0);
  return (
    <div className="flex h-full flex-col justify-center px-4">
      <div className="text-4xl font-semibold text-primary">{String(v)}{(config.visual.suffix as string) ?? ''}</div>
      <div className="text-sm text-muted-foreground">{config.title}</div>
    </div>
  );
}
```

`GaugeWidget.tsx`:
```tsx
import type { ReportResult, WidgetConfig } from '../../api';
export function GaugeWidget({ config, result }: { config: WidgetConfig; result: ReportResult }) {
  const value = Number(result.rows[0]?.value ?? 0);
  const min = Number(config.visual.minValue ?? 0); const max = Number(config.visual.maxValue ?? 100);
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const angle = -90 + pct * 180;
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <svg viewBox="0 0 100 60" className="w-40">
        <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="var(--border)" strokeWidth="8" />
        <line x1="50" y1="50" x2="50" y2="15" stroke="var(--brand)" strokeWidth="3" transform={`rotate(${angle} 50 50)`} />
      </svg>
      <div className="text-lg font-medium">{value}</div>
    </div>
  );
}
```

`ProgressWidget.tsx`:
```tsx
import type { ReportResult, WidgetConfig } from '../../api';
export function ProgressWidget({ config, result }: { config: WidgetConfig; result: ReportResult }) {
  const value = Number(result.rows[0]?.value ?? 0);
  const goal = Number(config.visual.goalValue ?? 100);
  const pct = Math.max(0, Math.min(100, (value / (goal || 1)) * 100));
  return (
    <div className="flex h-full flex-col justify-center gap-2 px-4">
      <div className="flex justify-between text-sm"><span>{config.title}</span><span>{value} / {goal}</span></div>
      <div className="h-3 w-full rounded bg-muted"><div className="h-3 rounded bg-primary" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
```

`TrafficLightWidget.tsx`:
```tsx
import type { ReportResult, WidgetConfig } from '../../api';
export function TrafficLightWidget({ config, result }: { config: WidgetConfig; result: ReportResult }) {
  const value = Number(result.rows[0]?.value ?? 0);
  const green = Number(config.visual.greenThreshold ?? 90); const amber = Number(config.visual.amberThreshold ?? 70);
  const color = value >= green ? '#22c55e' : value >= amber ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex h-full items-center gap-3 px-4">
      <span className="inline-block h-6 w-6 rounded-full" style={{ background: color }} />
      <div><div className="text-2xl font-semibold">{value}{(config.visual.suffix as string) ?? ''}</div><div className="text-xs text-muted-foreground">{config.title}</div></div>
    </div>
  );
}
```

`TableWidget.tsx`:
```tsx
import type { ReportResult } from '../../api';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
export function TableWidget({ result }: { result: ReportResult }) {
  const { columns, rows } = result;
  return (
    <div className="h-full overflow-auto">
      <Table>
        <TableHeader><TableRow>{columns.map((c) => <TableHead key={c.key}>{c.label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {rows.map((r, i) => <TableRow key={i}>{columns.map((c) => <TableCell key={c.key}>{String(r[c.key] ?? '')}</TableCell>)}</TableRow>)}
        </TableBody>
      </Table>
    </div>
  );
}
```

`ChartWidget.tsx`:
```tsx
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  ScatterChart, Scatter, FunnelChart, Funnel, XAxis, YAxis, ZAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import type { ReportResult, WidgetConfig } from '../../api';

const COLORS = ['#4682B4', '#5A9BD6', '#22c55e', '#f59e0b', '#ef4444', '#898989'];

export function ChartWidget({ config, result }: { config: WidgetConfig; result: ReportResult }) {
  const rows = result.rows;
  const x = (config.visual.xAxisKey as string) ?? 'label';
  const y = (config.visual.yAxisKey as string) ?? 'value';
  const color = (config.visual.color as string) ?? 'var(--brand)';
  switch (config.type) {
    case 'line-chart':
      return <ResponsiveContainer><LineChart data={rows}><CartesianGrid stroke="var(--border)" /><XAxis dataKey={x} stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" /><Tooltip /><Line type="monotone" dataKey={y} stroke={color} /></LineChart></ResponsiveContainer>;
    case 'area-chart':
      return <ResponsiveContainer><AreaChart data={rows}><CartesianGrid stroke="var(--border)" /><XAxis dataKey={x} stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" /><Tooltip /><Area type="monotone" dataKey={y} stroke={color} fill={color} fillOpacity={0.3} /></AreaChart></ResponsiveContainer>;
    case 'row-chart':
      return <ResponsiveContainer><BarChart data={rows} layout="vertical"><CartesianGrid stroke="var(--border)" /><XAxis type="number" stroke="var(--text-muted)" /><YAxis type="category" dataKey={x} stroke="var(--text-muted)" /><Tooltip /><Bar dataKey={y} fill={color} /></BarChart></ResponsiveContainer>;
    case 'pie-chart':
      return <ResponsiveContainer><PieChart><Pie data={rows} dataKey={y} nameKey={x} outerRadius="80%" innerRadius={(config.visual.innerRadius as number) ?? 0} label>{rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer>;
    case 'scatter-plot':
      return <ResponsiveContainer><ScatterChart><CartesianGrid stroke="var(--border)" /><XAxis dataKey={x} stroke="var(--text-muted)" /><YAxis dataKey={y} stroke="var(--text-muted)" /><ZAxis dataKey={(config.visual.sizeKey as string) ?? undefined} range={[40, 200]} /><Tooltip /><Scatter data={rows} fill={color} /></ScatterChart></ResponsiveContainer>;
    case 'funnel':
      return <ResponsiveContainer><FunnelChart><Tooltip /><Funnel data={rows} dataKey={y} nameKey={x}>{rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Funnel></FunnelChart></ResponsiveContainer>;
    default:
      return <ResponsiveContainer><BarChart data={rows}><CartesianGrid stroke="var(--border)" /><XAxis dataKey={x} stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" /><Tooltip /><Bar dataKey={y} fill={color} /></BarChart></ResponsiveContainer>;
  }
}
```

`index.tsx`:
```tsx
import type { ReportResult, WidgetConfig } from '../../api';
import { ChartWidget } from './ChartWidget';
import { KpiWidget } from './KpiWidget';
import { GaugeWidget } from './GaugeWidget';
import { ProgressWidget } from './ProgressWidget';
import { TrafficLightWidget } from './TrafficLightWidget';
import { TableWidget } from './TableWidget';

export function renderWidget(config: WidgetConfig, result: ReportResult) {
  switch (config.type) {
    case 'kpi': return <KpiWidget config={config} result={result} />;
    case 'gauge': return <GaugeWidget config={config} result={result} />;
    case 'progress-bar': return <ProgressWidget config={config} result={result} />;
    case 'traffic-light': return <TrafficLightWidget config={config} result={result} />;
    case 'table': return <TableWidget result={result} />;
    default: return <ChartWidget config={config} result={result} />;
  }
}
```

- [ ] **Step 4: Run + verify**

Run: `pnpm --filter @openldr/web test widgets`
Expected: PASS (13 tests). Recharts in jsdom logs width/height warnings — acceptable.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/dashboard/widgets
git -c commit.gpgsign=false commit -m "feat(web): 12 widget renderers (chart/kpi/gauge/progress/traffic-light/table) (P2-DASH)"
```

---

### Task 16: `DashboardWidget` (fetch + render + refresh)

**Files:**
- Create: `apps/web/src/dashboard/DashboardWidget.tsx`
- Test: `apps/web/src/dashboard/DashboardWidget.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { DashboardWidget } from './DashboardWidget';
import type { WidgetConfig } from '../api';

afterEach(() => vi.restoreAllMocks());
const cfg: WidgetConfig = { id: 'w', type: 'kpi', title: 'Orders', refreshIntervalSec: 0, visual: {}, query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] } };

describe('DashboardWidget', () => {
  it('fetches and renders the value', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ columns: [], rows: [{ label: 'x', value: 7 }], chart: { type: 'stat', value: '7', label: 'x' }, meta: { generatedAt: 'now', rowCount: 1 } }), { status: 200 }));
    const { getByText } = render(<DashboardWidget config={cfg} filterValues={{}} />);
    await waitFor(() => expect(getByText('7')).toBeTruthy());
  });
  it('shows an error message on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'boom' }), { status: 400 }));
    const { findByText } = render(<DashboardWidget config={cfg} filterValues={{}} />);
    expect(await findByText(/boom/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/web test DashboardWidget`
Expected: FAIL — cannot find `./DashboardWidget`.

- [ ] **Step 3: Implement** (applies `variableBindings` against `filterValues` before querying)

```tsx
import { useEffect, useState } from 'react';
import { runWidgetQuery, type ReportResult, type WidgetConfig, type WidgetQuery } from '../api';
import { renderWidget } from './widgets';

function bindQuery(q: WidgetQuery, filterValues: Record<string, unknown>): WidgetQuery {
  if (!q.variableBindings) return q;
  if (q.mode === 'builder') {
    const filters = [...q.filters];
    for (const [varName, filterId] of Object.entries(q.variableBindings)) {
      const v = filterValues[filterId];
      if (v != null && v !== '') filters.push({ dimension: varName, op: 'eq', value: v });
    }
    return { ...q, filters };
  }
  let sqlText = q.sql;
  for (const [varName, filterId] of Object.entries(q.variableBindings)) {
    const v = filterValues[filterId];
    sqlText = sqlText.replaceAll(`{{${varName}}}`, v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
  }
  return { ...q, sql: sqlText };
}

export function DashboardWidget({ config, filterValues }: { config: WidgetConfig; filterValues: Record<string, unknown> }) {
  const [result, setResult] = useState<ReportResult>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    const run = () => runWidgetQuery(bindQuery(config.query, filterValues)).then((r) => alive && setResult(r)).catch((e) => alive && setError(String(e.message ?? e)));
    run();
    const ms = config.refreshIntervalSec * 1000;
    const t = ms > 0 ? setInterval(run, ms) : undefined;
    return () => { alive = false; if (t) clearInterval(t); };
  }, [JSON.stringify(config.query), JSON.stringify(filterValues), config.refreshIntervalSec]);
  if (error) return <div className="p-3 text-sm text-destructive">{error}</div>;
  if (!result) return <div className="p-3 text-sm text-muted-foreground">Loading…</div>;
  return <div className="h-full w-full">{renderWidget(config, result)}</div>;
}
```

- [ ] **Step 4: Run + verify**

Run: `pnpm --filter @openldr/web test DashboardWidget`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/dashboard/DashboardWidget.tsx apps/web/src/dashboard/DashboardWidget.test.tsx
git -c commit.gpgsign=false commit -m "feat(web): DashboardWidget data-fetch + variable binding (P2-DASH)"
```

---

### Task 17: `DashboardGrid` (react-grid-layout)

**Files:**
- Create: `apps/web/src/dashboard/DashboardGrid.tsx`
- Test: `apps/web/src/dashboard/DashboardGrid.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { DashboardGrid } from './DashboardGrid';
import { useDashboardStore } from './store';

beforeEach(() => useDashboardStore.setState({ current: { id: 'd', ownerId: null, name: 'D', refreshIntervalSec: 0, isDefault: false, filters: [], widgets: [{ id: 'w1', type: 'kpi', title: 'X', refreshIntervalSec: 0, visual: {}, query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] } }], layout: [{ i: 'w1', x: 0, y: 0, w: 3, h: 2 }] }, editing: false, dirty: false }));
afterEach(() => vi.restoreAllMocks());

describe('DashboardGrid', () => {
  it('renders one widget panel with its title', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ columns: [], rows: [{ value: 1 }], chart: { type: 'stat', value: '1', label: 'x' }, meta: { generatedAt: 'n', rowCount: 1 } }), { status: 200 }));
    const { getByText } = render(<DashboardGrid filterValues={{}} />);
    expect(getByText('X')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/web test DashboardGrid`
Expected: FAIL — cannot find `./DashboardGrid`.

- [ ] **Step 3: Implement**

```tsx
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import GridLayout, { type Layout } from 'react-grid-layout';
import { useDashboardStore } from './store';
import { DashboardWidget } from './DashboardWidget';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2, GripVertical } from 'lucide-react';

export function DashboardGrid({ filterValues, onEdit }: { filterValues: Record<string, unknown>; onEdit?: (id: string) => void }) {
  const { current, editing, setLayout, removeWidget } = useDashboardStore();
  if (!current) return null;
  const onLayoutChange = (l: Layout[]) => { if (editing) setLayout(l.map((x) => ({ i: x.i, x: x.x, y: x.y, w: x.w, h: x.h }))); };
  return (
    <GridLayout className="layout" layout={current.layout as Layout[]} cols={12} rowHeight={80} width={1200}
      isDraggable={editing} isResizable={editing} draggableHandle=".drag-handle" compactType="vertical" margin={[16, 16]}
      onLayoutChange={onLayoutChange}>
      {current.widgets.map((w) => (
        <div key={w.id} className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-2 py-1 text-sm">
            <span className="flex items-center gap-1 font-medium">
              {editing && <GripVertical className="drag-handle h-4 w-4 cursor-move text-muted-foreground" />}{w.title}
            </span>
            {editing && (
              <span className="flex gap-1">
                <Button size="icon" variant="ghost" aria-label="edit widget" onClick={() => onEdit?.(w.id)}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label="delete widget" onClick={() => removeWidget(w.id)}><Trash2 className="h-4 w-4" /></Button>
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1"><DashboardWidget config={w} filterValues={filterValues} /></div>
        </div>
      ))}
    </GridLayout>
  );
}
```

- [ ] **Step 4: Run + verify**

Run: `pnpm --filter @openldr/web test DashboardGrid`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/dashboard/DashboardGrid.tsx apps/web/src/dashboard/DashboardGrid.test.tsx
git -c commit.gpgsign=false commit -m "feat(web): react-grid-layout DashboardGrid (P2-DASH)"
```

---

## PHASE 5 — Widget editor (builder + preview)

### Task 18: `BuilderForm` (model/metric/dimension/grain)

**Files:**
- Create: `apps/web/src/dashboard/editor/BuilderForm.tsx`
- Test: `apps/web/src/dashboard/editor/BuilderForm.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { BuilderForm } from './BuilderForm';
import type { QueryModel } from '../../api';

const models: QueryModel[] = [{ id: 'service_requests', label: 'Test Orders', metrics: [{ key: 'count', label: 'Count', agg: 'count' }], dimensions: [{ key: 'status', label: 'Status', column: 'status', kind: 'string' }] }];

describe('BuilderForm', () => {
  it('emits a builder query when a dimension is chosen', () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<BuilderForm models={models} value={{ mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] }} onChange={onChange} />);
    fireEvent.change(getByLabelText('Group by'), { target: { value: 'status' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ dimension: expect.objectContaining({ key: 'status' }) }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/web test BuilderForm`
Expected: FAIL — cannot find `./BuilderForm`.

- [ ] **Step 3: Implement**

```tsx
import type { QueryModel, WidgetQuery } from '../../api';

type BuilderQuery = Extract<WidgetQuery, { mode: 'builder' }>;

export function BuilderForm({ models, value, onChange }: { models: QueryModel[]; value: BuilderQuery; onChange: (q: BuilderQuery) => void }) {
  const model = models.find((m) => m.id === value.model) ?? models[0];
  const setModel = (id: string) => { const m = models.find((x) => x.id === id)!; onChange({ ...value, model: id, metric: m.metrics[0], dimension: undefined, filters: [] }); };
  const setMetric = (key: string) => { const mm = model.metrics.find((x) => x.key === key)!; onChange({ ...value, metric: mm }); };
  const setDim = (key: string) => onChange({ ...value, dimension: key ? { key } : undefined });
  const dim = model?.dimensions.find((d) => d.key === value.dimension?.key);
  return (
    <div className="flex flex-col gap-3">
      <label className="text-sm">Source
        <select aria-label="Source" className="mt-1 w-full rounded border border-border bg-background p-2" value={value.model} onChange={(e) => setModel(e.target.value)}>
          {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
      <label className="text-sm">Metric
        <select aria-label="Metric" className="mt-1 w-full rounded border border-border bg-background p-2" value={value.metric.key} onChange={(e) => setMetric(e.target.value)}>
          {model?.metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </label>
      <label className="text-sm">Group by
        <select aria-label="Group by" className="mt-1 w-full rounded border border-border bg-background p-2" value={value.dimension?.key ?? ''} onChange={(e) => setDim(e.target.value)}>
          <option value="">(none)</option>
          {model?.dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
      </label>
      {dim?.kind === 'date' && dim.dateGrain && (
        <label className="text-sm">Grain
          <select aria-label="Grain" className="mt-1 w-full rounded border border-border bg-background p-2" value={value.dimension?.grain ?? 'month'} onChange={(e) => onChange({ ...value, dimension: { key: dim.key, grain: e.target.value } })}>
            {dim.dateGrain.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run + verify**

Run: `pnpm --filter @openldr/web test BuilderForm`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/dashboard/editor/BuilderForm.tsx apps/web/src/dashboard/editor/BuilderForm.test.tsx
git -c commit.gpgsign=false commit -m "feat(web): visual query BuilderForm (P2-DASH)"
```

---

### Task 19: `SqlForm` (CodeMirror, gated)

**Files:**
- Create: `apps/web/src/dashboard/editor/SqlForm.tsx`
- Test: `apps/web/src/dashboard/editor/SqlForm.test.tsx`

- [ ] **Step 1: Write the failing test** (exercises the always-rendered accessible `<textarea>` mirror so the test does not depend on the CodeMirror DOM)

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SqlForm } from './SqlForm';

describe('SqlForm', () => {
  it('emits sql changes', () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<SqlForm value={{ mode: 'sql', sql: '' }} onChange={onChange} />);
    fireEvent.change(getByLabelText('SQL'), { target: { value: 'select 1' } });
    expect(onChange).toHaveBeenCalledWith({ mode: 'sql', sql: 'select 1' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/web test SqlForm`
Expected: FAIL — cannot find `./SqlForm`.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { sql as sqlLang } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import type { WidgetQuery } from '../../api';

type SqlQuery = Extract<WidgetQuery, { mode: 'sql' }>;

export function SqlForm({ value, onChange }: { value: SqlQuery; onChange: (q: SqlQuery) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  useEffect(() => {
    if (!host.current || view.current) return;
    view.current = new EditorView({
      parent: host.current,
      doc: value.sql,
      extensions: [basicSetup, sqlLang(), oneDark, EditorView.updateListener.of((u) => { if (u.docChanged) onChange({ mode: 'sql', sql: u.state.doc.toString() }); })],
    });
    return () => view.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="flex flex-col gap-2">
      <div ref={host} className="overflow-hidden rounded border border-border" />
      {/* Accessible/testable mirror; one-way bound for screen readers and tests. */}
      <textarea aria-label="SQL" className="sr-only" value={value.sql} onChange={(e) => onChange({ mode: 'sql', sql: e.target.value })} />
      <p className="text-xs text-muted-foreground">Read-only SELECT/WITH only. Use {'{{'}variable{'}}'} for dashboard filters.</p>
    </div>
  );
}
```

- [ ] **Step 4: Run + verify**

Run: `pnpm --filter @openldr/web test SqlForm`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/dashboard/editor/SqlForm.tsx apps/web/src/dashboard/editor/SqlForm.test.tsx
git -c commit.gpgsign=false commit -m "feat(web): CodeMirror SqlForm escape hatch (P2-DASH)"
```

---

### Task 20: `WidgetEditorDialog` (type, tabs, live preview, save)

**Files:**
- Create: `apps/web/src/dashboard/editor/WidgetEditorDialog.tsx`
- Test: `apps/web/src/dashboard/editor/WidgetEditorDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { WidgetEditorDialog } from './WidgetEditorDialog';

afterEach(() => vi.restoreAllMocks());

describe('WidgetEditorDialog', () => {
  it('loads models, previews, and saves a widget', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
      if (String(url).endsWith('/models')) return Promise.resolve(new Response(JSON.stringify([{ id: 'service_requests', label: 'Test Orders', metrics: [{ key: 'count', label: 'Count', agg: 'count' }], dimensions: [{ key: 'status', label: 'Status', column: 'status', kind: 'string' }] }]), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ columns: [], rows: [{ value: 9 }], chart: { type: 'stat', value: '9', label: 'x' }, meta: { generatedAt: 'n', rowCount: 1 } }), { status: 200 }));
    });
    const onSave = vi.fn();
    const { getByText, getByLabelText } = render(<WidgetEditorDialog open sqlEnabled={false} onClose={() => {}} onSave={onSave} />);
    await waitFor(() => expect(getByLabelText('Source')).toBeTruthy());
    fireEvent.change(getByLabelText('Title'), { target: { value: 'My KPI' } });
    fireEvent.click(getByText('Save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'My KPI', type: expect.any(String) }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/web test WidgetEditorDialog`
Expected: FAIL — cannot find `./WidgetEditorDialog`.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listModels, runWidgetQuery, type QueryModel, type WidgetConfig, type WidgetQuery, type ReportResult } from '../../api';
import { BuilderForm } from './BuilderForm';
import { SqlForm } from './SqlForm';
import { renderWidget } from '../widgets';

const TYPES = ['kpi', 'line-chart', 'bar-chart', 'area-chart', 'row-chart', 'pie-chart', 'scatter-plot', 'funnel', 'progress-bar', 'gauge', 'table', 'traffic-light'];
const emptyBuilder = (model: string): WidgetQuery => ({ mode: 'builder', model, metric: { key: 'count', agg: 'count' }, filters: [] });

export function WidgetEditorDialog({ open, initial, sqlEnabled, onClose, onSave }: { open: boolean; initial?: WidgetConfig; sqlEnabled: boolean; onClose: () => void; onSave: (w: WidgetConfig) => void }) {
  const [models, setModels] = useState<QueryModel[]>([]);
  const [title, setTitle] = useState(initial?.title ?? 'New widget');
  const [type, setType] = useState(initial?.type ?? 'kpi');
  const [tab, setTab] = useState<'builder' | 'sql'>(initial?.query.mode ?? 'builder');
  const [query, setQuery] = useState<WidgetQuery>(initial?.query ?? emptyBuilder('service_requests'));
  const [preview, setPreview] = useState<ReportResult>();
  const [error, setError] = useState<string>();

  useEffect(() => { listModels().then((m) => { setModels(m); if (!initial && query.mode === 'builder' && !m.find((x) => x.id === query.model)) setQuery(emptyBuilder(m[0]?.id ?? 'service_requests')); }).catch((e) => setError(String(e.message ?? e))); }, []);

  useEffect(() => {
    const t = setTimeout(() => { runWidgetQuery(query).then((r) => { setPreview(r); setError(undefined); }).catch((e) => setError(String(e.message ?? e))); }, 400);
    return () => clearTimeout(t);
  }, [JSON.stringify(query)]);

  const save = () => {
    const id = initial?.id ?? (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `w-${Math.round(performance.now())}`);
    onSave({ id, type, title, query, refreshIntervalSec: initial?.refreshIntervalSec ?? 0, visual: initial?.visual ?? {} });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader><DialogTitle>{initial ? 'Edit widget' : 'Add widget'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-6">
          <div className="flex flex-col gap-3">
            <label className="text-sm">Title<Input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" /></label>
            <label className="text-sm">Visualization
              <select aria-label="Visualization" className="mt-1 w-full rounded border border-border bg-background p-2" value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            {sqlEnabled && (
              <div className="flex gap-2">
                <Button size="sm" variant={tab === 'builder' ? 'default' : 'outline'} onClick={() => { setTab('builder'); setQuery(emptyBuilder(models[0]?.id ?? 'service_requests')); }}>Builder</Button>
                <Button size="sm" variant={tab === 'sql' ? 'default' : 'outline'} onClick={() => { setTab('sql'); setQuery({ mode: 'sql', sql: 'select 1 as value' }); }}>SQL</Button>
              </div>
            )}
            {tab === 'builder' && query.mode === 'builder' && <BuilderForm models={models} value={query} onChange={setQuery} />}
            {tab === 'sql' && query.mode === 'sql' && <SqlForm value={query} onChange={setQuery} />}
          </div>
          <div className="flex min-h-[300px] flex-col rounded-lg border border-border p-3">
            <div className="mb-2 text-sm text-muted-foreground">Preview</div>
            {error ? <div className="text-sm text-destructive">{error}</div> : preview ? <div className="flex-1">{renderWidget({ id: 'preview', type, title, query, refreshIntervalSec: 0, visual: {} }, preview)}</div> : <div className="text-sm text-muted-foreground">Loading…</div>}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```
(If `@/components/ui/dialog` does not export `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`, generate the shadcn dialog component first — `pnpm --filter @openldr/web dlx shadcn@latest add dialog` or copy the existing dialog file pattern used elsewhere in `apps/web/src/components/ui`.)

- [ ] **Step 4: Run + verify**

Run: `pnpm --filter @openldr/web test WidgetEditorDialog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/dashboard/editor/WidgetEditorDialog.tsx apps/web/src/dashboard/editor/WidgetEditorDialog.test.tsx apps/web/src/components/ui/dialog.tsx
git -c commit.gpgsign=false commit -m "feat(web): widget editor dialog with live preview (P2-DASH)"
```

---

## PHASE 6 — Dashboard page, filters, routing

### Task 21: Dashboard-level filter bar + editor

**Files:**
- Create: `apps/web/src/dashboard/filters/DashboardFilterBar.tsx`
- Create: `apps/web/src/dashboard/filters/DashboardFilterEditor.tsx`
- Test: `apps/web/src/dashboard/filters/DashboardFilterBar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DashboardFilterBar } from './DashboardFilterBar';

describe('DashboardFilterBar', () => {
  it('emits value changes', () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<DashboardFilterBar filters={[{ id: 'f1', label: 'Status', type: 'text' }]} values={{}} onChange={onChange} />);
    fireEvent.change(getByLabelText('Status'), { target: { value: 'active' } });
    expect(onChange).toHaveBeenCalledWith({ f1: 'active' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/web test DashboardFilterBar`
Expected: FAIL — cannot find `./DashboardFilterBar`.

- [ ] **Step 3: Implement `DashboardFilterBar.tsx`**

```tsx
import { Input } from '@/components/ui/input';
import type { DashboardFilterDef } from '../../api';

export function DashboardFilterBar({ filters, values, onChange }: { filters: DashboardFilterDef[]; values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  if (filters.length === 0) return null;
  const set = (id: string, v: unknown) => onChange({ ...values, [id]: v });
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      {filters.map((f) => (
        <label key={f.id} className="text-sm">{f.label}
          {f.type === 'date' || f.type === 'date-range'
            ? <Input type="date" aria-label={f.label} className="mt-1 w-auto" value={String(values[f.id] ?? '')} onChange={(e) => set(f.id, e.target.value)} />
            : <Input type={f.type === 'number' ? 'number' : 'text'} aria-label={f.label} className="mt-1 w-40" value={String(values[f.id] ?? '')} onChange={(e) => set(f.id, e.target.value)} />}
        </label>
      ))}
    </div>
  );
}
```

`DashboardFilterEditor.tsx`:
```tsx
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2 } from 'lucide-react';
import type { DashboardFilterDef } from '../../api';

export function DashboardFilterEditor({ open, filters, onClose, onSave }: { open: boolean; filters: DashboardFilterDef[]; onClose: () => void; onSave: (f: DashboardFilterDef[]) => void }) {
  const [list, setList] = useState<DashboardFilterDef[]>(filters);
  const add = () => setList([...list, { id: `f-${Math.round(performance.now())}`, label: 'New filter', type: 'text' }]);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Dashboard filters</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-2">
          {list.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2">
              <Input aria-label={`filter-${i}-label`} value={f.label} onChange={(e) => setList(list.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
              <select className="rounded border border-border bg-background p-2" value={f.type} onChange={(e) => setList(list.map((x, j) => j === i ? { ...x, type: e.target.value as DashboardFilterDef['type'] } : x))}>
                <option value="text">text</option><option value="number">number</option><option value="date">date</option><option value="date-range">date-range</option>
              </select>
              <Button size="icon" variant="ghost" aria-label="remove" onClick={() => setList(list.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={add}>Add filter</Button>
          <div className="mt-2 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => { onSave(list); onClose(); }}>Save</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run + verify**

Run: `pnpm --filter @openldr/web test DashboardFilterBar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/dashboard/filters
git -c commit.gpgsign=false commit -m "feat(web): dashboard-level filter bar + editor (P2-DASH)"
```

---

### Task 22: `DashboardPage` (selector, CRUD, edit mode, auto-save) + routing

**Files:**
- Create: `apps/web/src/dashboard/DashboardPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/dashboard/DashboardPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';

afterEach(() => vi.restoreAllMocks());

describe('DashboardPage', () => {
  it('loads dashboards and renders the first one', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
      if (String(url) === '/api/dashboards') return Promise.resolve(new Response(JSON.stringify([{ id: 'd1', ownerId: null, name: 'Overview', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: true }]), { status: 200 }));
      if (String(url).endsWith('/models')) return Promise.resolve(new Response('[]', { status: 200 }));
      if (String(url) === '/api/config') return Promise.resolve(new Response(JSON.stringify({ dashboardSqlEnabled: false }), { status: 200 }));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    const { getByText } = render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await waitFor(() => expect(getByText('Overview')).toBeTruthy());
  });

  it('seeds a default dashboard when none exist', async () => {
    const created: any[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any, init: any) => {
      if (String(url) === '/api/dashboards' && (!init || init.method !== 'POST')) return Promise.resolve(new Response(JSON.stringify(created), { status: 200 }));
      if (String(url) === '/api/dashboards' && init?.method === 'POST') { const d = JSON.parse(init.body); created.push(d); return Promise.resolve(new Response(JSON.stringify(d), { status: 200 })); }
      if (String(url).endsWith('/models')) return Promise.resolve(new Response('[]', { status: 200 }));
      if (String(url) === '/api/config') return Promise.resolve(new Response(JSON.stringify({ dashboardSqlEnabled: false }), { status: 200 }));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    const { findByText } = render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await findByText('Overview')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/web test DashboardPage`
Expected: FAIL — cannot find `./DashboardPage`.

- [ ] **Step 3: Implement `DashboardPage.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { AppShell } from '../shell/AppShell';
import { Button } from '@/components/ui/button';
import { Plus, Pencil, Save, SlidersHorizontal } from 'lucide-react';
import { listDashboards, createDashboard, saveDashboard, fetchClientConfig, type Dashboard } from '../api';
import { useDashboardStore } from './store';
import { DashboardGrid } from './DashboardGrid';
import { DashboardFilterBar } from './filters/DashboardFilterBar';
import { DashboardFilterEditor } from './filters/DashboardFilterEditor';
import { WidgetEditorDialog } from './editor/WidgetEditorDialog';

const DEFAULT_SEED: Dashboard = {
  id: 'default', ownerId: null, name: 'Overview', refreshIntervalSec: 0, isDefault: true, filters: [],
  widgets: [
    { id: 'w-orders', type: 'kpi', title: 'Total Orders', refreshIntervalSec: 0, visual: {}, query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', label: 'Orders', agg: 'count' }, filters: [] } },
    { id: 'w-trend', type: 'line-chart', title: 'Orders by Month', refreshIntervalSec: 0, visual: { xAxisKey: 'label', yAxisKey: 'value' }, query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', label: 'Orders', agg: 'count' }, dimension: { key: 'authored_on', grain: 'month' }, filters: [] } },
    { id: 'w-cat', type: 'bar-chart', title: 'Orders by Test', refreshIntervalSec: 0, visual: { xAxisKey: 'label', yAxisKey: 'value' }, query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', label: 'Orders', agg: 'count' }, dimension: { key: 'code_text' }, filters: [] } },
  ],
  layout: [{ i: 'w-orders', x: 0, y: 0, w: 3, h: 2 }, { i: 'w-trend', x: 3, y: 0, w: 6, h: 4 }, { i: 'w-cat', x: 0, y: 2, w: 6, h: 4 }],
};

export function DashboardPage() {
  const { current, editing, dirty, setCurrent, setEditing, markClean, addWidget } = useDashboardStore();
  const [all, setAll] = useState<Dashboard[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [filterEditorOpen, setFilterEditorOpen] = useState(false);
  const [sqlEnabled, setSqlEnabled] = useState(false);
  const [error, setError] = useState<string>();
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { fetchClientConfig().then((c) => setSqlEnabled(c.dashboardSqlEnabled)).catch(() => {}); }, []);

  useEffect(() => {
    listDashboards().then(async (list) => {
      if (list.length === 0) { const seeded = await createDashboard(DEFAULT_SEED); list = [seeded]; }
      setAll(list); setCurrent(list[0]);
    }).catch((e) => setError(String(e.message ?? e)));
  }, []);

  // Debounced auto-save while editing.
  useEffect(() => {
    if (!editing || !dirty || !current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveDashboard(current).then(() => markClean()).catch((e) => setError(String(e.message ?? e))); }, 1500);
    return () => clearTimeout(saveTimer.current);
  }, [editing, dirty, current]);

  if (!current) return <AppShell title="Dashboard"><div className="ui-scope p-4 text-sm text-muted-foreground">{error ?? 'Loading…'}</div></AppShell>;

  return (
    <AppShell title="Dashboard">
      <div className="ui-scope">
        {error && <div className="mb-3 text-sm text-destructive">{error}</div>}
        <div className="mb-4 flex items-center justify-between">
          <select aria-label="Dashboard" className="rounded border border-border bg-background p-2" value={current.id} onChange={(e) => setCurrent(all.find((d) => d.id === e.target.value)!)}>
            {all.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <div className="flex gap-2">
            {editing && <Button size="sm" variant="outline" onClick={() => setFilterEditorOpen(true)}><SlidersHorizontal className="mr-1 h-4 w-4" />Filters</Button>}
            {editing && <Button size="sm" variant="outline" onClick={() => setEditorOpen(true)}><Plus className="mr-1 h-4 w-4" />Widget</Button>}
            {editing
              ? <Button size="sm" onClick={() => { if (current) saveDashboard(current).then(() => { markClean(); setEditing(false); }); }}><Save className="mr-1 h-4 w-4" />Done</Button>
              : <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="mr-1 h-4 w-4" />Edit</Button>}
          </div>
        </div>
        <DashboardFilterBar filters={current.filters} values={values} onChange={setValues} />
        <DashboardGrid filterValues={values} onEdit={() => setEditorOpen(true)} />
      </div>
      {editorOpen && <WidgetEditorDialog open sqlEnabled={sqlEnabled} onClose={() => setEditorOpen(false)} onSave={(w) => { addWidget(w); setEditorOpen(false); }} />}
      {filterEditorOpen && current && <DashboardFilterEditor open filters={current.filters} onClose={() => setFilterEditorOpen(false)} onSave={(f) => setCurrent({ ...current, filters: f })} />}
    </AppShell>
  );
}
```
(Task 23 adds `fetchClientConfig` to `api.ts`; if implementing 22 first, add a temporary `export async function fetchClientConfig() { return { dashboardSqlEnabled: false }; }` stub and replace it in Task 23.)

- [ ] **Step 4: Wire routing** — in `App.tsx` replace the `/` element and keep `/reports` on the existing report-card page:
```tsx
import { DashboardPage } from './dashboard/DashboardPage';
// ...
<Route path="/" element={<DashboardPage />} />
<Route path="/reports" element={<Dashboard />} />
```

- [ ] **Step 5: Run + verify**

Run: `pnpm --filter @openldr/web test DashboardPage`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/dashboard/DashboardPage.tsx apps/web/src/App.tsx
git -c commit.gpgsign=false commit -m "feat(web): DashboardPage with CRUD, edit mode, auto-save; route / to dashboards (P2-DASH)"
```

---

## PHASE 7 — SQL gate exposure, e2e, docs, final gates

### Task 23: Expose SQL-enabled flag to the frontend

**Files:**
- Modify: `apps/server/src/app.ts` (add `registerConfigRoute` + call it)
- Modify: `apps/web/src/api.ts` (add `fetchClientConfig`)
- Test: `apps/server/src/config-route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerConfigRoute } from './app';

describe('GET /api/config', () => {
  it('reports dashboardSqlEnabled', async () => {
    const app = Fastify();
    registerConfigRoute(app, { cfg: { DASHBOARD_SQL_ENABLED: true, TARGET_STORE_ADAPTER: 'pg' } } as any);
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.json().dashboardSqlEnabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/server test config-route`
Expected: FAIL — `registerConfigRoute` not exported.

- [ ] **Step 3: Implement** — `ctx.cfg` was added to `AppContext` in Task 10. In `app.ts`:

```ts
export function registerConfigRoute(app: FastifyInstance<any, any, any, any>, ctx: { cfg: { DASHBOARD_SQL_ENABLED: boolean; TARGET_STORE_ADAPTER: string } }): void {
  app.get('/api/config', async () => ({ dashboardSqlEnabled: ctx.cfg.DASHBOARD_SQL_ENABLED && ctx.cfg.TARGET_STORE_ADAPTER === 'pg' }));
}
```
Call `registerConfigRoute(app, ctx);` in `buildApp`.

Add to `apps/web/src/api.ts`:
```ts
export interface ClientConfig { dashboardSqlEnabled: boolean }
export async function fetchClientConfig(): Promise<ClientConfig> {
  const r = await fetch('/api/config'); if (!r.ok) return { dashboardSqlEnabled: false }; return r.json();
}
```
(Replace the temporary stub from Task 22 if it was added.)

- [ ] **Step 4: Run + verify**

Run: `pnpm --filter @openldr/server test config-route` then `pnpm --filter @openldr/web test DashboardPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/config-route.test.ts apps/web/src/api.ts
git -c commit.gpgsign=false commit -m "feat: expose dashboardSqlEnabled via /api/config to gate the SQL editor tab (P2-DASH)"
```

---

### Task 24: e2e — create dashboard, add a widget, verify persistence

**Files:**
- Create: `e2e/tests/dashboard.spec.ts`

- [ ] **Step 1: Write the e2e test** (follow the existing `e2e/tests/docs.spec.ts` harness — base URL, server start, any DB seeding the other specs perform)

```ts
import { test, expect } from '@playwright/test';

test('dashboard renders the seeded Overview and edit mode adds a widget', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Total Orders')).toBeVisible();

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Widget' }).click();
  await expect(page.getByLabel('Source')).toBeVisible();
  await page.getByLabel('Title').fill('E2E KPI');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('E2E KPI')).toBeVisible();

  await page.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await expect(page.getByText('E2E KPI')).toBeVisible();
});
```

- [ ] **Step 2: Run**

Run: `pnpm e2e -- dashboard` (or the repo's documented e2e command, e.g. `pnpm --filter e2e test dashboard`)
Expected: PASS. Assertions check widget chrome (titles), not data values, so an empty warehouse (KPIs show `0`) still passes.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/dashboard.spec.ts
git -c commit.gpgsign=false commit -m "test(e2e): dashboard create/edit/persist flow (P2-DASH)"
```

---

### Task 25: Screenshots + docs entry

**Files:**
- Modify: `e2e/capture-docs/docs-screenshots.spec.ts` (add a dashboard capture, mirroring the existing pattern)
- Create: an in-app docs markdown page describing dashboards (follow the bundled-markdown content path used by P2-DOC — locate it with `git grep -l "getting-started" apps/web/src` or inspect `apps/web/src/docs`)

- [ ] **Step 1: Add a screenshot capture** following the existing capture spec; output to the committed screenshots dir.

Run: `pnpm docs:screenshots`
Expected: a new dashboard screenshot is written.

- [ ] **Step 2: Add a docs page** — create the markdown doc in the same content directory the other docs pages live in, covering: creating a dashboard, adding builder widgets, dashboard filters, and the (PG-only, config-gated) SQL escape hatch. Register it in the docs index/nav the same way existing pages are registered.

- [ ] **Step 3: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "docs(dashboards): in-app docs page + committed screenshots (P2-DASH)"
```

---

### Task 26: Full-repo gate + finish

- [ ] **Step 1: Run the whole pipeline**

Run: `pnpm -w turbo typecheck lint test build`
Expected: all green.

- [ ] **Step 2: dependency-cruiser on the whole repo**

Run: `npx depcruise packages apps --config .dependency-cruiser.cjs`
Expected: no violations.

- [ ] **Step 3: Manual smoke** (recommended) — run the dev server (`pnpm dev`) against a migrated+seeded DB, visit `/`, confirm the Overview dashboard renders, toggle Edit, add a builder widget, reload to confirm persistence.

- [ ] **Step 4: Final commit (if any fixups)**

```bash
git add -A
git -c commit.gpgsign=false commit -m "chore(dashboards): full pipeline green (P2-DASH)"
```

- [ ] **Step 5: Integrate** — use the `superpowers:finishing-a-development-branch` skill to open a PR from `feat/p2-dashboards` → `main` (or merge per repo norms). Update memory `MEMORY.md` / build-plan to record P2-DASH.

---

## Self-Review Notes

- **Spec coverage:** package/types (T1–2), registry (T3), compiler (T4), gated SQL validator+runner (T5, T10, T23), persistence/migration/store (T6–7), seed (T8), config flags (T9), bootstrap wiring (T10), routes (T11), deps+API client (T13), zustand store (T14), 12 widget renderers (T15), widget fetch+binding (T16), grid (T17), builder/SQL/editor (T18–20), filters (T21), page+routing+auto-save (T22), SQL gate exposure (T23), e2e (T24), screenshots+docs (T25), gates (T12, T26). Every spec section maps to a task.
- **Naming consistency:** store CRUD = `create/get/list/update/remove`; render entry = `renderWidget`; runners = `runWidgetQuery` (web) / `ctx.dashboards.query` (server) / `runBuilderQuery`+`runSqlQuery` (domain); error = `DashboardQueryError`; `ctx.cfg` added in T10 and consumed in T23. Consistent across tasks.
- **Known follow-ups (not blockers):** dependency-cruiser may require dashboards to avoid importing `@openldr/reporting` at runtime — T12 Step 2 gives the local-types fallback. The SQL editor tab stays hidden until T23 wires `/api/config`. Per-user ownership, visual-config controls (axis/threshold pickers in the editor), widget duplication, and dashboard import/export JSON are intentionally deferred (spec *Out of scope* / future slices).
```