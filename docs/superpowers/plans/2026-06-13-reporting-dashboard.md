# Reporting Layer + Dashboard SPA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `@openldr/reporting` Kysely query layer + four curated reports over the external flat tables, expose them via the server API + CLI, and stand up a React+Vite dashboard SPA (Corlix design) served by `apps/server`.

**Architecture:** `@openldr/reporting` holds a catalog of `ReportDefinition`s; each `run(db, params)` does filtering/joins/grouping in Kysely and pivoting/bucketing/date-math in pure JS helpers (zero raw SQL → portable + unit-testable). Bootstrap binds the catalog to the external `Kysely<ExternalSchema>` (`ctx.reporting`); `apps/server` serves `/api/reports*` and the built SPA; `apps/web` is a React+Vite SPA reimplementing the Corlix design tokens.

**Tech Stack:** TypeScript (ESM), Kysely, zod, Fastify + `@fastify/static`, React + Vite + React Router + Recharts, Vitest (+ Testing Library for the SPA).

**Reference:** `docs/superpowers/specs/2026-06-13-reporting-dashboard-design.md`

**Conventions:** Commits `git -c commit.gpgsign=false commit`, **no** `Co-authored-by` trailer (P1-CONV-2). Local imports omit extensions; `import type` for type-only. `@openldr/reporting` imports no `adapter-*` (DP-1). Reports do filtering/joins/grouping in Kysely; all pivot/bucket/date math is in pure helpers (no hand-written SQL strings).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/reporting/src/types.ts` | `ChartHint`, `ReportColumn`, `ReportResult`, `ReportDefinition` |
| `packages/reporting/src/helpers.ts` | pure helpers: `pivotResistance`, `ageBand`, `monthKey`, `hoursBetween`, `toCsv` |
| `packages/reporting/src/reports/*.ts` | the 4 report definitions |
| `packages/reporting/src/catalog.ts` | `reportCatalog()` / `getReport()` / `reportSummaries()` |
| `packages/reporting/src/index.ts` | public surface (modify) |
| `packages/bootstrap/src/index.ts` | add `reporting` to `AppContext` + `ReportNotFoundError` (modify) |
| `apps/server/src/reports-routes.ts` | report API route plugin |
| `apps/server/src/app.ts` | register routes + static SPA (modify) |
| `packages/cli/src/report.ts` + `index.ts` | `report list|run` |
| `apps/web/*` | the React+Vite SPA (new app) |

---

## Task 1: `@openldr/reporting` — types, pure helpers, param schemas

**Files:**
- Modify: `packages/reporting/package.json`
- Create: `packages/reporting/src/types.ts`, `packages/reporting/src/helpers.ts`, `packages/reporting/src/helpers.test.ts`, `packages/reporting/tsconfig.json` (if missing)

- [ ] **Step 1: Replace `packages/reporting/package.json`**

```json
{
  "name": "@openldr/reporting",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo \"no lint\""
  },
  "dependencies": {
    "@openldr/core": "workspace:*",
    "@openldr/db": "workspace:*",
    "kysely": "^0.27.5",
    "zod": "^3.24.1"
  },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

Ensure `packages/reporting/tsconfig.json` exists with `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`.

- [ ] **Step 2: Create `packages/reporting/src/types.ts`**

```ts
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ZodType } from 'zod';

export type ChartHint =
  | { type: 'bar'; x: string; y: string; series?: string }
  | { type: 'line'; x: string; y: string; series?: string }
  | { type: 'pie'; label: string; value: string }
  | { type: 'stat'; value: string; label: string };

export interface ReportColumn {
  key: string;
  label: string;
  kind: 'string' | 'number' | 'percent' | 'date';
}

export interface ReportResultData {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  chart: ChartHint;
}

export interface ReportResult extends ReportResultData {
  meta: { generatedAt: string; rowCount: number };
}

export interface ReportSummary {
  id: string;
  name: string;
  description: string;
}

export interface ReportDefinition<P = unknown> {
  id: string;
  name: string;
  description: string;
  params: ZodType<P>;
  run(db: Kysely<ExternalSchema>, params: P): Promise<ReportResultData>;
}
```

- [ ] **Step 3: Create `packages/reporting/src/helpers.ts`**

```ts
/** Pivot grouped interpretation rows into per-antibiotic R/I/S counts + %R. */
export function pivotResistance(
  grouped: { antibiotic: string; interpretation_code: string; n: number }[],
): { antibiotic: string; tested: number; r: number; i: number; s: number; percentR: number }[] {
  const byAb = new Map<string, { antibiotic: string; tested: number; r: number; i: number; s: number; percentR: number }>();
  for (const row of grouped) {
    const e = byAb.get(row.antibiotic) ?? { antibiotic: row.antibiotic, tested: 0, r: 0, i: 0, s: 0, percentR: 0 };
    const n = Number(row.n) || 0;
    e.tested += n;
    if (row.interpretation_code === 'R') e.r += n;
    else if (row.interpretation_code === 'I') e.i += n;
    else if (row.interpretation_code === 'S') e.s += n;
    byAb.set(row.antibiotic, e);
  }
  const out = [...byAb.values()];
  for (const e of out) e.percentR = e.tested === 0 ? 0 : Math.round((e.r / e.tested) * 1000) / 10;
  out.sort((a, b) => b.percentR - a.percentR);
  return out;
}

/** Age band from an ISO birth date relative to a reference ISO date. */
export function ageBand(birthDate: string | null, refIso: string): string {
  if (!birthDate) return 'unknown';
  const b = new Date(birthDate);
  const ref = new Date(refIso);
  if (Number.isNaN(b.getTime())) return 'unknown';
  let age = ref.getFullYear() - b.getFullYear();
  const m = ref.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < b.getDate())) age--;
  if (age < 0) return 'unknown';
  if (age <= 4) return '0-4';
  if (age <= 14) return '5-14';
  if (age <= 24) return '15-24';
  if (age <= 49) return '25-49';
  return '50+';
}

/** YYYY-MM bucket from an ISO timestamp; null/invalid → 'unknown'. */
export function monthKey(iso: string | null): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Whole hours between two ISO timestamps, or null if either is missing/invalid or end<start. */
export function hoursBetween(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 3_600_000);
}

/** Render columns+rows as RFC-4180-ish CSV. */
export function toCsv(columns: { key: string; label: string }[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(',')).join('\n');
  return body ? `${header}\n${body}\n` : `${header}\n`;
}
```

- [ ] **Step 4: Create `packages/reporting/src/helpers.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { pivotResistance, ageBand, monthKey, hoursBetween, toCsv } from './helpers';

describe('pivotResistance', () => {
  it('sums per antibiotic and computes %R sorted desc', () => {
    const out = pivotResistance([
      { antibiotic: 'AMP', interpretation_code: 'R', n: 3 },
      { antibiotic: 'AMP', interpretation_code: 'S', n: 1 },
      { antibiotic: 'CIP', interpretation_code: 'S', n: 4 },
    ]);
    expect(out[0]).toMatchObject({ antibiotic: 'AMP', tested: 4, r: 3, s: 1, percentR: 75 });
    expect(out[1]).toMatchObject({ antibiotic: 'CIP', tested: 4, r: 0, percentR: 0 });
  });
});

describe('ageBand', () => {
  it('buckets ages and handles unknown', () => {
    expect(ageBand('1990-01-01', '2026-01-01')).toBe('25-49');
    expect(ageBand('2024-01-01', '2026-01-01')).toBe('0-4');
    expect(ageBand(null, '2026-01-01')).toBe('unknown');
    expect(ageBand('not-a-date', '2026-01-01')).toBe('unknown');
  });
});

describe('monthKey', () => {
  it('buckets by year-month', () => {
    expect(monthKey('2026-01-10T00:00:00Z')).toBe('2026-01');
    expect(monthKey(null)).toBe('unknown');
  });
});

describe('hoursBetween', () => {
  it('computes hours and rejects bad/negative', () => {
    expect(hoursBetween('2026-01-10T00:00:00Z', '2026-01-11T00:00:00Z')).toBe(24);
    expect(hoursBetween('2026-01-11T00:00:00Z', '2026-01-10T00:00:00Z')).toBeNull();
    expect(hoursBetween(null, '2026-01-11T00:00:00Z')).toBeNull();
  });
});

describe('toCsv', () => {
  it('escapes and renders', () => {
    const csv = toCsv([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], [{ a: 'x,y', b: 1 }]);
    expect(csv).toBe('A,B\n"x,y",1\n');
  });
});
```

- [ ] **Step 5: Temporary `packages/reporting/src/index.ts`**

```ts
export * from './types';
export * from './helpers';
```

- [ ] **Step 6: Install, test, typecheck**

Run: `pnpm install && pnpm --filter @openldr/reporting test && pnpm --filter @openldr/reporting typecheck`
Expected: helper tests pass; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(reporting): report types + pure aggregation helpers (P1-REP-1)"
```

---

## Task 2: `@openldr/reporting` — the four reports + catalog

**Files:**
- Create: `packages/reporting/src/reports/amr-resistance.ts`, `test-volume.ts`, `patient-demographics.ts`, `turnaround-time.ts`, `packages/reporting/src/catalog.ts`, `packages/reporting/src/catalog.test.ts`
- Modify: `packages/reporting/src/index.ts`

- [ ] **Step 1: Create `packages/reporting/src/reports/amr-resistance.ts`**

```ts
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportDefinition, ReportResultData } from '../types';
import { pivotResistance } from '../helpers';

const params = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  facility: z.string().optional(),
});
type Params = z.infer<typeof params>;

export const amrResistance: ReportDefinition<Params> = {
  id: 'amr-resistance',
  name: 'AMR Resistance Rate',
  description: 'Resistant/Intermediate/Susceptible counts and %R by antibiotic.',
  params,
  async run(db: Kysely<ExternalSchema>, p: Params): Promise<ReportResultData> {
    let subjectRefs: string[] | null = null;
    if (p.facility) {
      const ids = await db.selectFrom('patients').select('id').where('managing_organization', '=', p.facility).execute();
      subjectRefs = ids.map((r) => `Patient/${r.id}`);
      if (subjectRefs.length === 0) {
        return emptyResult();
      }
    }
    let q = db
      .selectFrom('observations')
      .where('interpretation_code', 'in', ['S', 'I', 'R'])
      .select(['code_text as antibiotic', 'interpretation_code'])
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .groupBy(['code_text', 'interpretation_code']);
    if (p.from) q = q.where('effective_date_time', '>=', p.from);
    if (p.to) q = q.where('effective_date_time', '<=', p.to);
    if (subjectRefs) q = q.where('subject_ref', 'in', subjectRefs);
    const grouped = await q.execute();
    const pivoted = pivotResistance(
      grouped.map((r) => ({ antibiotic: r.antibiotic ?? '(unknown)', interpretation_code: String(r.interpretation_code), n: Number(r.n) })),
    );
    return { ...emptyResult(), rows: pivoted };
  },
};

function emptyResult(): ReportResultData {
  return {
    columns: [
      { key: 'antibiotic', label: 'Antibiotic', kind: 'string' },
      { key: 'tested', label: 'Tested', kind: 'number' },
      { key: 'r', label: 'R', kind: 'number' },
      { key: 'i', label: 'I', kind: 'number' },
      { key: 's', label: 'S', kind: 'number' },
      { key: 'percentR', label: '%R', kind: 'percent' },
    ],
    rows: [],
    chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
  };
}
```

- [ ] **Step 2: Create `packages/reporting/src/reports/test-volume.ts`**

```ts
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportDefinition, ReportResultData } from '../types';
import { monthKey } from '../helpers';

const params = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  facility: z.string().optional(),
});
type Params = z.infer<typeof params>;

export const testVolume: ReportDefinition<Params> = {
  id: 'test-volume',
  name: 'Test Volume Over Time',
  description: 'Count of service requests by test and month.',
  params,
  async run(db: Kysely<ExternalSchema>, p: Params): Promise<ReportResultData> {
    let q = db.selectFrom('service_requests').select(['code_text', 'authored_on']);
    if (p.from) q = q.where('authored_on', '>=', p.from);
    if (p.to) q = q.where('authored_on', '<=', p.to);
    const reqs = await q.execute();
    const counts = new Map<string, number>();
    for (const r of reqs) {
      const key = `${monthKey(r.authored_on)} ${r.code_text ?? '(unknown)'}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const rows = [...counts.entries()]
      .map(([k, count]) => {
        const [month, test] = k.split(' ');
        return { month, test, count };
      })
      .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.test.localeCompare(b.test)));
    return {
      columns: [
        { key: 'month', label: 'Month', kind: 'string' },
        { key: 'test', label: 'Test', kind: 'string' },
        { key: 'count', label: 'Count', kind: 'number' },
      ],
      rows,
      chart: { type: 'line', x: 'month', y: 'count', series: 'test' },
    };
  },
};
```

- [ ] **Step 3: Create `packages/reporting/src/reports/patient-demographics.ts`**

```ts
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportDefinition, ReportResultData } from '../types';
import { ageBand } from '../helpers';

const params = z.object({ facility: z.string().optional(), asOf: z.string().optional() });
type Params = z.infer<typeof params>;

const ORDER = ['0-4', '5-14', '15-24', '25-49', '50+', 'unknown'];

export const patientDemographics: ReportDefinition<Params> = {
  id: 'patient-demographics',
  name: 'Patient Demographics',
  description: 'Patient counts by age band and gender.',
  params,
  async run(db: Kysely<ExternalSchema>, p: Params): Promise<ReportResultData> {
    let q = db.selectFrom('patients').select(['gender', 'birth_date']);
    if (p.facility) q = q.where('managing_organization', '=', p.facility);
    const patients = await q.execute();
    const ref = p.asOf ?? '2026-01-01T00:00:00Z';
    const counts = new Map<string, { band: string; total: number; male: number; female: number; other: number }>();
    for (const pt of patients) {
      const band = ageBand(pt.birth_date, ref);
      const e = counts.get(band) ?? { band, total: 0, male: 0, female: 0, other: 0 };
      e.total++;
      if (pt.gender === 'male') e.male++;
      else if (pt.gender === 'female') e.female++;
      else e.other++;
      counts.set(band, e);
    }
    const rows = ORDER.filter((b) => counts.has(b)).map((b) => counts.get(b)!);
    return {
      columns: [
        { key: 'band', label: 'Age band', kind: 'string' },
        { key: 'total', label: 'Total', kind: 'number' },
        { key: 'male', label: 'Male', kind: 'number' },
        { key: 'female', label: 'Female', kind: 'number' },
        { key: 'other', label: 'Other/unknown', kind: 'number' },
      ],
      rows,
      chart: { type: 'pie', label: 'band', value: 'total' },
    };
  },
};
```

- [ ] **Step 4: Create `packages/reporting/src/reports/turnaround-time.ts`**

```ts
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportDefinition, ReportResultData } from '../types';
import { hoursBetween } from '../helpers';

const params = z.object({ from: z.string().optional(), to: z.string().optional(), facility: z.string().optional() });
type Params = z.infer<typeof params>;

export const turnaroundTime: ReportDefinition<Params> = {
  id: 'turnaround-time',
  name: 'Specimen Turnaround Time',
  description: 'Average hours from specimen received to report issued, by test.',
  params,
  async run(db: Kysely<ExternalSchema>, p: Params): Promise<ReportResultData> {
    // Join reports to their subject's specimen via subject_ref; date math in JS (portable, no raw SQL).
    let q = db
      .selectFrom('diagnostic_reports as dr')
      .innerJoin('specimens as sp', 'sp.subject_ref', 'dr.subject_ref')
      .select(['dr.code_text as test', 'sp.received_time as received', 'dr.issued as issued']);
    if (p.from) q = q.where('dr.issued', '>=', p.from);
    if (p.to) q = q.where('dr.issued', '<=', p.to);
    const joined = await q.execute();
    const byTest = new Map<string, { test: string; n: number; sum: number; min: number; max: number }>();
    for (const row of joined) {
      const h = hoursBetween(row.received, row.issued);
      if (h === null) continue;
      const test = row.test ?? '(unknown)';
      const e = byTest.get(test) ?? { test, n: 0, sum: 0, min: h, max: h };
      e.n++;
      e.sum += h;
      e.min = Math.min(e.min, h);
      e.max = Math.max(e.max, h);
      byTest.set(test, e);
    }
    const rows = [...byTest.values()].map((e) => ({ test: e.test, count: e.n, avgHours: Math.round((e.sum / e.n) * 10) / 10, minHours: e.min, maxHours: e.max }));
    rows.sort((a, b) => b.avgHours - a.avgHours);
    const overallN = rows.reduce((s, r) => s + r.count, 0);
    const overallAvg = overallN === 0 ? 0 : Math.round((rows.reduce((s, r) => s + r.avgHours * r.count, 0) / overallN) * 10) / 10;
    return {
      columns: [
        { key: 'test', label: 'Test', kind: 'string' },
        { key: 'count', label: 'Reports', kind: 'number' },
        { key: 'avgHours', label: 'Avg hours', kind: 'number' },
        { key: 'minHours', label: 'Min', kind: 'number' },
        { key: 'maxHours', label: 'Max', kind: 'number' },
      ],
      rows,
      chart: { type: 'stat', value: String(overallAvg), label: 'Overall avg hours' },
    };
  },
};
```

- [ ] **Step 5: Create `packages/reporting/src/catalog.ts`**

```ts
import type { ReportDefinition, ReportSummary } from './types';
import { amrResistance } from './reports/amr-resistance';
import { testVolume } from './reports/test-volume';
import { patientDemographics } from './reports/patient-demographics';
import { turnaroundTime } from './reports/turnaround-time';

const REPORTS: ReportDefinition[] = [amrResistance, testVolume, patientDemographics, turnaroundTime] as ReportDefinition[];

export function reportCatalog(): ReportDefinition[] {
  return REPORTS;
}

export function getReport(id: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.id === id);
}

export function reportSummaries(): ReportSummary[] {
  return REPORTS.map((r) => ({ id: r.id, name: r.name, description: r.description }));
}
```

- [ ] **Step 6: Create `packages/reporting/src/catalog.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { reportCatalog, getReport, reportSummaries } from './catalog';

describe('catalog', () => {
  it('exposes the four reports', () => {
    expect(reportCatalog().map((r) => r.id).sort()).toEqual(['amr-resistance', 'patient-demographics', 'test-volume', 'turnaround-time']);
  });
  it('getReport finds and misses', () => {
    expect(getReport('amr-resistance')?.name).toBe('AMR Resistance Rate');
    expect(getReport('nope')).toBeUndefined();
  });
  it('amr params reject wrong-typed input but accept empty', () => {
    expect(getReport('amr-resistance')!.params.safeParse({}).success).toBe(true);
    expect(getReport('amr-resistance')!.params.safeParse({ from: 5 }).success).toBe(false);
  });
  it('reportSummaries returns id+name+description', () => {
    expect(reportSummaries()[0]).toHaveProperty('description');
  });
});
```

- [ ] **Step 7: Replace `packages/reporting/src/index.ts`**

```ts
export * from './types';
export * from './helpers';
export * from './catalog';
```

- [ ] **Step 8: Test + typecheck**

Run: `pnpm --filter @openldr/reporting test && pnpm --filter @openldr/reporting typecheck`
Expected: helpers + catalog tests pass; typecheck clean. (The `run()` queries are exercised in Task 11 against docker.)

- [ ] **Step 9: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(reporting): amr/volume/demographics/TAT reports + catalog (P1-REP-1/3)"
```

---

## Task 3: `@openldr/bootstrap` — expose `reporting` on AppContext

**Files:**
- Modify: `packages/bootstrap/package.json` (add `@openldr/reporting`), `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Add dep** — in `packages/bootstrap/package.json` dependencies add `"@openldr/reporting": "workspace:*",`. Run `pnpm install`.

- [ ] **Step 2: Edit `packages/bootstrap/src/index.ts`**

Add imports near the top (note `Kysely` is a value import; if the file already imports `Kysely`, reuse it):

```ts
import { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import { getReport, reportSummaries, type ReportResult, type ReportSummary } from '@openldr/reporting';
```

Add an error class + the reporting interface (above the `AppContext` interface):

```ts
export class ReportNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`unknown report: ${id}`);
    this.name = 'ReportNotFoundError';
  }
}

export interface ReportingApi {
  list(): ReportSummary[];
  run(id: string, rawParams: unknown): Promise<ReportResult>;
}
```

Add `reporting: ReportingApi;` to the `AppContext` interface (after `store`).

In `createAppContext`, after `const store = createDbStore({ url: cfg.TARGET_DATABASE_URL });`, build the reporting api:

```ts
  const reportingDb = store.db as unknown as Kysely<ExternalSchema>;
  const reporting: ReportingApi = {
    list: () => reportSummaries(),
    async run(id, rawParams) {
      const def = getReport(id);
      if (!def) throw new ReportNotFoundError(id);
      const params = def.params.parse(rawParams); // throws ZodError on invalid
      const data = await def.run(reportingDb, params);
      return { ...data, meta: { generatedAt: new Date().toISOString(), rowCount: data.rows.length } };
    },
  };
```

Add `reporting,` to the returned `AppContext` object literal (next to `store,`).

> `new Date()` here is fine — bootstrap is the composition root, not a workflow script. Report `run()` functions stay clock-free; only the meta stamp uses the clock.

- [ ] **Step 3: Typecheck + depcruise**

Run: `pnpm install && pnpm --filter @openldr/bootstrap typecheck && pnpm depcruise`
Expected: typecheck clean; depcruise NO violations (`@openldr/reporting` imports no adapter). If depcruise flags a violation, STOP and report.

- [ ] **Step 4: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(bootstrap): expose reporting api on AppContext (DP-1)"
```

---

## Task 4: `apps/server` — report API routes

**Files:**
- Create: `apps/server/src/reports-routes.ts`, `apps/server/src/reports-routes.test.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/package.json`

- [ ] **Step 1: Add `@openldr/reporting` to `apps/server/package.json` dependencies** (`"@openldr/reporting": "workspace:*"`).

- [ ] **Step 2: Create `apps/server/src/reports-routes.ts`**

```ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { ReportNotFoundError, type AppContext } from '@openldr/bootstrap';
import { toCsv } from '@openldr/reporting';

export function registerReportRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/reports', async () => ctx.reporting.list());

  // Register the .csv route BEFORE the bare :id route so it is matched first.
  app.get('/api/reports/:id.csv', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const result = await ctx.reporting.run(id, req.query);
      reply.header('content-type', 'text/csv').header('content-disposition', `attachment; filename="${id}.csv"`);
      return toCsv(result.columns, result.rows);
    } catch (err) {
      return mapError(err, reply);
    }
  });

  app.get('/api/reports/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await ctx.reporting.run(id, req.query);
    } catch (err) {
      return mapError(err, reply);
    }
  });
}

function mapError(err: unknown, reply: FastifyReply): { error: string } {
  if (err instanceof ReportNotFoundError) {
    reply.code(404);
    return { error: err.message };
  }
  if (err instanceof ZodError) {
    reply.code(400);
    return { error: 'invalid parameters' };
  }
  const msg = err instanceof Error ? err.message : String(err);
  // A connection-layer failure degrades this endpoint to 503; the server stays up.
  const isConn = /ECONNREFUSED|ETIMEDOUT|connection|connect/i.test(msg);
  reply.code(isConn ? 503 : 500);
  return { error: msg };
}
```

> Fastify route note: registering `:id.csv` before `:id` makes the literal `.csv` suffix match first. Verify with the CSV test below — it must hit the CSV handler, not `:id` with id=`amr-resistance.csv`. If the framework still routes greedily, change the CSV route to `/api/reports/:id/csv` and update `csvUrl` in the SPA (Task 6 Step 6) to match.

- [ ] **Step 3: Edit `apps/server/src/app.ts`** — register the routes (static SPA added in Task 10). Replace the file with:

```ts
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerReportRoutes } from './reports-routes';

export function buildApp(ctx: AppContext) {
  const app = Fastify({ loggerInstance: ctx.logger });

  app.get('/health', async (_req, reply) => {
    const result = await ctx.health.runAll();
    reply.code(result.status === 'down' ? 503 : 200);
    return result;
  });

  registerReportRoutes(app, ctx);

  return app;
}
```

- [ ] **Step 4: Create `apps/server/src/reports-routes.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerReportRoutes } from './reports-routes';
import { ReportNotFoundError } from '@openldr/bootstrap';

function appWith(reporting: unknown) {
  const app = Fastify();
  registerReportRoutes(app, { reporting } as never);
  return app;
}

const okResult = {
  columns: [{ key: 'antibiotic', label: 'Antibiotic', kind: 'string' }, { key: 'percentR', label: '%R', kind: 'percent' }],
  rows: [{ antibiotic: 'AMP', percentR: 72 }],
  chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
  meta: { generatedAt: '2026-01-01T00:00:00Z', rowCount: 1 },
};

describe('report routes', () => {
  it('GET /api/reports lists', async () => {
    const app = appWith({ list: () => [{ id: 'amr-resistance', name: 'AMR', description: 'd' }], run: vi.fn() });
    const res = await app.inject({ method: 'GET', url: '/api/reports' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('GET /api/reports/:id returns result', async () => {
    const app = appWith({ list: vi.fn(), run: vi.fn(async () => okResult) });
    const res = await app.inject({ method: 'GET', url: '/api/reports/amr-resistance?from=2026-01-01' });
    expect(res.statusCode).toBe(200);
    expect(res.json().rows[0].antibiotic).toBe('AMP');
  });

  it('404 on unknown report', async () => {
    const app = appWith({ list: vi.fn(), run: vi.fn(async () => { throw new ReportNotFoundError('nope'); }) });
    const res = await app.inject({ method: 'GET', url: '/api/reports/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('400 on invalid params (ZodError)', async () => {
    const { ZodError } = await import('zod');
    const app = appWith({ list: vi.fn(), run: vi.fn(async () => { throw new ZodError([]); }) });
    const res = await app.inject({ method: 'GET', url: '/api/reports/amr-resistance' });
    expect(res.statusCode).toBe(400);
  });

  it('503 on connection failure', async () => {
    const app = appWith({ list: vi.fn(), run: vi.fn(async () => { throw new Error('connect ECONNREFUSED'); }) });
    const res = await app.inject({ method: 'GET', url: '/api/reports/amr-resistance' });
    expect(res.statusCode).toBe(503);
  });

  it('CSV export sets content-type and hits the csv handler', async () => {
    const app = appWith({ list: vi.fn(), run: vi.fn(async () => okResult) });
    const res = await app.inject({ method: 'GET', url: '/api/reports/amr-resistance.csv' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('Antibiotic,%R');
  });
});
```

- [ ] **Step 5: Test + typecheck**

Run: `pnpm install && pnpm --filter @openldr/server test && pnpm --filter @openldr/server typecheck`
Expected: route tests pass; typecheck clean. If the CSV test fails because `:id` captured `amr-resistance.csv`, apply the `/:id/csv` fallback from the Step 2 note.

- [ ] **Step 6: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(server): report API routes (list/run/csv) (P1-REP-1)"
```

---

## Task 5: CLI — `report list` / `report run`

**Files:**
- Create: `packages/cli/src/report.ts`
- Modify: `packages/cli/src/index.ts`, `packages/cli/package.json`

- [ ] **Step 1: Add `@openldr/reporting` to `packages/cli/package.json` dependencies** (`"@openldr/reporting": "workspace:*"`).

- [ ] **Step 2: Create `packages/cli/src/report.ts`**

```ts
import { createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { toCsv } from '@openldr/reporting';

interface RunOpts {
  param?: string[];
  json: boolean;
  csv: boolean;
}

function parseParams(pairs: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    const idx = p.indexOf('=');
    if (idx > 0) out[p.slice(0, idx)] = p.slice(idx + 1);
  }
  return out;
}

export async function runReportList(opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const rows = ctx.reporting.list();
    if (opts.json) process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    else process.stdout.write(rows.map((r) => `  ${r.id.padEnd(22)} ${r.name}`).join('\n') + '\n');
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runReportRun(id: string, opts: RunOpts): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const result = await ctx.reporting.run(id, parseParams(opts.param));
    if (opts.csv) process.stdout.write(toCsv(result.columns, result.rows));
    else if (opts.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else {
      const header = result.columns.map((c) => c.label).join(' | ');
      const body = result.rows.map((r) => result.columns.map((c) => String(r[c.key] ?? '')).join(' | ')).join('\n');
      process.stdout.write(`${header}\n${body || '(no rows)'}\n`);
    }
    return 0;
  } finally {
    await ctx.close();
  }
}
```

- [ ] **Step 3: Register in `packages/cli/src/index.ts`** — add the import beside the others:

```ts
import { runReportList, runReportRun } from './report';
```

Insert before `program.parseAsync(process.argv);`:

```ts
const report = program.command('report').description('Domain reports over the analytics DB');
report.command('list').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runReportList(opts); } catch (err) { process.stderr.write(`report list failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});
report
  .command('run <id>')
  .option('--param <kv...>', 'parameter as key=value (repeatable)')
  .option('--json', 'emit JSON', false)
  .option('--csv', 'emit CSV', false)
  .action(async (id: string, opts: { param?: string[]; json: boolean; csv: boolean }) => {
    try { process.exitCode = await runReportRun(id, opts); } catch (err) { process.stderr.write(`report run failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
  });
```

(`errorMessage` is already imported in index.ts — do not duplicate.)

- [ ] **Step 4: Install, typecheck, build**

Run: `pnpm install && pnpm --filter @openldr/cli typecheck && pnpm --filter @openldr/cli build`
Expected: typecheck clean; `dist/index.js` produced. (Runtime verified in Task 11.)

- [ ] **Step 5: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(cli): report list/run (P1-CLI-1/2)"
```

---

## Task 6: `apps/web` — Vite + React scaffold + design tokens

**Files (all new under `apps/web/`):** `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/tokens.css`, `src/api.ts`, `src/setupTests.ts`

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@openldr/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo \"no lint\""
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0",
    "recharts": "^2.13.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.2",
    "vite": "^6.0.0",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `apps/web/tsconfig.json`** (browser/DOM — does NOT extend the node-only base)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/web/vite.config.ts`**

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/setupTests.ts'] },
});
```

- [ ] **Step 4: Create `apps/web/index.html`**

```html
<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenLDR</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `apps/web/src/tokens.css`** (Corlix design tokens)

```css
:root {
  --brand: #4682B4; --link: #5A9BD6; --link-hover: #7BB3D9; --brand-deep: #365F8A;
  --brand-wash: rgba(70,130,180,0.15); --brand-border: rgba(70,130,180,0.3);
  --success: #22c55e; --warning: #f59e0b; --danger: #ef4444;
  --radius-sm: 4px; --radius: 6px; --radius-lg: 8px; --radius-pill: 9999px;
  --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --mono: 'JetBrains Mono', 'Fira Code', Menlo, monospace;
}
:root[data-theme='dark'] {
  --bg: #171717; --sidebar: #1a1a1a; --card: #1e1e1e;
  --border: #2e2e2e; --border-2: #363636; --rule: #242424;
  --text: #fafafa; --text-muted: #898989; --table-head: #1a1a1a;
}
:root[data-theme='light'] {
  --bg: #ffffff; --sidebar: #fafafa; --card: #ffffff;
  --border: #e4e4e7; --border-2: #d4d4d8; --rule: #e4e4e7;
  --text: #18181b; --text-muted: #71717a; --table-head: #f4f4f5;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: var(--font); font-size: 14px; line-height: 1.5; background: var(--bg); color: var(--text); }
h1 { font-size: 24px; font-weight: 600; } h2 { font-size: 18px; font-weight: 600; } h3 { font-size: 16px; font-weight: 500; }
a { color: var(--link); text-decoration: none; }
code, .mono { font-family: var(--mono); font-size: 13px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; }
.btn-primary { background: var(--brand); color: #fff; border: none; border-radius: var(--radius-pill); padding: 8px 24px; font: 500 14px var(--font); cursor: pointer; display: inline-block; }
.btn-primary:hover { background: var(--link); }
.btn-secondary { background: transparent; color: var(--text); border: 1px solid var(--border-2); border-radius: var(--radius); padding: 8px 16px; cursor: pointer; }
.badge { border-radius: var(--radius-pill); padding: 2px 10px; font-size: 12px; font-weight: 500; }
.badge-danger { background: rgba(239,68,68,0.15); color: var(--danger); }
.badge-warning { background: rgba(245,158,11,0.15); color: var(--warning); }
.badge-success { background: rgba(34,197,94,0.15); color: var(--success); }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { background: var(--table-head); text-align: left; font-size: 13px; font-weight: 500; text-transform: uppercase; padding: 12px 16px; color: var(--text-muted); }
td { padding: 12px 16px; border-top: 1px solid var(--rule); }
tr:hover td { background: rgba(70,130,180,0.08); }
:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(70,130,180,0.5); }
```

- [ ] **Step 6: Create `apps/web/src/api.ts`**

```ts
export interface ReportSummary { id: string; name: string; description: string }
export interface ChartHint {
  type: 'bar' | 'line' | 'pie' | 'stat';
  x?: string; y?: string; series?: string; label?: string; value?: string;
}
export interface ReportColumn { key: string; label: string; kind: 'string' | 'number' | 'percent' | 'date' }
export interface ReportResult {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  chart: ChartHint;
  meta: { generatedAt: string; rowCount: number };
}

export async function fetchReports(): Promise<ReportSummary[]> {
  const res = await fetch('/api/reports');
  if (!res.ok) throw new Error(`reports list failed: ${res.status}`);
  return res.json() as Promise<ReportSummary[]>;
}

export async function fetchReport(id: string, params: Record<string, string> = {}): Promise<ReportResult> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/reports/${id}${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`report ${id} failed: ${res.status}`);
  return res.json() as Promise<ReportResult>;
}

export function csvUrl(id: string, params: Record<string, string> = {}): string {
  const qs = new URLSearchParams(params).toString();
  return `/api/reports/${id}.csv${qs ? `?${qs}` : ''}`;
}
```

- [ ] **Step 7: Create `apps/web/src/setupTests.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 8: Create `apps/web/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './tokens.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 9: Create a minimal `apps/web/src/App.tsx`** (replaced in Task 7)

```tsx
export function App() {
  return <div>OpenLDR</div>;
}
```

- [ ] **Step 10: Install + typecheck + build**

Run: `pnpm install && pnpm --filter @openldr/web typecheck && pnpm --filter @openldr/web build`
Expected: typecheck clean; `apps/web/dist/index.html` produced. (If pnpm prompts to approve esbuild's build script for the new app, it is already allow-listed via `allowBuilds`.)

- [ ] **Step 11: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(web): Vite+React scaffold + Corlix design tokens (P1-UI-1)"
```

---

## Task 7: `apps/web` — app shell (sidebar + topnav + theme + routing)

**Files:**
- Create: `apps/web/src/shell/useTheme.ts`, `apps/web/src/shell/AppShell.tsx`, `apps/web/src/shell/AppShell.test.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Create `apps/web/src/shell/useTheme.ts`**

```ts
import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.getAttribute('data-theme') as Theme) ?? 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}
```

- [ ] **Step 2: Create `apps/web/src/shell/AppShell.tsx`**

```tsx
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTheme } from './useTheme';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/reports', label: 'Reports', end: false },
];
const SOON = ['Forms', 'Users', 'Audit'];

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const [theme, toggle] = useTheme();
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: 240, background: 'var(--sidebar)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', padding: 12 }}>
        <div style={{ fontWeight: 600, color: 'var(--brand)', padding: '8px 12px', fontSize: 16 }}>OpenLDR</div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              style={({ isActive }) => ({
                padding: '8px 12px', borderRadius: 'var(--radius)', fontWeight: 500,
                color: isActive ? 'var(--link)' : 'var(--text-muted)',
                background: isActive ? 'var(--brand-wash)' : 'transparent',
              })}
            >
              {n.label}
            </NavLink>
          ))}
          {SOON.map((s) => (
            <span key={s} aria-disabled title="Coming in a later sub-project" style={{ padding: '8px 12px', color: 'var(--text-muted)', opacity: 0.4 }}>
              {s}
            </span>
          ))}
        </nav>
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="btn-secondary" onClick={toggle}>{theme === 'dark' ? '☾ Dark' : '☀ Light'}</button>
          <div style={{ color: 'var(--text-muted)', padding: '8px 12px' }} className="mono">operator</div>
        </div>
      </aside>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <header style={{ height: 48, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 24px', fontWeight: 500 }}>
          {title}
        </header>
        <main style={{ padding: 24 }}>{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Replace `apps/web/src/App.tsx`**

```tsx
import { Routes, Route } from 'react-router-dom';
import { AppShell } from './shell/AppShell';

function Placeholder({ title }: { title: string }) {
  return <AppShell title={title}><div className="card">{title} — coming in the next task.</div></AppShell>;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Placeholder title="Dashboard" />} />
      <Route path="/reports" element={<Placeholder title="Reports" />} />
      <Route path="/reports/:id" element={<Placeholder title="Report" />} />
      <Route path="*" element={<Placeholder title="Not found" />} />
    </Routes>
  );
}
```

- [ ] **Step 4: Create `apps/web/src/shell/AppShell.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from './AppShell';

function renderShell() {
  return render(
    <MemoryRouter>
      <AppShell title="Dashboard"><div>content</div></AppShell>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  it('renders brand, nav, title, and content', () => {
    renderShell();
    expect(screen.getByText('OpenLDR')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });
  it('toggles theme on the html element', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    renderShell();
    fireEvent.click(screen.getByText(/Dark/));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
```

- [ ] **Step 5: Test + typecheck**

Run: `pnpm --filter @openldr/web test && pnpm --filter @openldr/web typecheck`
Expected: shell tests pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(web): app shell — sidebar, top nav, theme toggle, routing (P1-UI-1)"
```

---

## Task 8: `apps/web` — `<ReportView>` (charts + table + states)

**Files:**
- Create: `apps/web/src/reports/ReportView.tsx`, `apps/web/src/reports/ReportView.test.tsx`

- [ ] **Step 1: Create `apps/web/src/reports/ReportView.tsx`**

```tsx
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import type { ReportResult } from '../api';

const PIE_COLORS = ['#4682B4', '#5A9BD6', '#22c55e', '#f59e0b', '#ef4444', '#898989'];

export function ReportView({ result }: { result: ReportResult }) {
  const { columns, rows } = result;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ height: 320 }}>
        <Chart result={result} />
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table>
          <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} style={{ color: 'var(--text-muted)' }}>No data for the selected filters.</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i}>{columns.map((c) => <td key={c.key}>{format(r[c.key], c.kind)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{result.meta.rowCount} rows · generated {result.meta.generatedAt}</div>
    </div>
  );
}

function format(v: unknown, kind: string): string {
  if (v === null || v === undefined) return '';
  if (kind === 'percent') return `${v}%`;
  return String(v);
}

function Chart({ result }: { result: ReportResult }) {
  const { chart, rows } = result;
  if (chart.type === 'stat') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', gap: 8 }}>
        <div style={{ fontSize: 48, fontWeight: 600, color: 'var(--brand)' }}>{chart.value}</div>
        <div style={{ color: 'var(--text-muted)' }}>{chart.label}</div>
      </div>
    );
  }
  if (chart.type === 'pie') {
    return (
      <ResponsiveContainer>
        <PieChart>
          <Pie data={rows} dataKey={chart.value!} nameKey={chart.label!} outerRadius={110} label>
            {rows.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Pie>
          <Tooltip /><Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === 'line') {
    return (
      <ResponsiveContainer>
        <LineChart data={rows}>
          <CartesianGrid stroke="var(--border)" /><XAxis dataKey={chart.x!} stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" />
          <Tooltip /><Line type="monotone" dataKey={chart.y!} stroke="var(--brand)" />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer>
      <BarChart data={rows}>
        <CartesianGrid stroke="var(--border)" /><XAxis dataKey={chart.x!} stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" />
        <Tooltip /><Bar dataKey={chart.y!} fill="var(--brand)" />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: Create `apps/web/src/reports/ReportView.test.tsx`**

```tsx
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReportView } from './ReportView';
import type { ReportResult } from '../api';

// Recharts ResponsiveContainer needs a non-zero size in jsdom.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 300 });
});

const bar: ReportResult = {
  columns: [{ key: 'antibiotic', label: 'Antibiotic', kind: 'string' }, { key: 'percentR', label: '%R', kind: 'percent' }],
  rows: [{ antibiotic: 'AMP', percentR: 72 }],
  chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
  meta: { generatedAt: '2026-01-01T00:00:00Z', rowCount: 1 },
};

describe('ReportView', () => {
  it('renders the table with a percent cell', () => {
    render(<ReportView result={bar} />);
    expect(screen.getByText('Antibiotic')).toBeInTheDocument();
    expect(screen.getByText('AMP')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
  });
  it('renders the empty state', () => {
    render(<ReportView result={{ ...bar, rows: [], meta: { generatedAt: 'x', rowCount: 0 } }} />);
    expect(screen.getByText(/No data/)).toBeInTheDocument();
  });
  it('renders a stat chart', () => {
    render(<ReportView result={{ ...bar, rows: [], chart: { type: 'stat', value: '26', label: 'Avg hours' }, meta: { generatedAt: 'x', rowCount: 0 } }} />);
    expect(screen.getByText('26')).toBeInTheDocument();
    expect(screen.getByText('Avg hours')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Test + typecheck**

Run: `pnpm --filter @openldr/web test && pnpm --filter @openldr/web typecheck`
Expected: ReportView tests pass; typecheck clean. (The offsetWidth/Height shim handles Recharts' jsdom measurement.)

- [ ] **Step 4: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(web): ReportView — Recharts bar/line/pie/stat + table + states (P1-REP-2)"
```

---

## Task 9: `apps/web` — Dashboard overview + Report detail pages

**Files:**
- Create: `apps/web/src/reports/useReport.ts`, `apps/web/src/pages/Dashboard.tsx`, `apps/web/src/pages/ReportDetail.tsx`, `apps/web/src/pages/Dashboard.test.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Create `apps/web/src/reports/useReport.ts`**

```ts
import { useEffect, useState } from 'react';
import { fetchReport, type ReportResult } from '../api';

export function useReport(id: string, params: Record<string, string> = {}) {
  const [state, setState] = useState<{ loading: boolean; error?: string; result?: ReportResult }>({ loading: true });
  const key = `${id}?${new URLSearchParams(params).toString()}`;
  useEffect(() => {
    let active = true;
    setState({ loading: true });
    fetchReport(id, params)
      .then((result) => { if (active) setState({ loading: false, result }); })
      .catch((err: unknown) => { if (active) setState({ loading: false, error: err instanceof Error ? err.message : String(err) }); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
```

- [ ] **Step 2: Create `apps/web/src/pages/Dashboard.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { fetchReports, type ReportSummary } from '../api';
import { useReport } from '../reports/useReport';
import { ReportView } from '../reports/ReportView';

function ReportCard({ summary }: { summary: ReportSummary }) {
  const { loading, error, result } = useReport(summary.id);
  return (
    <Link to={`/reports/${summary.id}`} className="card" style={{ display: 'block', color: 'inherit' }}>
      <h3>{summary.name}</h3>
      <p style={{ color: 'var(--text-muted)', marginTop: 4 }}>{summary.description}</p>
      <div style={{ marginTop: 8 }}>
        {loading ? <span style={{ color: 'var(--text-muted)' }}>Loading…</span>
          : error ? <span style={{ color: 'var(--danger)' }}>{error}</span>
          : result ? <ReportView result={result} /> : null}
      </div>
    </Link>
  );
}

export function Dashboard() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => { fetchReports().then(setReports).catch((e) => setError(String(e))); }, []);
  return (
    <AppShell title="Dashboard">
      {error && <div className="card" style={{ color: 'var(--danger)' }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        {reports.map((r) => <ReportCard key={r.id} summary={r} />)}
      </div>
    </AppShell>
  );
}
```

> The card embeds the full `<ReportView>` (chart + table) for now. A compact chart-only card variant is a later polish item, not a blocker.

- [ ] **Step 3: Create `apps/web/src/pages/ReportDetail.tsx`**

```tsx
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { useReport } from '../reports/useReport';
import { ReportView } from '../reports/ReportView';
import { csvUrl } from '../api';

export function ReportDetail() {
  const { id = '' } = useParams();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [facility, setFacility] = useState('');
  const params: Record<string, string> = {};
  if (from) params.from = from;
  if (to) params.to = to;
  if (facility) params.facility = facility;
  const { loading, error, result } = useReport(id, params);
  return (
    <AppShell title={result ? `Report · ${id}` : 'Report'}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="btn-secondary" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="from" />
        <input className="btn-secondary" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="to" />
        <input className="btn-secondary" placeholder="Facility id" value={facility} onChange={(e) => setFacility(e.target.value)} aria-label="facility" />
        <a className="btn-primary" href={csvUrl(id, params)}>Export CSV</a>
      </div>
      {loading ? <div className="card">Loading…</div>
        : error ? <div className="card" style={{ color: 'var(--danger)' }}>{error}</div>
        : result ? <ReportView result={result} /> : null}
    </AppShell>
  );
}
```

- [ ] **Step 4: Update `apps/web/src/App.tsx`**

```tsx
import { Routes, Route } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { ReportDetail } from './pages/ReportDetail';
import { AppShell } from './shell/AppShell';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/reports" element={<Dashboard />} />
      <Route path="/reports/:id" element={<ReportDetail />} />
      <Route path="*" element={<AppShell title="Not found"><div className="card">Page not found.</div></AppShell>} />
    </Routes>
  );
}
```

- [ ] **Step 5: Create `apps/web/src/pages/Dashboard.test.tsx`** (mocks fetch)

```tsx
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from './Dashboard';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 300 });
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/reports') {
      return new Response(JSON.stringify([{ id: 'amr-resistance', name: 'AMR Resistance Rate', description: 'd' }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      columns: [{ key: 'antibiotic', label: 'Antibiotic', kind: 'string' }], rows: [{ antibiotic: 'AMP' }],
      chart: { type: 'bar', x: 'antibiotic', y: 'antibiotic' }, meta: { generatedAt: 'x', rowCount: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});

describe('Dashboard', () => {
  it('lists report cards from the API', async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('AMR Resistance Rate')).toBeInTheDocument());
  });
});
```

- [ ] **Step 6: Test + typecheck + build**

Run: `pnpm --filter @openldr/web test && pnpm --filter @openldr/web typecheck && pnpm --filter @openldr/web build`
Expected: dashboard test passes; typecheck clean; `dist/` built.

- [ ] **Step 7: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(web): dashboard overview + report detail pages (P1-REP-2)"
```

---

## Task 10: `apps/server` — serve the built SPA

**Files:**
- Modify: `apps/server/package.json` (add `@fastify/static`), `apps/server/src/app.ts`

- [ ] **Step 1: Add `@fastify/static`** to `apps/server/package.json` dependencies (`"@fastify/static": "^8.0.0"`), run `pnpm install`.

- [ ] **Step 2: Edit `apps/server/src/app.ts`** to serve the SPA when its build is present. Replace with:

```ts
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { AppContext } from '@openldr/bootstrap';
import { registerReportRoutes } from './reports-routes';

export function buildApp(ctx: AppContext) {
  const app = Fastify({ loggerInstance: ctx.logger });

  app.get('/health', async (_req, reply) => {
    const result = await ctx.health.runAll();
    reply.code(result.status === 'down' ? 503 : 200);
    return result;
  });

  registerReportRoutes(app, ctx);

  // Serve the built SPA if present (apps/web/dist). API + health are registered first and win.
  const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (existsSync(webDist)) {
    void app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url && req.raw.url.startsWith('/api')) {
        void reply.code(404).send({ error: 'not found' });
        return;
      }
      void reply.sendFile('index.html'); // SPA client-side routing fallback
    });
  }

  return app;
}
```

> `webDist` resolves from the running module to `apps/web/dist`: built server runs at `apps/server/dist/index.js` (app.ts is bundled in) → `../../web/dist`; dev `tsx` runs `apps/server/src/app.ts` → `../../web/dist` too. The `existsSync` guard keeps it harmless when the SPA hasn't been built. Verify the resolved path in Task 11 and adjust the `..` depth if the bundle layout differs.

- [ ] **Step 3: Typecheck + test**

Run: `pnpm install && pnpm --filter @openldr/server typecheck && pnpm --filter @openldr/server test`
Expected: typecheck clean; existing route tests still pass (no SPA build present during tests → static not registered).

- [ ] **Step 4: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(server): serve the built dashboard SPA with client-route fallback (§3.6)"
```

---

## Task 11: Integration acceptance + final gate

> Requires docker (Postgres + MinIO) and the WHONET plugin from sub-project 5.

- [ ] **Step 1: Stack + data**

Run: `docker compose up -d`; `pnpm openldr db reset --json`.
Seed analytics data by ingesting the WHONET sample (produces AST observations + patients + specimens):
`pnpm build:plugins && pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm --json && pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite --source whonet --json`

- [ ] **Step 2: Report API via CLI**

Run: `pnpm openldr report list --json` → lists the 4 reports.
Run: `pnpm openldr report run amr-resistance --json` → rows with `antibiotic`, `percentR` (AMP high from the sample); exit 0.
Run: `pnpm openldr report run patient-demographics --json` → non-empty bands; `report run test-volume --json` → month/test counts; `report run turnaround-time --json` → runs (may be sparse).

- [ ] **Step 3: Report API via HTTP**

Start the server in the background (`pnpm --filter @openldr/server dev`).
`curl -s localhost:3000/api/reports` → 4 reports.
`curl -s 'localhost:3000/api/reports/amr-resistance'` → `{columns,rows,chart,meta}`.
`curl -s 'localhost:3000/api/reports/amr-resistance.csv'` → CSV text with a header row.
`curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/reports/nope` → 404.

- [ ] **Step 4: SPA served**

Run: `pnpm --filter @openldr/web build`, then restart the server.
`curl -s localhost:3000/ | grep -o '<div id="root">'` → present (index.html served).
`curl -s -o /dev/null -w '%{http_code}' localhost:3000/reports/amr-resistance` → 200 (SPA fallback to index.html for a client route).
`curl -s localhost:3000/api/reports` → still JSON (API wins over the SPA fallback).
Optionally open the URL in a browser and confirm the dashboard renders the 4 report cards in the Corlix dark theme.

- [ ] **Step 5: Final gate**

Run: `pnpm install && pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build && pnpm --filter @openldr/server build:check`
Expected: typecheck clean; all tests pass; depcruise no violations (`@openldr/reporting` imports no `adapter-*`); every package + `apps/web` builds; server smoke OK.

- [ ] **Step 6: Commit any lockfile delta**

Run: `git status --short` — commit `pnpm-lock.yaml` if changed (`chore: finalize reporting/dashboard lockfile`).

---

## Done criteria (maps to spec §8)

- [ ] `@openldr/reporting` Kysely layer + 4 curated reports; pivot/bucket/date math in pure tested helpers; no hand-written SQL (P1-REP-1/3).
- [ ] Report API (`/api/reports`, `/:id`, `.csv`) + CLI `report list|run --json` (P1-CLI-1/2).
- [ ] React+Vite dashboard SPA (Corlix design tokens; sidebar+topnav shell; overview grid + report detail) served by `apps/server` (P1-REP-2, P1-UI-1).
- [ ] DP-1 intact (depcruise); graceful degradation (503 on external-DB failure); server never crashes on a report error.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build` green incl. `apps/web`; live docker acceptance shows AMR %R from ingested WHONET data.
```
