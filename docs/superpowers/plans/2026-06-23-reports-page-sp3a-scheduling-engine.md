# Reports Page — SP-3a (Scheduling Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working, API-drivable report-scheduling backend — persist schedules, fire them at their cron boundary via the durable event bus, render each run (CSV/XLSX/PDF) to blob storage, record it, and expose CRUD + run-now + scheduled-run list + authenticated download. No UI (that is SP-3b).

**Architecture:** Two internal tables (`report_schedules`, `report_schedule_runs`) + `ReportScheduleStore`; pure date-math helpers (`nextRunAt`/`periodFor`); a `createReportScheduler` runner that mirrors the DHIS2 scheduler (`subscribe('report.schedule.due')` self-re-arms; a startup `reconcile` heals missed firings) and renders to `ctx.blob`; 7 Fastify routes (management gated to `lab_admin`/`lab_manager`).

**Tech Stack:** TypeScript, Kysely (+ pg-mem), Fastify, Zod, the PG-outbox event bus, SheetJS (`xlsx`), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-23-reports-page-sp3a-scheduling-engine-design.md`

**Conventions (read before starting):**
- Internal migration `NNN_name.ts` with `up`/`down`, registered in `migrations/internal/index.ts`; tables typed in `schema/internal.ts` (`Generated<Date>` for defaulted timestamps, `JSONColumnType<...>` for jsonb). **Also update the hard-coded assertion list in `packages/db/src/migrations/migrations.test.ts`** (SP-2 lesson). Store modules `packages/db/src/<name>-store.ts`, barrelled via `packages/db/src/index.ts`. Store tests use `makeMigratedDb()` from `./migrations/internal/test-helpers`.
- jsonb inserts use `JSON.stringify(value) as never` (repo convention).
- `requireRole(...roles: string[])` from `apps/server/src/rbac` — `requireRole('lab_admin','lab_manager')` passes if the user holds either. Used as a Fastify `preHandler`.
- The DHIS2 scheduler (`packages/bootstrap/src/dhis2-context.ts` `registerSync`/`reconcileSchedules`, wired in `apps/server/src/index.ts`) is the runner pattern to mirror. The bus that actually delivers delayed events is `ingest.eventing` (its worker drains the outbox) — the report runner MUST register on that same instance.
- Gate per task: scope a single package test (`pnpm --filter @openldr/<pkg> test -- <file>` or `npx vitest run <path>`). Full gate at the end: `pnpm -w turbo typecheck lint test build` + `pnpm -w depcruise`.

---

## Task 1: Internal tables — `report_schedules` + `report_schedule_runs` (migration 026)

**Files:**
- Create: `packages/db/src/migrations/internal/026_report_schedules.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/migrations/migrations.test.ts`
- Modify: `packages/db/src/schema/internal.ts`
- Test: `packages/db/src/migrations/internal/026_report_schedules.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/migrations/internal/026_report_schedules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { internalMigrations } from './index';
import { makeMigratedDb } from './test-helpers';

describe('026_report_schedules migration', () => {
  it('is registered', () => {
    expect(internalMigrations['026_report_schedules']).toBeDefined();
  });

  it('creates writable report_schedules + report_schedule_runs tables', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('report_schedules').values({
      id: 's1', report_id: 'amr-resistance', params: { facility: 'F1' },
      frequency: 'weekly', day_of_week: 1, day_of_month: null,
      output_format: 'pdf', created_by: 'u1',
    }).execute();
    await db.insertInto('report_schedule_runs').values({
      id: 'r1', schedule_id: 's1', report_id: 'amr-resistance', report_name: 'AMR',
      output_format: 'pdf', object_key: 'k', byte_size: 10, row_count: 3, status: 'success',
    }).execute();
    const s = await db.selectFrom('report_schedules').selectAll().execute();
    const r = await db.selectFrom('report_schedule_runs').selectAll().execute();
    expect(s).toHaveLength(1);
    expect(s[0]!.params).toEqual({ facility: 'F1' });
    expect(r[0]!.status).toBe('success');
    await db.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db test -- 026_report_schedules.test.ts`
(If `-- <file>` isn't forwarded as a filter, use `npx vitest run src/migrations/internal/026_report_schedules.test.ts` from `packages/db`.)
Expected: FAIL — migration not registered / tables missing.

- [ ] **Step 3: Create the migration**

Create `packages/db/src/migrations/internal/026_report_schedules.ts`:

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('report_schedules')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('report_id', 'text', (c) => c.notNull())
    .addColumn('params', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('frequency', 'text', (c) => c.notNull())
    .addColumn('day_of_week', 'integer')
    .addColumn('day_of_month', 'integer')
    .addColumn('output_format', 'text', (c) => c.notNull())
    .addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('last_run_at', 'timestamptz')
    .addColumn('next_due_at', 'timestamptz')
    .addColumn('created_by', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('report_schedules_report_idx').ifNotExists()
    .on('report_schedules').column('report_id').execute();

  await db.schema
    .createTable('report_schedule_runs')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('schedule_id', 'text', (c) => c.notNull())
    .addColumn('report_id', 'text', (c) => c.notNull())
    .addColumn('report_name', 'text', (c) => c.notNull())
    .addColumn('run_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('period_start', 'timestamptz')
    .addColumn('period_end', 'timestamptz')
    .addColumn('output_format', 'text', (c) => c.notNull())
    .addColumn('object_key', 'text')
    .addColumn('byte_size', 'integer')
    .addColumn('row_count', 'integer')
    .addColumn('status', 'text', (c) => c.notNull())
    .addColumn('error_message', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('report_schedule_runs_schedule_created_idx').ifNotExists()
    .on('report_schedule_runs').columns(['schedule_id', 'created_at desc']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('report_schedule_runs').ifExists().execute();
  await db.schema.dropTable('report_schedules').ifExists().execute();
}
```

- [ ] **Step 4: Register the migration**

In `packages/db/src/migrations/internal/index.ts`: add `import * as m026 from './026_report_schedules';` after the `m025` import, and `'026_report_schedules': { up: m026.up, down: m026.down },` after the `'025_report_runs'` map entry.

In `packages/db/src/migrations/migrations.test.ts`: append `'026_report_schedules'` to the end of the internal-migrations `.toEqual([...])` array (after `'025_report_runs'`).

- [ ] **Step 5: Add the table types**

In `packages/db/src/schema/internal.ts`, add after `ReportRunsTable`:

```ts
export interface ReportSchedulesTable {
  id: string;
  report_id: string;
  params: JSONColumnType<Record<string, unknown>>;
  frequency: string;
  day_of_week: number | null;
  day_of_month: number | null;
  output_format: string;
  enabled: Generated<boolean>;
  last_run_at: Date | null;
  next_due_at: Date | null;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ReportScheduleRunsTable {
  id: string;
  schedule_id: string;
  report_id: string;
  report_name: string;
  run_at: Generated<Date>;
  period_start: Date | null;
  period_end: Date | null;
  output_format: string;
  object_key: string | null;
  byte_size: number | null;
  row_count: number | null;
  status: string;
  error_message: string | null;
  created_at: Generated<Date>;
}
```

And add to `InternalSchema`:
```ts
  report_schedules: ReportSchedulesTable;
  report_schedule_runs: ReportScheduleRunsTable;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/migrations/internal/026_report_schedules.test.ts` (from `packages/db`).
Expected: PASS. Then `pnpm --filter @openldr/db typecheck` — clean. Then confirm `migrations.test.ts` still passes: `npx vitest run src/migrations/migrations.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/migrations/internal/026_report_schedules.ts packages/db/src/migrations/internal/index.ts packages/db/src/migrations/migrations.test.ts packages/db/src/schema/internal.ts packages/db/src/migrations/internal/026_report_schedules.test.ts
git commit -m "feat(db): report_schedules + report_schedule_runs tables (migration 026)"
```

---

## Task 2: Schedule date math — `nextRunAt` + `periodFor`

**Files:**
- Create: `packages/reporting/src/schedule-period.ts`
- Modify: `packages/reporting/src/index.ts` (export, if the package barrels)
- Test: `packages/reporting/src/schedule-period.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/reporting/src/schedule-period.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextRunAt, periodFor } from './schedule-period';

const iso = (d: Date) => d.toISOString();

describe('nextRunAt', () => {
  it('daily → next day 06:00 UTC', () => {
    expect(iso(nextRunAt('daily', null, null, new Date('2026-03-10T12:00:00Z'))))
      .toBe('2026-03-11T06:00:00.000Z');
  });
  it('weekly → next occurrence of dayOfWeek (1=Mon) at 06:00', () => {
    // 2026-03-10 is a Tuesday (getUTCDay=2); next Monday is 2026-03-16
    expect(iso(nextRunAt('weekly', 1, null, new Date('2026-03-10T12:00:00Z'))))
      .toBe('2026-03-16T06:00:00.000Z');
  });
  it('weekly defaults to Monday when dayOfWeek is null', () => {
    expect(iso(nextRunAt('weekly', null, null, new Date('2026-03-10T12:00:00Z'))))
      .toBe('2026-03-16T06:00:00.000Z');
  });
  it('monthly → next month on dayOfMonth, capped at 28', () => {
    expect(iso(nextRunAt('monthly', null, 31, new Date('2026-03-10T12:00:00Z'))))
      .toBe('2026-04-28T06:00:00.000Z');
  });
  it('quarterly → first day of next quarter at 06:00', () => {
    expect(iso(nextRunAt('quarterly', null, null, new Date('2026-03-10T12:00:00Z'))))
      .toBe('2026-04-01T06:00:00.000Z');
  });
});

describe('periodFor', () => {
  it('daily → previous calendar day', () => {
    const p = periodFor('daily', new Date('2026-03-11T06:00:00Z'));
    expect(iso(p.start)).toBe('2026-03-10T00:00:00.000Z');
    expect(iso(p.end)).toBe('2026-03-10T23:59:59.999Z');
  });
  it('weekly → the 7 days ending the day before runAt', () => {
    const p = periodFor('weekly', new Date('2026-03-16T06:00:00Z'));
    expect(iso(p.start)).toBe('2026-03-09T00:00:00.000Z');
    expect(iso(p.end)).toBe('2026-03-15T23:59:59.999Z');
  });
  it('monthly → previous calendar month', () => {
    const p = periodFor('monthly', new Date('2026-03-05T06:00:00Z'));
    expect(iso(p.start)).toBe('2026-02-01T00:00:00.000Z');
    expect(iso(p.end)).toBe('2026-02-28T23:59:59.999Z');
  });
  it('quarterly → previous calendar quarter', () => {
    const p = periodFor('quarterly', new Date('2026-04-15T06:00:00Z'));
    expect(iso(p.start)).toBe('2026-01-01T00:00:00.000Z');
    expect(iso(p.end)).toBe('2026-03-31T23:59:59.999Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/reporting`): `npx vitest run src/schedule-period.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/reporting/src/schedule-period.ts`:

```ts
export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly';

const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
const endOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));

/** Next firing time strictly after `from`, anchored at 06:00 UTC. */
export function nextRunAt(
  frequency: ScheduleFrequency,
  dayOfWeek: number | null,
  dayOfMonth: number | null,
  from: Date,
): Date {
  const next = new Date(from);
  next.setUTCHours(6, 0, 0, 0);
  switch (frequency) {
    case 'daily':
      next.setUTCDate(next.getUTCDate() + 1);
      return next;
    case 'weekly': {
      const target = dayOfWeek ?? 1; // 0=Sun..6=Sat, default Monday
      const daysUntil = ((target - from.getUTCDay()) + 7) % 7 || 7;
      next.setUTCDate(from.getUTCDate() + daysUntil);
      return next;
    }
    case 'monthly': {
      const target = Math.min(dayOfMonth ?? 1, 28);
      next.setUTCMonth(from.getUTCMonth() + 1, target);
      return next;
    }
    case 'quarterly': {
      const q = Math.floor(from.getUTCMonth() / 3);
      next.setUTCFullYear(from.getUTCFullYear(), (q + 1) * 3, 1);
      return next;
    }
  }
}

/** The just-completed period a run at `runAt` should cover. */
export function periodFor(frequency: ScheduleFrequency, runAt: Date):
  { start: Date; end: Date } {
  switch (frequency) {
    case 'daily': {
      const prev = new Date(runAt);
      prev.setUTCDate(prev.getUTCDate() - 1);
      return { start: startOfDay(prev), end: endOfDay(prev) };
    }
    case 'weekly': {
      const endDay = new Date(runAt);
      endDay.setUTCDate(endDay.getUTCDate() - 1); // day before runAt
      const startDay = new Date(endDay);
      startDay.setUTCDate(startDay.getUTCDate() - 6); // 7-day window
      return { start: startOfDay(startDay), end: endOfDay(endDay) };
    }
    case 'monthly': {
      const start = new Date(Date.UTC(runAt.getUTCFullYear(), runAt.getUTCMonth() - 1, 1, 0, 0, 0, 0));
      const lastDay = new Date(Date.UTC(runAt.getUTCFullYear(), runAt.getUTCMonth(), 0)); // day 0 = last of prev month
      return { start, end: endOfDay(lastDay) };
    }
    case 'quarterly': {
      const q = Math.floor(runAt.getUTCMonth() / 3);
      const prevQStartMonth = (q - 1) * 3;
      const start = new Date(Date.UTC(runAt.getUTCFullYear(), prevQStartMonth, 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(runAt.getUTCFullYear(), prevQStartMonth + 3, 0)); // last day of quarter
      return { start, end: endOfDay(end) };
    }
  }
}
```

> Note on quarterly `periodFor` when `runAt` is in Q1 (q=0): `prevQStartMonth = -3` → `Date.UTC(year, -3, 1)` rolls back to Oct of the prior year, correctly giving the previous Q4. The test uses an April runAt (Q2) → previous Q1; add a Q1 case mentally if unsure, but the rollover is correct.

- [ ] **Step 4: Run test to verify it passes**

Run (from `packages/reporting`): `npx vitest run src/schedule-period.test.ts`
Expected: PASS. If `packages/reporting/src/index.ts` is a barrel, add `export * from './schedule-period';`. Then `pnpm --filter @openldr/reporting typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add packages/reporting/src/schedule-period.ts packages/reporting/src/schedule-period.test.ts packages/reporting/src/index.ts
git commit -m "feat(reporting): schedule date-math helpers (nextRunAt + periodFor)"
```

---

## Task 3: `ReportScheduleStore`

**Files:**
- Create: `packages/db/src/report-schedule-store.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/report-schedule-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/report-schedule-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createReportScheduleStore } from './report-schedule-store';

describe('report schedule store', () => {
  it('CRUD + next-due/markRun + runs', async () => {
    const db = await makeMigratedDb();
    const store = createReportScheduleStore(db);

    await store.create({
      id: 's1', reportId: 'amr-resistance', params: { facility: 'F1' },
      frequency: 'weekly', dayOfWeek: 1, dayOfMonth: null,
      outputFormat: 'pdf', createdBy: 'u1', nextDueAt: new Date('2026-03-16T06:00:00Z'),
    });
    expect((await store.get('s1'))?.reportId).toBe('amr-resistance');
    expect((await store.list({ reportId: 'amr-resistance' })).map((s) => s.id)).toEqual(['s1']);
    expect((await store.get('s1'))?.params).toEqual({ facility: 'F1' });

    await store.update('s1', { enabled: false, outputFormat: 'csv' });
    expect((await store.get('s1'))?.enabled).toBe(false);
    expect((await store.get('s1'))?.outputFormat).toBe('csv');

    await store.setNextDue('s1', new Date('2026-03-23T06:00:00Z'));
    await store.markRun('s1', new Date('2026-03-16T06:05:00Z'));
    const s = await store.get('s1');
    expect(s?.lastRunAt?.toISOString()).toBe('2026-03-16T06:05:00.000Z');

    await store.recordRun({
      id: 'run1', scheduleId: 's1', reportId: 'amr-resistance', reportName: 'AMR',
      runAt: new Date('2026-03-16T06:05:00Z'), periodStart: new Date('2026-03-09T00:00:00Z'),
      periodEnd: new Date('2026-03-15T23:59:59Z'), outputFormat: 'csv',
      objectKey: 'report-schedules/s1/run1.csv', byteSize: 42, rowCount: 3,
      status: 'success', errorMessage: null,
    });
    const runs = await store.listRuns({ scheduleId: 's1', limit: 10, offset: 0 });
    expect(runs.total).toBe(1);
    expect(runs.runs[0]!.objectKey).toBe('report-schedules/s1/run1.csv');
    expect((await store.getRun('run1'))?.status).toBe('success');

    await store.remove('s1');
    expect(await store.get('s1')).toBeNull();
    await db.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/db`): `npx vitest run src/report-schedule-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/db/src/report-schedule-store.ts`:

```ts
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly';
export type ScheduleOutputFormat = 'csv' | 'xlsx' | 'pdf';

export interface ScheduleRecord {
  id: string;
  reportId: string;
  params: Record<string, unknown>;
  frequency: ScheduleFrequency;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  outputFormat: ScheduleOutputFormat;
  enabled: boolean;
  lastRunAt: Date | null;
  nextDueAt: Date | null;
  createdBy: string | null;
}

export interface NewSchedule {
  id: string;
  reportId: string;
  params: Record<string, unknown>;
  frequency: ScheduleFrequency;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  outputFormat: ScheduleOutputFormat;
  createdBy: string | null;
  nextDueAt: Date;
}

export interface SchedulePatch {
  enabled?: boolean;
  frequency?: ScheduleFrequency;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  outputFormat?: ScheduleOutputFormat;
  params?: Record<string, unknown>;
  nextDueAt?: Date;
}

export interface ScheduleRunRecord {
  id: string;
  scheduleId: string;
  reportId: string;
  reportName: string;
  runAt: Date;
  periodStart: Date | null;
  periodEnd: Date | null;
  outputFormat: string;
  objectKey: string | null;
  byteSize: number | null;
  rowCount: number | null;
  status: 'success' | 'failed';
  errorMessage: string | null;
}

export interface NewScheduleRun extends Omit<ScheduleRunRecord, 'runAt'> {
  runAt: Date;
}

export interface ReportScheduleStore {
  create(s: NewSchedule): Promise<void>;
  get(id: string): Promise<ScheduleRecord | null>;
  list(opts: { reportId?: string }): Promise<ScheduleRecord[]>;
  update(id: string, patch: SchedulePatch): Promise<void>;
  remove(id: string): Promise<void>;
  setNextDue(id: string, at: Date): Promise<void>;
  markRun(id: string, at: Date): Promise<void>;
  recordRun(run: NewScheduleRun): Promise<void>;
  listRuns(opts: { reportId?: string; scheduleId?: string; limit: number; offset: number }):
    Promise<{ runs: ScheduleRunRecord[]; total: number }>;
  getRun(runId: string): Promise<ScheduleRunRecord | null>;
}

function toSchedule(r: {
  id: string; report_id: string; params: Record<string, unknown>; frequency: string;
  day_of_week: number | null; day_of_month: number | null; output_format: string;
  enabled: boolean; last_run_at: Date | null; next_due_at: Date | null; created_by: string | null;
}): ScheduleRecord {
  return {
    id: r.id, reportId: r.report_id, params: r.params ?? {},
    frequency: r.frequency as ScheduleFrequency, dayOfWeek: r.day_of_week, dayOfMonth: r.day_of_month,
    outputFormat: r.output_format as ScheduleOutputFormat, enabled: r.enabled,
    lastRunAt: r.last_run_at, nextDueAt: r.next_due_at, createdBy: r.created_by,
  };
}

function toRun(r: {
  id: string; schedule_id: string; report_id: string; report_name: string; run_at: Date;
  period_start: Date | null; period_end: Date | null; output_format: string;
  object_key: string | null; byte_size: number | null; row_count: number | null;
  status: string; error_message: string | null;
}): ScheduleRunRecord {
  return {
    id: r.id, scheduleId: r.schedule_id, reportId: r.report_id, reportName: r.report_name,
    runAt: r.run_at, periodStart: r.period_start, periodEnd: r.period_end,
    outputFormat: r.output_format, objectKey: r.object_key, byteSize: r.byte_size,
    rowCount: r.row_count, status: r.status as 'success' | 'failed', errorMessage: r.error_message,
  };
}

const SCHEDULE_COLS = ['id', 'report_id', 'params', 'frequency', 'day_of_week', 'day_of_month',
  'output_format', 'enabled', 'last_run_at', 'next_due_at', 'created_by'] as const;
const RUN_COLS = ['id', 'schedule_id', 'report_id', 'report_name', 'run_at', 'period_start',
  'period_end', 'output_format', 'object_key', 'byte_size', 'row_count', 'status', 'error_message'] as const;

export function createReportScheduleStore(db: Kysely<InternalSchema>): ReportScheduleStore {
  return {
    async create(s) {
      await db.insertInto('report_schedules').values({
        id: s.id, report_id: s.reportId, params: JSON.stringify(s.params) as never,
        frequency: s.frequency, day_of_week: s.dayOfWeek, day_of_month: s.dayOfMonth,
        output_format: s.outputFormat, created_by: s.createdBy, next_due_at: s.nextDueAt,
      }).execute();
    },
    async get(id) {
      const r = await db.selectFrom('report_schedules').select(SCHEDULE_COLS).where('id', '=', id).executeTakeFirst();
      return r ? toSchedule(r) : null;
    },
    async list({ reportId }) {
      let q = db.selectFrom('report_schedules').select(SCHEDULE_COLS);
      if (reportId) q = q.where('report_id', '=', reportId);
      return (await q.orderBy('created_at', 'desc').execute()).map(toSchedule);
    },
    async update(id, patch) {
      const set: Record<string, unknown> = { updated_at: sql`now()` };
      if (patch.enabled !== undefined) set.enabled = patch.enabled;
      if (patch.frequency !== undefined) set.frequency = patch.frequency;
      if (patch.dayOfWeek !== undefined) set.day_of_week = patch.dayOfWeek;
      if (patch.dayOfMonth !== undefined) set.day_of_month = patch.dayOfMonth;
      if (patch.outputFormat !== undefined) set.output_format = patch.outputFormat;
      if (patch.params !== undefined) set.params = JSON.stringify(patch.params) as never;
      if (patch.nextDueAt !== undefined) set.next_due_at = patch.nextDueAt;
      await db.updateTable('report_schedules').set(set).where('id', '=', id).execute();
    },
    async remove(id) { await db.deleteFrom('report_schedules').where('id', '=', id).execute(); },
    async setNextDue(id, at) {
      await db.updateTable('report_schedules').set({ next_due_at: at, updated_at: sql`now()` }).where('id', '=', id).execute();
    },
    async markRun(id, at) {
      await db.updateTable('report_schedules').set({ last_run_at: at, updated_at: sql`now()` }).where('id', '=', id).execute();
    },
    async recordRun(run) {
      await db.insertInto('report_schedule_runs').values({
        id: run.id, schedule_id: run.scheduleId, report_id: run.reportId, report_name: run.reportName,
        run_at: run.runAt, period_start: run.periodStart, period_end: run.periodEnd,
        output_format: run.outputFormat, object_key: run.objectKey, byte_size: run.byteSize,
        row_count: run.rowCount, status: run.status, error_message: run.errorMessage,
      }).execute();
    },
    async listRuns({ reportId, scheduleId, limit, offset }) {
      let q = db.selectFrom('report_schedule_runs').select(RUN_COLS);
      if (reportId) q = q.where('report_id', '=', reportId);
      if (scheduleId) q = q.where('schedule_id', '=', scheduleId);
      const rows = await q.orderBy('created_at', 'desc').limit(limit).offset(offset).execute();
      let cq = db.selectFrom('report_schedule_runs').select((eb) => eb.fn.countAll<number>().as('total'));
      if (reportId) cq = cq.where('report_id', '=', reportId);
      if (scheduleId) cq = cq.where('schedule_id', '=', scheduleId);
      const c = await cq.executeTakeFirst();
      return { runs: rows.map(toRun), total: Number(c?.total ?? 0) };
    },
    async getRun(runId) {
      const r = await db.selectFrom('report_schedule_runs').select(RUN_COLS).where('id', '=', runId).executeTakeFirst();
      return r ? toRun(r) : null;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `packages/db`): `npx vitest run src/report-schedule-store.test.ts`
Expected: PASS. Add `export * from './report-schedule-store';` to `packages/db/src/index.ts`. Then `pnpm --filter @openldr/db typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/report-schedule-store.ts packages/db/src/report-schedule-store.test.ts packages/db/src/index.ts
git commit -m "feat(db): ReportScheduleStore (schedule CRUD + runs)"
```

---

## Task 4: Runner — `createReportScheduler`

**Files:**
- Create: `packages/bootstrap/src/report-scheduler.ts`
- Test: `packages/bootstrap/src/report-scheduler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/bootstrap/src/report-scheduler.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createReportScheduler } from './report-scheduler';

function deps(overrides = {}) {
  const put = vi.fn(async () => {});
  const recorded: any[] = [];
  const schedule = {
    id: 's1', reportId: 'amr-resistance', params: { facility: 'F1' },
    frequency: 'weekly', dayOfWeek: 1, dayOfMonth: null, outputFormat: 'csv',
    enabled: true, lastRunAt: null, nextDueAt: null, createdBy: 'u1',
  };
  const schedules = {
    get: vi.fn(async () => schedule),
    recordRun: vi.fn(async (r: any) => { recorded.push(r); }),
    markRun: vi.fn(async () => {}),
    setNextDue: vi.fn(async () => {}),
    list: vi.fn(async () => [schedule]),
  };
  const reporting = {
    list: () => [{ id: 'amr-resistance', name: 'AMR Resistance Rate', description: '', category: 'amr',
      parameters: [{ id: 'dateRange', label: 'Date range', type: 'daterange', required: false }] }],
    run: vi.fn(async () => ({ columns: [{ key: 'antibiotic', label: 'Antibiotic', kind: 'string' }],
      rows: [{ antibiotic: 'AMP' }], chart: { type: 'bar' }, meta: { generatedAt: '', rowCount: 1 } })),
    renderPdf: vi.fn(async () => Buffer.from('%PDF')),
  };
  const logger = { error: vi.fn(), info: vi.fn() };
  return { put, recorded, schedules, reporting, logger,
    scheduler: createReportScheduler({ reporting: reporting as any, blob: { put } as any, schedules: schedules as any, logger: logger as any }) };
}

describe('report scheduler runDue', () => {
  it('renders csv, stores blob, records a success run with injected from/to', async () => {
    const d = deps();
    await d.scheduler.runDue('s1');
    expect(d.reporting.run).toHaveBeenCalledWith('amr-resistance', expect.objectContaining({ facility: 'F1', from: expect.any(String), to: expect.any(String) }));
    expect(d.put).toHaveBeenCalledWith(expect.stringMatching(/^report-schedules\/s1\/.*\.csv$/), expect.anything(), 'text/csv');
    expect(d.recorded[0]).toMatchObject({ scheduleId: 's1', status: 'success', outputFormat: 'csv', rowCount: 1 });
    expect(d.schedules.markRun).toHaveBeenCalled();
  });

  it('records a failed run (and does not throw) when rendering fails', async () => {
    const d = deps();
    d.reporting.run.mockRejectedValueOnce(new Error('boom'));
    await expect(d.scheduler.runDue('s1')).resolves.toBeUndefined();
    expect(d.recorded[0]).toMatchObject({ status: 'failed', errorMessage: expect.stringContaining('boom'), objectKey: null });
  });
});

describe('registerRunner', () => {
  it('subscribes and re-arms next due after a run', async () => {
    const d = deps();
    const handlers: Record<string, (e: any) => Promise<void>> = {};
    const eventing = {
      subscribe: vi.fn(async (type: string, h: any) => { handlers[type] = h; }),
      publish: vi.fn(async () => {}),
    };
    await d.scheduler.registerRunner(eventing as any);
    expect(eventing.subscribe).toHaveBeenCalledWith('report.schedule.due', expect.any(Function));
    await handlers['report.schedule.due']!({ payload: { scheduleId: 's1' } });
    expect(d.schedules.setNextDue).toHaveBeenCalledWith('s1', expect.any(Date));
    expect(eventing.publish).toHaveBeenCalledWith(
      { type: 'report.schedule.due', payload: { scheduleId: 's1' } },
      expect.objectContaining({ availableAt: expect.any(Date) }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/bootstrap test -- report-scheduler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/bootstrap/src/report-scheduler.ts`:

```ts
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { toCsv, nextRunAt, periodFor, type ScheduleFrequency } from '@openldr/reporting';
import type { EventingPort } from '@openldr/ports';
import type { ReportScheduleStore } from '@openldr/db';

interface ReportColumnLike { key: string; label: string }

interface SchedulerReporting {
  list(): { id: string; name: string; parameters?: { type: string }[] }[];
  run(id: string, params: unknown): Promise<{ columns: ReportColumnLike[]; rows: Record<string, unknown>[]; meta: { rowCount: number } }>;
  renderPdf(id: string, params: unknown): Promise<Buffer>;
}

interface SchedulerDeps {
  reporting: SchedulerReporting;
  blob: { put(key: string, body: Uint8Array | string, contentType?: string): Promise<void> };
  schedules: ReportScheduleStore;
  logger: { error(obj: unknown, msg?: string): void };
}

export interface ReportScheduler {
  runDue(scheduleId: string): Promise<void>;
  runNow(scheduleId: string): void;
  registerRunner(eventing: EventingPort): Promise<void>;
  reconcile(eventing: EventingPort): Promise<void>;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

function renderXlsx(columns: ReportColumnLike[], rows: Record<string, unknown>[]): Buffer {
  const data = rows.map((r) => Object.fromEntries(columns.map((c) => [c.label, r[c.key] ?? ''])));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function createReportScheduler(deps: SchedulerDeps): ReportScheduler {
  async function runDue(scheduleId: string): Promise<void> {
    const s = await deps.schedules.get(scheduleId);
    if (!s || !s.enabled) return;
    const runId = randomUUID();
    const now = new Date();
    const period = periodFor(s.frequency as ScheduleFrequency, now);
    const def = deps.reporting.list().find((r) => r.id === s.reportId);
    const reportName = def?.name ?? s.reportId;
    try {
      const hasDateRange = def?.parameters?.some((p) => p.type === 'daterange') ?? false;
      const params: Record<string, unknown> = { ...s.params };
      if (hasDateRange) { params.from = ymd(period.start); params.to = ymd(period.end); }

      let bytes: Buffer; let contentType: string; let ext: string; let rowCount: number;
      if (s.outputFormat === 'pdf') {
        const result = await deps.reporting.run(s.reportId, params);
        rowCount = result.meta.rowCount;
        bytes = await deps.reporting.renderPdf(s.reportId, params);
        contentType = 'application/pdf'; ext = 'pdf';
      } else {
        const result = await deps.reporting.run(s.reportId, params);
        rowCount = result.meta.rowCount;
        if (s.outputFormat === 'xlsx') {
          bytes = renderXlsx(result.columns, result.rows);
          contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; ext = 'xlsx';
        } else {
          bytes = Buffer.from(toCsv(result.columns, result.rows), 'utf8');
          contentType = 'text/csv'; ext = 'csv';
        }
      }
      const objectKey = `report-schedules/${s.id}/${runId}.${ext}`;
      await deps.blob.put(objectKey, bytes, contentType);
      await deps.schedules.recordRun({
        id: runId, scheduleId: s.id, reportId: s.reportId, reportName, runAt: now,
        periodStart: period.start, periodEnd: period.end, outputFormat: s.outputFormat,
        objectKey, byteSize: bytes.length, rowCount, status: 'success', errorMessage: null,
      });
    } catch (err) {
      deps.logger.error({ err, scheduleId }, 'report schedule run failed');
      await deps.schedules.recordRun({
        id: runId, scheduleId: s.id, reportId: s.reportId, reportName, runAt: now,
        periodStart: period.start, periodEnd: period.end, outputFormat: s.outputFormat,
        objectKey: null, byteSize: null, rowCount: null, status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
    await deps.schedules.markRun(s.id, now);
  }

  return {
    runDue,
    runNow(scheduleId) {
      void runDue(scheduleId).catch((err) => deps.logger.error({ err, scheduleId }, 'report run-now failed'));
    },
    async registerRunner(eventing) {
      await eventing.subscribe('report.schedule.due', async (event) => {
        const { scheduleId } = event.payload as { scheduleId: string };
        const s = await deps.schedules.get(scheduleId);
        if (!s) return;
        await runDue(scheduleId);
        if (!s.enabled) return;
        const due = nextRunAt(s.frequency as ScheduleFrequency, s.dayOfWeek, s.dayOfMonth, new Date());
        await deps.schedules.setNextDue(scheduleId, due);
        await eventing.publish({ type: 'report.schedule.due', payload: { scheduleId } }, { availableAt: due });
      });
    },
    async reconcile(eventing) {
      for (const s of await deps.schedules.list({})) {
        if (!s.enabled) continue;
        const due = s.nextDueAt ?? nextRunAt(s.frequency as ScheduleFrequency, s.dayOfWeek, s.dayOfMonth, new Date());
        await deps.schedules.setNextDue(s.id, due);
        await eventing.publish({ type: 'report.schedule.due', payload: { scheduleId: s.id } }, { availableAt: due });
      }
    },
  };
}
```

> Verify `@openldr/reporting` exports `toCsv`, `nextRunAt`, `periodFor`, `ScheduleFrequency` (Tasks 2 added the period helpers; `toCsv` already exists). If the package's public entry doesn't re-export `toCsv`, import it from the path the existing server route uses (`reports-routes.ts` imports `toCsv` from `@openldr/reporting`, so it's exported). `@openldr/ports` exports `EventingPort`; `@openldr/db` exports `ReportScheduleStore` (Task 3).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/bootstrap test -- report-scheduler.test.ts`
Expected: PASS. Then `pnpm --filter @openldr/bootstrap typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/report-scheduler.ts packages/bootstrap/src/report-scheduler.test.ts
git commit -m "feat(bootstrap): report scheduler runner (runDue/runNow/registerRunner/reconcile)"
```

---

## Task 5: Wire `ctx.reportSchedules` + `ctx.reportScheduler` + startup registration

**Files:**
- Modify: `packages/bootstrap/src/index.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/app.test.ts` (extend the AppContext stub)

- [ ] **Step 1: Add to AppContext + construct (bootstrap/src/index.ts)**

- Add to the `@openldr/db` import: `createReportScheduleStore, type ReportScheduleStore`.
- Add `createReportScheduler, type ReportScheduler` — import from `./report-scheduler` (same package): `import { createReportScheduler, type ReportScheduler } from './report-scheduler';`.
- In `AppContext` add:
```ts
  reportSchedules: ReportScheduleStore;
  reportScheduler: ReportScheduler;
```
- In `createAppContext`, after `const reportRuns = createReportRunStore(internal.db);`, add:
```ts
  const reportSchedules = createReportScheduleStore(internal.db);
  const reportScheduler = createReportScheduler({
    reporting: reporting as unknown as Parameters<typeof createReportScheduler>[0]['reporting'],
    blob,
    schedules: reportSchedules,
    logger,
  });
```
  (`reporting`, `blob`, `logger` are already in scope in `createAppContext`. The `reporting` cast bridges the full `ReportingApi` to the scheduler's narrower `SchedulerReporting` shape — they're structurally compatible on `list`/`run`/`renderPdf`; if TypeScript accepts it without the cast, drop the cast.)
- Add `reportSchedules,` and `reportScheduler,` to the returned context object.

- [ ] **Step 2: Register the runner at startup (apps/server/src/index.ts)**

After `const app = buildApp(ctx, dhis2, ingest.eventing);` and the DHIS2 block, add:
```ts
  await ctx.reportScheduler.registerRunner(ingest.eventing);
  await ctx.reportScheduler.reconcile(ingest.eventing);
```
(Use `ingest.eventing` — the same bus whose worker drains the outbox, identical to the DHIS2 wiring.)

- [ ] **Step 3: Fix the AppContext test stub (apps/server/src/app.test.ts)**

`reportSchedules` and `reportScheduler` are now required on `AppContext`. In the `ctxWith`/AppContext stub used by `app.test.ts`, add `reportSchedules: {} as never,` and `reportScheduler: {} as never,` (matching the adjacent `as never` stubs from SP-2's `reportRuns`).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @openldr/bootstrap typecheck` and `pnpm --filter @openldr/server typecheck` — both clean. Run `pnpm --filter @openldr/server test -- app.test.ts` — pass.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/index.ts apps/server/src/index.ts apps/server/src/app.test.ts
git commit -m "feat(bootstrap): expose ctx.reportSchedules + ctx.reportScheduler; register runner at startup"
```

---

## Task 6: Routes — schedule CRUD + run-now (gated)

**Files:**
- Modify: `apps/server/src/reports-routes.ts`
- Test: `apps/server/src/reports-routes.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Add to `apps/server/src/reports-routes.test.ts` a describe block. It stubs `ctx.reportSchedules` + `ctx.reportScheduler`, injects a `req.user` with a manager role, and (since `requireRole` reads `req.user.roles`) exercises create/list/patch/delete/run-now:

```ts
describe('report schedule routes', () => {
  function appWithSchedules(roles = ['lab_manager']) {
    const created: any[] = [];
    const ctx = {
      reporting: { list: () => [{ id: 'amr-resistance', name: 'AMR Resistance Rate', description: '', category: 'amr', parameters: [] }] },
      reportSchedules: {
        create: async (s: any) => { created.push(s); },
        list: async () => [{ id: 's1', reportId: 'amr-resistance', params: {}, frequency: 'weekly', dayOfWeek: 1, dayOfMonth: null, outputFormat: 'pdf', enabled: true, lastRunAt: null, nextDueAt: new Date('2026-03-16T06:00:00Z'), createdBy: 'u1' }],
        get: async (id: string) => (id === 's1' ? { id: 's1', reportId: 'amr-resistance', frequency: 'weekly', dayOfWeek: 1, dayOfMonth: null, outputFormat: 'pdf', enabled: true, params: {}, lastRunAt: null, nextDueAt: null, createdBy: 'u1' } : null),
        update: async () => {}, remove: async () => {},
      },
      reportScheduler: { runNow: () => {} },
    } as unknown as Parameters<typeof registerReportRoutes>[1];
    const app = Fastify();
    app.addHook('onRequest', async (req) => { (req as { user?: unknown }).user = { id: 'u1', username: 'ada', displayName: 'Ada', roles, status: 'active' }; });
    registerReportRoutes(app, ctx);
    return { app, created };
  }

  it('POST creates a schedule with computed nextDueAt + createdBy', async () => {
    const { app, created } = appWithSchedules();
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/reports/amr-resistance/schedules', payload: { frequency: 'weekly', dayOfWeek: 1, outputFormat: 'pdf' } });
    expect(res.statusCode).toBe(201);
    expect(created[0]).toMatchObject({ reportId: 'amr-resistance', frequency: 'weekly', outputFormat: 'pdf', createdBy: 'u1' });
    expect(created[0].nextDueAt).toBeInstanceOf(Date);
    await app.close();
  });

  it('GET lists schedules for a report', async () => {
    const { app } = appWithSchedules();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/reports/amr-resistance/schedules' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    await app.close();
  });

  it('forbids creation for a non-manager (403)', async () => {
    const { app } = appWithSchedules(['lab_technician']);
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/reports/amr-resistance/schedules', payload: { frequency: 'daily', outputFormat: 'csv' } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('PATCH updates and DELETE removes; run-now returns 202', async () => {
    const { app } = appWithSchedules();
    await app.ready();
    expect((await app.inject({ method: 'PATCH', url: '/api/reports/schedules/s1', payload: { enabled: false } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: '/api/reports/schedules/s1' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/reports/schedules/s1/run' })).statusCode).toBe(202);
    await app.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/server test -- reports-routes.test.ts`
Expected: FAIL — routes 404 / requireRole missing.

- [ ] **Step 3: Implement**

In `apps/server/src/reports-routes.ts`:
- Add imports: `import { requireRole } from './rbac';` and `import { randomUUID } from 'node:crypto';` and `import { nextRunAt, type ScheduleFrequency } from '@openldr/reporting';`. Ensure `z` is imported (SP-2 added it).
- Add zod schemas (module scope):
```ts
const FREQ = z.enum(['daily', 'weekly', 'monthly', 'quarterly']);
const FORMAT = z.enum(['csv', 'xlsx', 'pdf']);
const scheduleCreate = z.object({
  frequency: FREQ,
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  outputFormat: FORMAT,
  params: z.record(z.string()).optional(),
});
const schedulePatch = z.object({
  enabled: z.boolean().optional(),
  frequency: FREQ.optional(),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  outputFormat: FORMAT.optional(),
  params: z.record(z.string()).optional(),
});
const MANAGE = { preHandler: requireRole('lab_admin', 'lab_manager') };
```
- Register these routes BEFORE the bare `/api/reports/:id` GET (so `schedules`/`schedule-runs` static segments win):
```ts
  app.get('/api/reports/:id/schedules', async (req) => {
    const { id } = req.params as { id: string };
    return ctx.reportSchedules.list({ reportId: id });
  });

  app.post('/api/reports/:id/schedules', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    let body: z.infer<typeof scheduleCreate>;
    try { body = scheduleCreate.parse(req.body); } catch (err) { return mapError(err, reply); }
    if (!ctx.reporting.list().find((r) => r.id === id)) { reply.code(404); return { error: `report not found: ${id}` }; }
    const sid = randomUUID();
    const nextDueAt = nextRunAt(body.frequency as ScheduleFrequency, body.dayOfWeek ?? null, body.dayOfMonth ?? null, new Date());
    await ctx.reportSchedules.create({
      id: sid, reportId: id, params: body.params ?? {}, frequency: body.frequency,
      dayOfWeek: body.dayOfWeek ?? null, dayOfMonth: body.dayOfMonth ?? null,
      outputFormat: body.outputFormat, createdBy: req.user?.id ?? null, nextDueAt,
    });
    await ctx.eventing.publish({ type: 'report.schedule.due', payload: { scheduleId: sid } }, { availableAt: nextDueAt });
    reply.code(201);
    return await ctx.reportSchedules.get(sid);
  });

  app.patch('/api/reports/schedules/:sid', MANAGE, async (req, reply) => {
    const { sid } = req.params as { sid: string };
    let body: z.infer<typeof schedulePatch>;
    try { body = schedulePatch.parse(req.body); } catch (err) { return mapError(err, reply); }
    const existing = await ctx.reportSchedules.get(sid);
    if (!existing) { reply.code(404); return { error: `schedule not found: ${sid}` }; }
    const timingChanged = body.frequency !== undefined || body.dayOfWeek !== undefined || body.dayOfMonth !== undefined;
    const nextDueAt = timingChanged
      ? nextRunAt((body.frequency ?? existing.frequency) as ScheduleFrequency,
          body.dayOfWeek !== undefined ? body.dayOfWeek : existing.dayOfWeek,
          body.dayOfMonth !== undefined ? body.dayOfMonth : existing.dayOfMonth, new Date())
      : undefined;
    await ctx.reportSchedules.update(sid, { ...body, ...(nextDueAt ? { nextDueAt } : {}) });
    if (nextDueAt) await ctx.eventing.publish({ type: 'report.schedule.due', payload: { scheduleId: sid } }, { availableAt: nextDueAt });
    return await ctx.reportSchedules.get(sid);
  });

  app.delete('/api/reports/schedules/:sid', MANAGE, async (req) => {
    const { sid } = req.params as { sid: string };
    await ctx.reportSchedules.remove(sid);
    return { ok: true };
  });

  app.post('/api/reports/schedules/:sid/run', MANAGE, async (req, reply) => {
    const { sid } = req.params as { sid: string };
    if (!(await ctx.reportSchedules.get(sid))) { reply.code(404); return { error: `schedule not found: ${sid}` }; }
    ctx.reportScheduler.runNow(sid);
    reply.code(202);
    return { ok: true };
  });
```

> `ctx.eventing` is the AppContext bus. **Confirmed:** both `ctx.eventing` (`bootstrap/src/index.ts`) and `ingest.eventing` (`bootstrap/src/ingest-context.ts`) are `createEventBus({ url: cfg.INTERNAL_DATABASE_URL })` — the same backing PG outbox table — and the ingest worker (`ingest.startWorker()`) drains it. So publishing the initial/updated due event via `ctx.eventing` here is delivered by the same worker the runner subscribes through. No change needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/server test -- reports-routes.test.ts`
Expected: PASS. Then `pnpm --filter @openldr/server typecheck` — clean. (The schedule-route tests don't exercise `ctx.eventing`; if the stub lacks it, add `eventing: { publish: async () => {} }` to the test ctx stub.)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/reports-routes.ts apps/server/src/reports-routes.test.ts
git commit -m "feat(reports): schedule CRUD + run-now routes (lab_admin/lab_manager gated)"
```

---

## Task 7: Routes — scheduled-run list + authenticated download

**Files:**
- Modify: `apps/server/src/reports-routes.ts`
- Test: `apps/server/src/reports-routes.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Add to `reports-routes.test.ts`:

```ts
describe('report schedule-run routes', () => {
  function appWithRuns() {
    const ctx = {
      reportSchedules: {
        listRuns: async () => ({ runs: [{ id: 'run1', scheduleId: 's1', reportId: 'amr-resistance', reportName: 'AMR', runAt: new Date('2026-03-16T06:05:00Z'), periodStart: null, periodEnd: null, outputFormat: 'csv', objectKey: 'report-schedules/s1/run1.csv', byteSize: 4, rowCount: 1, status: 'success', errorMessage: null }], total: 1 }),
        getRun: async (id: string) => (id === 'run1' ? { id: 'run1', scheduleId: 's1', reportId: 'amr-resistance', reportName: 'AMR', runAt: new Date(), periodStart: null, periodEnd: null, outputFormat: 'csv', objectKey: 'report-schedules/s1/run1.csv', byteSize: 4, rowCount: 1, status: 'success', errorMessage: null } : id === 'failed' ? { id: 'failed', objectKey: null, outputFormat: 'csv' } : null),
      },
      blob: { get: async () => new TextEncoder().encode('a,b\n1,2') },
    } as unknown as Parameters<typeof registerReportRoutes>[1];
    const app = Fastify();
    app.addHook('onRequest', async (req) => { (req as { user?: unknown }).user = { id: 'u1', username: 'ada', displayName: 'Ada', roles: ['lab_technician'], status: 'active' }; });
    registerReportRoutes(app, ctx);
    return { app };
  }

  it('GET schedule-runs returns { runs, total }', async () => {
    const { app } = appWithRuns();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/reports/schedule-runs?reportId=amr-resistance&limit=5' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 1 });
    await app.close();
  });

  it('download streams the blob with a content-type', async () => {
    const { app } = appWithRuns();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/reports/schedule-runs/run1/download' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('a,b');
    await app.close();
  });

  it('download 404 for a failed run with no object_key', async () => {
    const { app } = appWithRuns();
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/api/reports/schedule-runs/failed/download' })).statusCode).toBe(404);
    await app.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/server test -- reports-routes.test.ts`
Expected: FAIL — routes 404.

- [ ] **Step 3: Implement**

In `apps/server/src/reports-routes.ts`, add (before the bare `/api/reports/:id` GET). Add a content-type map at module scope:
```ts
const FORMAT_CONTENT_TYPE: Record<string, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};
```
Routes:
```ts
  app.get('/api/reports/schedule-runs', async (req) => {
    const q = req.query as { reportId?: string; scheduleId?: string; limit?: string; offset?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
    return ctx.reportSchedules.listRuns({ reportId: q.reportId, scheduleId: q.scheduleId, limit, offset });
  });

  app.get('/api/reports/schedule-runs/:runId/download', async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = await ctx.reportSchedules.getRun(runId);
    if (!run || !run.objectKey) { reply.code(404); return { error: 'run output not found' }; }
    const bytes = await ctx.blob.get(run.objectKey);
    const ct = FORMAT_CONTENT_TYPE[run.outputFormat] ?? 'application/octet-stream';
    void reply.header('content-type', ct);
    void reply.header('content-disposition', `attachment; filename="${run.reportId}.${run.outputFormat}"`);
    return reply.send(Buffer.from(bytes));
  });
```

> `ctx.blob.get(key)` returns `Uint8Array`; wrap in `Buffer.from(...)` for `reply.send`. Fastify sends a Buffer as-is with the headers set.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/server test -- reports-routes.test.ts`
Expected: PASS. Then `pnpm --filter @openldr/server typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/reports-routes.ts apps/server/src/reports-routes.test.ts
git commit -m "feat(reports): scheduled-run list + authenticated download routes"
```

---

## Task 8: Full gate + memory

- [ ] **Step 1: Full gate**

Run: `pnpm -w turbo typecheck lint test build`
Expected: green. If `@openldr/web#test` flakes (known parallel flake — unrelated, web is untouched here), re-run `pnpm --filter @openldr/web test`. Fix any real failures surfaced by the new backend code.

- [ ] **Step 2: Depcruise**

Run: `pnpm -w depcruise`
Expected: clean. `packages/bootstrap/src/report-scheduler.ts` imports only from `@openldr/reporting`, `@openldr/ports`, `@openldr/db`, `xlsx`, `node:crypto` — all allowed bootstrap deps (bootstrap already depends on these). If depcruise flags a new cross-package edge, confirm the dependency is declared in `packages/bootstrap/package.json`.

- [ ] **Step 3: Update memory**

Edit `C:\Users\Fredrick\.claude\projects\D--Projects-Repositories-openldr-ce\memory\reports-page-workstream.md`: note **SP-3a (scheduling engine) COMPLETE** — migration 026 (`report_schedules` + `report_schedule_runs`), `schedule-period.ts` (`nextRunAt`/`periodFor`), `ReportScheduleStore`, `createReportScheduler` (event-bus runner mirroring DHIS2, renders CSV/XLSX/PDF to `ctx.blob`, run-now = fire-and-forget `runDue`), `ctx.reportSchedules`+`ctx.reportScheduler`, runner wired in `apps/server/src/index.ts`, 7 routes (CRUD gated to lab_admin/lab_manager + run-now + schedule-runs list + authenticated download). **SP-3b (scheduling UI) PENDING.** Update the matching MEMORY.md line.

- [ ] **Step 4: Commit (if the gate required fixes)**

```bash
git add -A
git commit -m "chore(reports): SP-3a gate green"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** data model → Task 1; date math → Task 2; store → Task 3; runner + render-to-blob → Task 4; `ctx` wiring + startup registration → Task 5; CRUD + run-now routes → Task 6; schedule-runs list + download → Task 7; testing throughout + gate → Task 8. No UI (3b) — correct.
- **Type consistency:** `ScheduleFrequency`/`ScheduleOutputFormat`/`ScheduleRecord`/`NewSchedule`/`SchedulePatch`/`ScheduleRunRecord`/`NewScheduleRun` are defined once in `report-schedule-store.ts` (Task 3) and consumed by the runner (Task 4) and routes (Tasks 6/7). The runner's `recordRun({...})` object matches `NewScheduleRun` exactly (id, scheduleId, reportId, reportName, runAt, periodStart, periodEnd, outputFormat, objectKey, byteSize, rowCount, status, errorMessage). `nextRunAt`/`periodFor` signatures are identical between Task 2 (def) and Tasks 4/6 (use).
- **Route ordering:** all `schedules`/`schedule-runs` routes are registered before the bare `/api/reports/:id` GET (Tasks 6/7), so the static segments win over `:id`.
- **The eventing seam (resolved):** route-level initial-arm publishes use `ctx.eventing`; the runner registers on `ingest.eventing`. Both are `createEventBus({ url: INTERNAL_DATABASE_URL })` → the same PG outbox table drained by the ingest worker, so this is correct (confirmed by reading bootstrap + ingest-context).
- **Known gotcha honored:** `migrations.test.ts` assertion updated in Task 1.
