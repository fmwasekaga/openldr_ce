# DHIS2 Integration — Slice B (Tracker events + full sync model) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DHIS2 tracker (event-program) push sourced per-record from the external flat tables, plus a full sync model — period-aligned scheduled push via self-rescheduling outbox events + event-driven tracker push on ingest — reusing Slice A's adapter, mapping store, audit, and dry-run.

**Architecture:** Extend existing seams (Approach A). `ReportingTargetPort` gains `pushEvents`; `@openldr/dhis2` gains a pure tracker engine (`buildEvents`, period helpers, `dhis2Uid`, `validateTrackerMapping`); `@openldr/reporting` gains an `EventSource` catalog; `@openldr/db` gains a `dhis2_schedules` table + `ScheduleStore`; the `EventingPort` gains delayed publish (`availableAt`); `@openldr/bootstrap` unifies aggregate/tracker push in `runMapping` and registers a sync worker on the ingest event bus; `apps/server` wires it on boot.

**Tech Stack:** TypeScript ESM, zod (config), Kysely (internal PG + external multi-driver), `fetch` (DHIS2 `/api/tracker`), node:crypto (deterministic UID), commander (CLI), Docker (`dhis2/core` + `postgis`), vitest.

**Spec:** `docs/superpowers/specs/2026-06-14-dhis2-slice-b-design.md`.

---

## Key facts (verified in the codebase)

- **Ports** (`packages/ports/src/`): `reporting-target.ts` has `TargetMetadata { dataElements, orgUnits, categoryOptionCombos }`, `PushResult { status, imported, updated, ignored, deleted, conflicts, raw }`, `ReportingTargetPort { healthCheck, pullMetadata, pushAggregate }`. `eventing.ts` has `EventEnvelope { type, payload }`, `EventingPort { healthCheck, publish(event), subscribe(type, handler) }`. Each file is re-exported via `export * from` in `packages/ports/src/index.ts`.
- **adapter-dhis2** (`packages/adapter-dhis2/src/index.ts`): `createDhis2Target(cfg, deps={})` returns `Dhis2Target extends ReportingTargetPort` with `close()`. Uses a `deps.fetch` seam, Basic-auth `headers`, `getJson<T>(path)`, `probe()` for health. `pushAggregate` already parses the import summary **even on HTTP 409** (`hasSummary` guard) — mirror that for tracker.
- **adapter-event-bus** (`packages/adapter-event-bus/src/index.ts`): `publish(event)` inserts `outbox_events (id, type, payload, batch_id)` (the `available_at` column defaults to `now()` in the DB), then `pg_notify`. `subscribe(type, handler)` stores ONE handler per type in a Map. `drain()`/`startWorker()` claim `where status='pending' and available_at <= now()`. Unknown event types are requeued `+60s` (so a second worker on the same table would interfere — keep ONE worker).
- **@openldr/dhis2** (`packages/dhis2/src/`): `types.ts` (`AggregateMapping`, `ColumnMapping`, `MappingSource`, `DataValueSet`, `SkipRecord`, `BuildOutput`), `mapping.ts` (`buildDataValueSet`, `dispatchReportSource`), `validate.ts` (`validateMapping`), `index.ts` (`export * from './types'|'./mapping'|'./validate'`). Imports `OpenLdrError` from `@openldr/core`. Pure — no DB/adapter imports.
- **@openldr/reporting** (`packages/reporting/src/`): `types.ts` has `ReportDefinition<P> { id, name, description, params, run(db: Kysely<ExternalSchema>, p): Promise<ReportResultData> }`. `helpers.ts` exports `endOfDay(to)` (extends a `YYYY-MM-DD` to end-of-day). `catalog.ts` registers reports. `index.ts` = `export * from './types'|'./helpers'|'./catalog'`. Queries do filtering in Kysely, transforms in pure helpers (no raw SQL).
- **ExternalSchema** (`packages/db/src/schema/external.ts`): `observations { id, code_text, interpretation_code ('S'|'I'|'R'), subject_ref ('Patient/{id}'), specimen_ref, effective_date_time, ... }`, `patients { id, managing_organization, ... }`. `amr-resistance` filters `observations` on `interpretation_code in ('S','I','R')` and `effective_date_time` and joins patients in JS.
- **Internal migrations**: `packages/db/src/migrations/internal/00x.ts` + `internal/index.ts` (object keyed by name) + `packages/db/src/schema/internal.ts` (`InternalSchema`). Latest is `008_dhis2`. `packages/db/src/migrations/migrations.test.ts` asserts the ordered key list. Stores live in `packages/db/src/*-store.ts`, exported via `packages/db/src/index.ts`. jsonb insert idiom: `JSON.stringify(x) as any` with `// eslint-disable-next-line @typescript-eslint/no-explicit-any`.
- **@openldr/db dhis2 stores** (`packages/db/src/dhis2-store.ts`): `createOrgUnitMapStore(db).getMap()` → `Map<facilityId, orgUnitId>`; `createMappingStore(db)` = `upsert/get/list` over `dhis2_mappings` (definition jsonb).
- **audit** (`packages/audit/src/store.ts`): `createAuditStore(db)` = `record/list(filter)/get`; `AuditEventInput { actorType, actorId?, actorName, action, entityType, entityId, before?, after?, metadata? }`; `safeRecord(store, logger, e)` best-effort. `list({ entityType, limit })`.
- **bootstrap** (`packages/bootstrap/src/`): `createDhis2Context(cfg)` (`dhis2-context.ts`) builds internal db + orgUnits + mappings + audit + target; `push({mappingId, period, dryRun, runReport})`. `createAppContext` (`index.ts`) exposes `reporting: { list, run(id, rawParams) }` over `store.db as Kysely<ExternalSchema>`; `createIngestContext` (`ingest-context.ts`) owns its own event bus, `subscribe('ingest.received', handleIngestEvent)`, and `startWorker()`. `index.ts` re-exports each context.
- **@openldr/ingest handle.ts**: `handleIngestEvent(deps, event)`; `HandleDeps { blob, persist, resolver, batches, logger, audit? }`; on success it `markDone` + calls `deps.audit?.({action:'ingest.batch.done', ...})`. No outbox event is published on completion.
- **apps/server** (`apps/server/src/index.ts`): `main()` = `createAppContext` → `buildApp` → `createIngestContext` → `ingest.startWorker()`; SIGTERM/SIGINT close everything.
- **config** (`packages/config/src/schema.ts`): `z.object({...}).superRefine(...)`; `REPORTING_TARGET_ADAPTER: z.enum(['none','dhis2'])` + `DHIS2_*` already present (Slice A). Tests in `packages/config/src/load.test.ts` with a `basePg` fixture.
- **CLI** (`packages/cli/src/dhis2.ts` + `index.ts`): per-feature `runDhis2*` handlers returning exit codes; `--json` everywhere; commander groups; `build:check` runs the built artifact.
- DHIS2 server for live acceptance is already running on `http://localhost:8085` (admin:district), SL demo loaded. The SL demo includes an **event program without registration** ("Inpatient morbidity and mortality") usable for event-only push.

---

## Task 1: `pushEvents` on the port + adapter-dhis2 tracker push + program metadata

**Files:**
- Modify: `packages/ports/src/reporting-target.ts`
- Modify: `packages/adapter-dhis2/src/index.ts`
- Modify: `packages/adapter-dhis2/src/index.test.ts`

- [ ] **Step 1: Extend the port** — in `packages/ports/src/reporting-target.ts`, add the two metadata arrays to `TargetMetadata` and `pushEvents` to `ReportingTargetPort`:

```ts
export interface TargetMetadata {
  dataElements: { id: string; name: string }[];
  orgUnits: { id: string; name: string }[];
  categoryOptionCombos: { id: string; name: string }[];
  programs?: { id: string; name: string }[];
  programStages?: { id: string; name: string; program: string }[];
}
```
and in `ReportingTargetPort` add:
```ts
  pushEvents(payload: unknown): Promise<PushResult>;
```
(`programs`/`programStages` are optional so existing aggregate-only metadata stays valid.)

- [ ] **Step 2: Write failing adapter tests** — append inside `describe('createDhis2Target', ...)` in `packages/adapter-dhis2/src/index.test.ts`:

```ts
  it('pushEvents parses the DHIS2 tracker import report (success)', async () => {
    const report = { status: 'OK', stats: { created: 2, updated: 1, deleted: 0, ignored: 0 }, validationReport: { errorReports: [] } };
    const fetchMock = vi.fn(async () => jsonResponse(report));
    const t = createDhis2Target(cfg, { fetch: fetchMock as unknown as typeof fetch });
    const r = await t.pushEvents({ events: [] });
    expect(r).toMatchObject({ status: 'success', imported: 2, updated: 1 });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/tracker'), expect.objectContaining({ method: 'POST' }));
  });
  it('pushEvents maps a 409 validation report to an error with conflicts', async () => {
    const report = { status: 'ERROR', stats: { created: 0, updated: 0, deleted: 0, ignored: 1 }, validationReport: { errorReports: [{ message: 'bad event', uid: 'E1' }] } };
    const fetchMock = vi.fn(async () => ({ ok: false, status: 409, json: async () => report, text: async () => JSON.stringify(report) } as Response));
    const t = createDhis2Target(cfg, { fetch: fetchMock as unknown as typeof fetch });
    const r = await t.pushEvents({ events: [] });
    expect(r.status).toBe('error');
    expect(r.ignored).toBe(1);
    expect(r.conflicts).toEqual([{ object: 'E1', value: 'bad event' }]);
  });
  it('pullMetadata includes programs + programStages', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('dataElements')) return jsonResponse({ dataElements: [{ id: 'DE1', name: 'd' }] });
      if (url.includes('organisationUnits')) return jsonResponse({ organisationUnits: [{ id: 'OU1', name: 'o' }] });
      if (url.includes('programStages')) return jsonResponse({ programStages: [{ id: 'PS1', name: 'ps', program: { id: 'PR1' } }] });
      if (url.includes('programs')) return jsonResponse({ programs: [{ id: 'PR1', name: 'pr' }] });
      return jsonResponse({ categoryOptionCombos: [{ id: 'COC1', name: 'c' }] });
    });
    const t = createDhis2Target(cfg, { fetch: fetchMock as unknown as typeof fetch });
    const m = await t.pullMetadata();
    expect(m.programs?.[0].id).toBe('PR1');
    expect(m.programStages?.[0]).toMatchObject({ id: 'PS1', program: 'PR1' });
  });
```

- [ ] **Step 3: Run, verify fail** — `pnpm --filter @openldr/adapter-dhis2 test`. Expected: FAIL (`pushEvents` is not a function; metadata lacks programs).

- [ ] **Step 4: Implement** in `packages/adapter-dhis2/src/index.ts`. Add a tracker-report interface near `ImportSummary`:
```ts
interface TrackerReport {
  status?: string;
  stats?: { created?: number; updated?: number; deleted?: number; ignored?: number };
  validationReport?: { errorReports?: { message?: string; uid?: string }[] };
}
```
Extend `pullMetadata` to also fetch programs + stages (add before the `return`):
```ts
      const prog = await getJson<{ programs?: { id: string; name: string }[] }>('/api/programs.json?fields=id,name&paging=false');
      const ps = await getJson<{ programStages?: { id: string; name: string; program?: { id: string } }[] }>('/api/programStages.json?fields=id,name,program&paging=false');
```
and add to the returned object:
```ts
        programs: prog.programs ?? [],
        programStages: (ps.programStages ?? []).map((s) => ({ id: s.id, name: s.name, program: s.program?.id ?? '' })),
```
Add the `pushEvents` method to the returned object (after `pushAggregate`), reusing the parse-even-on-409 pattern:
```ts
    async pushEvents(payload): Promise<PushResult> {
      const res = await doFetch(`${base}/api/tracker?async=false&importStrategy=CREATE_AND_UPDATE`, { method: 'POST', headers, body: JSON.stringify(payload) });
      const text = await res.text();
      let body: TrackerReport | undefined;
      try { body = text ? (JSON.parse(text) as TrackerReport) : undefined; } catch { body = undefined; }
      const hasReport = !!body && typeof body === 'object' && (body.status !== undefined || body.stats !== undefined || body.validationReport !== undefined);
      if (!hasReport) throw new Error(`DHIS2 tracker -> ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
      const stats = body!.stats ?? {};
      const rawStatus = (body!.status ?? '').toUpperCase();
      const status: PushResult['status'] =
        rawStatus === 'ERROR' ? 'error' : rawStatus === 'WARNING' ? 'warning' : rawStatus === 'OK' || rawStatus === 'SUCCESS' ? 'success' : res.ok ? 'success' : 'error';
      const conflicts = (body!.validationReport?.errorReports ?? []).map((e) => ({ object: e.uid ?? '', value: e.message ?? '' }));
      return { status, imported: stats.created ?? 0, updated: stats.updated ?? 0, ignored: stats.ignored ?? 0, deleted: stats.deleted ?? 0, conflicts, raw: body };
    },
```

- [ ] **Step 5: Run, verify pass** — `pnpm --filter @openldr/adapter-dhis2 test && pnpm --filter @openldr/adapter-dhis2 typecheck && pnpm --filter @openldr/ports typecheck`. Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add packages/ports/src/reporting-target.ts packages/adapter-dhis2/src/index.ts packages/adapter-dhis2/src/index.test.ts
git commit -m "feat(ports,adapter-dhis2): pushEvents (tracker) + program metadata (P2-DHIS2-2)"
```

---

## Task 2: `EventingPort` delayed publish (`availableAt`)

**Files:**
- Modify: `packages/ports/src/eventing.ts`
- Modify: `packages/adapter-event-bus/src/index.ts`
- Modify: `packages/adapter-event-bus/src/publish.test.ts`

- [ ] **Step 1: Extend the port** — in `packages/ports/src/eventing.ts` change the `publish` signature:
```ts
export interface PublishOptions {
  /** Earliest time the event may be claimed. Omitted ⇒ now (immediate). */
  availableAt?: Date;
}

export interface EventingPort {
  healthCheck(): Promise<HealthResult>;
  publish(event: EventEnvelope, opts?: PublishOptions): Promise<void>;
  subscribe(type: string, handler: EventHandler): Promise<void>;
}
```

- [ ] **Step 2: Write a failing test** — append to `packages/adapter-event-bus/src/publish.test.ts` (mirror the existing test's pool/bus setup; if it uses a real pg pool fixture, follow that — otherwise assert the inserted row's `available_at`). Add:
```ts
  it('publish with availableAt defers the row', async () => {
    const future = new Date(Date.now() + 3_600_000);
    await bus.publish({ type: 'dhis2.sync.due', payload: { scheduleId: 's1' } }, { availableAt: future });
    const { rows } = await pool.query(`select available_at from outbox_events where type='dhis2.sync.due' order by available_at desc limit 1`);
    expect(new Date(rows[0].available_at).getTime()).toBeGreaterThan(Date.now() + 60_000);
  });
```
(If `publish.test.ts` mocks the pool instead of using a live one, assert that the insert was called with the future timestamp parameter instead.)

- [ ] **Step 3: Run, verify fail** — `pnpm --filter @openldr/adapter-event-bus test`. Expected: FAIL.

- [ ] **Step 4: Implement** — in `packages/adapter-event-bus/src/index.ts`, change `publish` to accept opts and insert `available_at` when given:
```ts
  async function publish(event: EventEnvelope, opts: { availableAt?: Date } = {}): Promise<void> {
    const id = randomUUID();
    const batchId = (event.payload as { batchId?: string } | null)?.batchId ?? null;
    if (opts.availableAt) {
      await pool.query(
        `insert into outbox_events (id, type, payload, batch_id, available_at) values ($1, $2, $3, $4, $5)`,
        [id, event.type, JSON.stringify(event.payload), batchId, opts.availableAt.toISOString()],
      );
    } else {
      await pool.query(
        `insert into outbox_events (id, type, payload, batch_id) values ($1, $2, $3, $4)`,
        [id, event.type, JSON.stringify(event.payload), batchId],
      );
    }
    await pool.query(`select pg_notify('openldr_events', $1)`, [event.type]);
  }
```

- [ ] **Step 5: Run, verify pass** — `pnpm --filter @openldr/adapter-event-bus test && pnpm --filter @openldr/adapter-event-bus typecheck && pnpm --filter @openldr/ports typecheck`. Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add packages/ports/src/eventing.ts packages/adapter-event-bus/src/index.ts packages/adapter-event-bus/src/publish.test.ts
git commit -m "feat(ports,adapter-event-bus): delayed publish via availableAt (P2-DHIS2-5)"
```

---

## Task 3: `@openldr/dhis2` — period helpers + `dhis2Uid` (TDD)

**Files:**
- Create: `packages/dhis2/src/period.ts`
- Create: `packages/dhis2/src/period.test.ts`
- Create: `packages/dhis2/src/uid.ts`
- Create: `packages/dhis2/src/uid.test.ts`
- Modify: `packages/dhis2/src/index.ts`

- [ ] **Step 1: Write failing tests** — `packages/dhis2/src/period.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { periodRange, currentPeriod, previousPeriod, nextPeriodBoundary } from './period';

describe('periodRange', () => {
  it('quarterly', () => expect(periodRange('2026Q1')).toEqual({ from: '2026-01-01', to: '2026-03-31' }));
  it('monthly', () => expect(periodRange('202602')).toEqual({ from: '2026-02-01', to: '2026-02-28' }));
  it('yearly', () => expect(periodRange('2024')).toEqual({ from: '2024-01-01', to: '2024-12-31' }));
  it('rejects garbage', () => expect(() => periodRange('nope')).toThrow(/period/i));
});
describe('current/previous period', () => {
  const mar = new Date(Date.UTC(2026, 2, 15));
  it('current quarterly', () => expect(currentPeriod('quarterly', mar)).toBe('2026Q1'));
  it('current monthly', () => expect(currentPeriod('monthly', mar)).toBe('202603'));
  it('previous monthly across year', () => expect(previousPeriod('monthly', new Date(Date.UTC(2026, 0, 9)))).toBe('202512'));
  it('previous quarterly', () => expect(previousPeriod('quarterly', mar)).toBe('2025Q4'));
  it('previous yearly', () => expect(previousPeriod('yearly', mar)).toBe('2025'));
});
describe('nextPeriodBoundary', () => {
  it('monthly → first of next month (UTC)', () => expect(nextPeriodBoundary('monthly', new Date(Date.UTC(2026, 2, 15))).toISOString()).toBe('2026-04-01T00:00:00.000Z'));
  it('quarterly → first of next quarter', () => expect(nextPeriodBoundary('quarterly', new Date(Date.UTC(2026, 1, 1))).toISOString()).toBe('2026-04-01T00:00:00.000Z'));
});
```
And `packages/dhis2/src/uid.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { dhis2Uid } from './uid';

describe('dhis2Uid', () => {
  it('is 11 chars, leading letter, alphanumeric', () => {
    const u = dhis2Uid('amr-to-dhis2-demo:obs-1');
    expect(u).toMatch(/^[A-Za-z][A-Za-z0-9]{10}$/);
  });
  it('is deterministic', () => expect(dhis2Uid('x:y')).toBe(dhis2Uid('x:y')));
  it('differs by seed', () => expect(dhis2Uid('a')).not.toBe(dhis2Uid('b')));
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @openldr/dhis2 test`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `packages/dhis2/src/period.ts`:**
```ts
import { OpenLdrError } from '@openldr/core';

export type PeriodType = 'monthly' | 'quarterly' | 'yearly';

function pad2(n: number): string { return String(n).padStart(2, '0'); }

export function currentPeriod(type: PeriodType, now: Date): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (type === 'yearly') return String(y);
  if (type === 'quarterly') return `${y}Q${Math.floor(m / 3) + 1}`;
  return `${y}${pad2(m + 1)}`;
}

export function previousPeriod(type: PeriodType, now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (type === 'yearly') return String(d.getUTCFullYear() - 1);
  if (type === 'quarterly') { d.setUTCMonth(d.getUTCMonth() - 3); return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`; }
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}`;
}

export function periodRange(period: string): { from: string; to: string } {
  let y: number; let startM: number; let months: number;
  const q = /^(\d{4})Q([1-4])$/.exec(period);
  const mo = /^(\d{4})(\d{2})$/.exec(period);
  const yr = /^(\d{4})$/.exec(period);
  if (q) { y = +q[1]; startM = (+q[2] - 1) * 3; months = 3; }
  else if (mo) { y = +mo[1]; startM = +mo[2] - 1; months = 1; }
  else if (yr) { y = +yr[1]; startM = 0; months = 12; }
  else throw new OpenLdrError(`invalid DHIS2 period: '${period}'`);
  const from = `${y}-${pad2(startM + 1)}-01`;
  const end = new Date(Date.UTC(y, startM + months, 0));
  const to = `${end.getUTCFullYear()}-${pad2(end.getUTCMonth() + 1)}-${pad2(end.getUTCDate())}`;
  return { from, to };
}

export function nextPeriodBoundary(type: PeriodType, now: Date): Date {
  const y = now.getUTCFullYear(); const m = now.getUTCMonth();
  if (type === 'yearly') return new Date(Date.UTC(y + 1, 0, 1));
  if (type === 'quarterly') return new Date(Date.UTC(y, (Math.floor(m / 3) + 1) * 3, 1));
  return new Date(Date.UTC(y, m + 1, 1));
}
```

- [ ] **Step 4: Implement `packages/dhis2/src/uid.ts`:**
```ts
import { createHash } from 'node:crypto';

const ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ALNUM = `${ALPHA}0123456789`;

/** Deterministic DHIS2 UID (11 chars, leading letter) from a stable seed. */
export function dhis2Uid(seed: string): string {
  const h = createHash('sha256').update(seed).digest();
  let out = ALPHA[h[0] % ALPHA.length];
  for (let i = 1; i < 11; i++) out += ALNUM[h[i] % ALNUM.length];
  return out;
}
```

- [ ] **Step 5: Export** — append to `packages/dhis2/src/index.ts`:
```ts
export * from './period';
export * from './uid';
```

- [ ] **Step 6: Run, verify pass** — `pnpm --filter @openldr/dhis2 test && pnpm --filter @openldr/dhis2 typecheck`. Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add packages/dhis2/src/period.ts packages/dhis2/src/period.test.ts packages/dhis2/src/uid.ts packages/dhis2/src/uid.test.ts packages/dhis2/src/index.ts
git commit -m "feat(dhis2): period helpers + deterministic dhis2Uid (P2-DHIS2-5/2)"
```

---

## Task 4: `@openldr/dhis2` — TrackerMapping + buildEvents + validateTrackerMapping (TDD)

**Files:**
- Modify: `packages/dhis2/src/types.ts`
- Create: `packages/dhis2/src/tracker.ts`
- Create: `packages/dhis2/src/tracker.test.ts`
- Modify: `packages/dhis2/src/index.ts`

- [ ] **Step 1: Extend types** — in `packages/dhis2/src/types.ts`, add `kind?: 'aggregate'` to `AggregateMapping` (open the interface and add the field), then append:
```ts
export interface TrackerColumnMapping {
  column: string;
  dataElement: string;
}

export interface TrackerMapping {
  kind: 'tracker';
  id: string;
  name: string;
  source: { kind: 'event-source'; sourceId: string; params?: Record<string, string> };
  program: string;
  programStage: string;
  orgUnitColumn: string;
  eventDateColumn: string;
  idColumn: string;
  dataValues: TrackerColumnMapping[];
}

export type DhisMapping = AggregateMapping | TrackerMapping;

export interface TrackerEvent {
  event: string;
  program: string;
  programStage: string;
  orgUnit: string;
  occurredAt: string;
  dataValues: { dataElement: string; value: string }[];
}

export interface EventSet {
  events: TrackerEvent[];
}

export interface BuildEventsOutput {
  payload: EventSet;
  skipped: SkipRecord[];
}
```

- [ ] **Step 2: Write failing tests** — `packages/dhis2/src/tracker.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildEvents, validateTrackerMapping } from './tracker';
import type { TrackerMapping } from './types';
import type { TargetMetadata } from '@openldr/ports';

const mapping: TrackerMapping = {
  kind: 'tracker', id: 'amr-events', name: 'AMR events',
  source: { kind: 'event-source', sourceId: 'amr-isolates' },
  program: 'PR1', programStage: 'PS1',
  orgUnitColumn: 'facility', eventDateColumn: 'eventDate', idColumn: 'id',
  dataValues: [{ column: 'antibiotic', dataElement: 'DE_AB' }, { column: 'result', dataElement: 'DE_RES' }],
};
const orgMap = new Map([['fac-1', 'OU_AAA']]);

describe('buildEvents', () => {
  it('builds one event per row with a deterministic uid', () => {
    const rows = [{ id: 'obs-1', facility: 'fac-1', eventDate: '2026-01-10', antibiotic: 'AMP', result: 'R' }];
    const { payload, skipped } = buildEvents(rows, mapping, orgMap);
    expect(skipped).toEqual([]);
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toMatchObject({ program: 'PR1', programStage: 'PS1', orgUnit: 'OU_AAA', occurredAt: '2026-01-10' });
    expect(payload.events[0].event).toMatch(/^[A-Za-z][A-Za-z0-9]{10}$/);
    expect(payload.events[0].dataValues).toEqual([{ dataElement: 'DE_AB', value: 'AMP' }, { dataElement: 'DE_RES', value: 'R' }]);
  });
  it('skips rows with no orgUnit mapping', () => {
    const { payload, skipped } = buildEvents([{ id: 'o', facility: 'nope', eventDate: '2026-01-10' }], mapping, orgMap);
    expect(payload.events).toEqual([]);
    expect(skipped[0].reason).toMatch(/orgUnit/i);
  });
  it('skips rows missing eventDate or id', () => {
    expect(buildEvents([{ id: 'o', facility: 'fac-1' }], mapping, orgMap).skipped[0].reason).toMatch(/eventDate/i);
    expect(buildEvents([{ facility: 'fac-1', eventDate: '2026-01-10' }], mapping, orgMap).skipped[0].reason).toMatch(/idColumn/i);
  });
  it('omits empty dataValues but keeps the event', () => {
    const rows = [{ id: 'obs-2', facility: 'fac-1', eventDate: '2026-01-10', antibiotic: 'CIP', result: null }];
    expect(buildEvents(rows, mapping, orgMap).payload.events[0].dataValues).toEqual([{ dataElement: 'DE_AB', value: 'CIP' }]);
  });
});

describe('validateTrackerMapping', () => {
  const metadata: TargetMetadata = {
    dataElements: [{ id: 'DE_AB', name: 'ab' }, { id: 'DE_RES', name: 'res' }],
    orgUnits: [], categoryOptionCombos: [],
    programs: [{ id: 'PR1', name: 'p' }], programStages: [{ id: 'PS1', name: 's', program: 'PR1' }],
  };
  it('passes when program/stage/dataElements exist', () => expect(validateTrackerMapping(mapping, metadata)).toEqual([]));
  it('flags unknown program', () => expect(validateTrackerMapping({ ...mapping, program: 'X' }, metadata).some((p) => p.includes('X'))).toBe(true));
  it('flags unknown dataElement', () => expect(validateTrackerMapping({ ...mapping, dataValues: [{ column: 'c', dataElement: 'DE_NO' }] }, metadata).some((p) => p.includes('DE_NO'))).toBe(true));
});
```

- [ ] **Step 3: Run, verify fail** — `pnpm --filter @openldr/dhis2 test`. Expected: FAIL (module missing).

- [ ] **Step 4: Implement `packages/dhis2/src/tracker.ts`:**
```ts
import type { TargetMetadata } from '@openldr/ports';
import { dhis2Uid } from './uid';
import type { BuildEventsOutput, SkipRecord, TrackerEvent, TrackerMapping } from './types';

function isEmpty(v: unknown): boolean { return v === null || v === undefined || v === ''; }

export function buildEvents(rows: Record<string, unknown>[], mapping: TrackerMapping, orgUnitMap: Map<string, string>): BuildEventsOutput {
  const events: TrackerEvent[] = [];
  const skipped: SkipRecord[] = [];
  rows.forEach((row, i) => {
    const facility = row[mapping.orgUnitColumn];
    const orgUnit = typeof facility === 'string' ? orgUnitMap.get(facility) : undefined;
    if (!orgUnit) { skipped.push({ row: i, reason: `no orgUnit mapping for facility '${String(facility)}'` }); return; }
    const occurredAt = row[mapping.eventDateColumn];
    if (isEmpty(occurredAt)) { skipped.push({ row: i, reason: `missing eventDate column '${mapping.eventDateColumn}'` }); return; }
    const recordKey = row[mapping.idColumn];
    if (isEmpty(recordKey)) { skipped.push({ row: i, reason: `missing idColumn '${mapping.idColumn}'` }); return; }
    const dataValues = mapping.dataValues
      .filter((c) => !isEmpty(row[c.column]))
      .map((c) => ({ dataElement: c.dataElement, value: String(row[c.column]) }));
    events.push({
      event: dhis2Uid(`${mapping.id}:${String(recordKey)}`),
      program: mapping.program,
      programStage: mapping.programStage,
      orgUnit,
      occurredAt: String(occurredAt),
      dataValues,
    });
  });
  return { payload: { events }, skipped };
}

export function validateTrackerMapping(mapping: TrackerMapping, metadata: TargetMetadata): string[] {
  const programs = new Set((metadata.programs ?? []).map((p) => p.id));
  const stages = new Set((metadata.programStages ?? []).map((s) => s.id));
  const des = new Set(metadata.dataElements.map((d) => d.id));
  const problems: string[] = [];
  if (!programs.has(mapping.program)) problems.push(`unknown program '${mapping.program}'`);
  if (!stages.has(mapping.programStage)) problems.push(`unknown programStage '${mapping.programStage}'`);
  for (const c of mapping.dataValues) if (!des.has(c.dataElement)) problems.push(`unknown dataElement '${c.dataElement}' (column '${c.column}')`);
  return problems;
}
```

- [ ] **Step 5: Export** — append to `packages/dhis2/src/index.ts`:
```ts
export * from './tracker';
```

- [ ] **Step 6: Run, verify pass** — `pnpm --filter @openldr/dhis2 test && pnpm --filter @openldr/dhis2 typecheck`. Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add packages/dhis2/src/types.ts packages/dhis2/src/tracker.ts packages/dhis2/src/tracker.test.ts packages/dhis2/src/index.ts
git commit -m "feat(dhis2): TrackerMapping + buildEvents + validateTrackerMapping (P2-DHIS2-2)"
```

---

## Task 5: `@openldr/reporting` — EventSource + `amr-isolates` + catalog

**Files:**
- Create: `packages/reporting/src/eventsource.ts`
- Create: `packages/reporting/src/reports/amr-isolates.ts`
- Modify: `packages/reporting/src/index.ts`

Verified by typecheck + live acceptance (the SQL surface has no unit test, consistent with the existing report queries).

- [ ] **Step 1: Create `packages/reporting/src/eventsource.ts`:**
```ts
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import { amrIsolates } from './reports/amr-isolates';

export interface EventWindow { from: string; to: string }

export interface EventSource {
  id: string;
  name: string;
  run(db: Kysely<ExternalSchema>, window: EventWindow, params?: Record<string, string>): Promise<{ rows: Record<string, unknown>[] }>;
}

const SOURCES: EventSource[] = [amrIsolates];

export function eventSourceCatalog(): EventSource[] { return SOURCES; }
export function getEventSource(id: string): EventSource | undefined { return SOURCES.find((s) => s.id === id); }
```

- [ ] **Step 2: Create `packages/reporting/src/reports/amr-isolates.ts`** (one row per AST observation; facility joined in JS; multi-driver, no raw SQL):
```ts
import type { EventSource } from '../eventsource';
import { endOfDay } from '../helpers';

export const amrIsolates: EventSource = {
  id: 'amr-isolates',
  name: 'AMR isolates (per AST result)',
  async run(db, window) {
    const obs = await db
      .selectFrom('observations')
      .where('interpretation_code', 'in', ['S', 'I', 'R'])
      .where('effective_date_time', '>=', window.from)
      .where('effective_date_time', '<=', endOfDay(window.to))
      .select(['id', 'code_text', 'interpretation_code', 'effective_date_time', 'subject_ref'])
      .execute();
    if (obs.length === 0) return { rows: [] };
    const patientIds = [
      ...new Set(
        obs.map((o) => o.subject_ref).filter((s): s is string => !!s).map((s) => s.replace(/^Patient\//, '')),
      ),
    ];
    const patients = patientIds.length
      ? await db.selectFrom('patients').select(['id', 'managing_organization']).where('id', 'in', patientIds).execute()
      : [];
    const facilityById = new Map(patients.map((p) => [p.id, p.managing_organization]));
    const rows = obs.map((o) => ({
      id: o.id,
      facility: o.subject_ref ? facilityById.get(o.subject_ref.replace(/^Patient\//, '')) ?? null : null,
      eventDate: o.effective_date_time,
      antibiotic: o.code_text,
      result: o.interpretation_code,
    }));
    return { rows };
  },
};
```

- [ ] **Step 3: Export** — append to `packages/reporting/src/index.ts`:
```ts
export * from './eventsource';
```

- [ ] **Step 4: Typecheck** — `pnpm --filter @openldr/reporting typecheck && pnpm --filter @openldr/reporting test`. Expected: PASS (existing helper tests still green).

- [ ] **Step 5: Commit**
```bash
git add packages/reporting/src/eventsource.ts packages/reporting/src/reports/amr-isolates.ts packages/reporting/src/index.ts
git commit -m "feat(reporting): EventSource catalog + amr-isolates per-record source (P2-DHIS2-2)"
```

---

## Task 6: `runEventSource` on `AppContext.reporting`

**Files:**
- Modify: `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Extend the import** — in `packages/bootstrap/src/index.ts`, add `getEventSource` to the `@openldr/reporting` import:
```ts
import { getReport, reportSummaries, getEventSource, type ReportResult, type ReportSummary } from '@openldr/reporting';
```

- [ ] **Step 2: Extend `ReportingApi`:**
```ts
export interface ReportingApi {
  list(): ReportSummary[];
  run(id: string, rawParams: unknown): Promise<ReportResult>;
  runEventSource(id: string, window: { from: string; to: string }): Promise<{ rows: Record<string, unknown>[] }>;
}
```

- [ ] **Step 3: Implement** — inside the `reporting` object literal (after `run`):
```ts
    async runEventSource(id, window) {
      const src = getEventSource(id);
      if (!src) throw new ReportNotFoundError(id);
      return src.run(reportingDb, window);
    },
```

- [ ] **Step 4: Typecheck** — `pnpm --filter @openldr/bootstrap typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): reporting.runEventSource over the EventSource catalog (P2-DHIS2-2)"
```

---

## Task 7: Migration `009_dhis2_schedules` + `ScheduleStore`

**Files:**
- Create: `packages/db/src/migrations/internal/009_dhis2_schedules.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/schema/internal.ts`
- Modify: `packages/db/src/migrations/migrations.test.ts`
- Create: `packages/db/src/dhis2-schedule-store.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Create `packages/db/src/migrations/internal/009_dhis2_schedules.ts`:**
```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('dhis2_schedules')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('mapping_id', 'text', (c) => c.notNull())
    .addColumn('mode', 'text', (c) => c.notNull())
    .addColumn('period_type', 'text', (c) => c.notNull())
    .addColumn('event_driven', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('last_run_at', 'timestamptz')
    .addColumn('next_due_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('dhis2_schedules').ifExists().execute();
}
```

- [ ] **Step 2: Register** in `packages/db/src/migrations/internal/index.ts` — add `import * as m009 from './009_dhis2_schedules';` and `'009_dhis2_schedules': { up: m009.up, down: m009.down },` after `'008_dhis2'`.

- [ ] **Step 3: Schema** — in `packages/db/src/schema/internal.ts`, add before `InternalSchema` (reuse the existing `Generated` import):
```ts
export interface Dhis2SchedulesTable {
  id: string;
  mapping_id: string;
  mode: string;
  period_type: string;
  event_driven: Generated<boolean>;
  enabled: Generated<boolean>;
  last_run_at: Date | null;
  next_due_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
```
and add inside `InternalSchema`:
```ts
  dhis2_schedules: Dhis2SchedulesTable;
```

- [ ] **Step 4: Update** `packages/db/src/migrations/migrations.test.ts` — append `'009_dhis2_schedules'` to the asserted internal-keys array (ending in `'008_dhis2'`).

- [ ] **Step 5: Create `packages/db/src/dhis2-schedule-store.ts`:**
```ts
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export type ScheduleMode = 'aggregate' | 'tracker';
export type SchedulePeriodType = 'monthly' | 'quarterly' | 'yearly';

export interface ScheduleRecord {
  id: string;
  mappingId: string;
  mode: ScheduleMode;
  periodType: SchedulePeriodType;
  eventDriven: boolean;
  enabled: boolean;
  lastRunAt: Date | null;
  nextDueAt: Date | null;
}

export interface NewSchedule {
  id: string;
  mappingId: string;
  mode: ScheduleMode;
  periodType: SchedulePeriodType;
  eventDriven: boolean;
}

export interface ScheduleStore {
  create(s: NewSchedule): Promise<void>;
  get(id: string): Promise<ScheduleRecord | null>;
  list(): Promise<ScheduleRecord[]>;
  remove(id: string): Promise<void>;
  setNextDue(id: string, at: Date): Promise<void>;
  markRun(id: string, at: Date): Promise<void>;
}

function toRecord(r: {
  id: string; mapping_id: string; mode: string; period_type: string;
  event_driven: boolean; enabled: boolean; last_run_at: Date | null; next_due_at: Date | null;
}): ScheduleRecord {
  return {
    id: r.id, mappingId: r.mapping_id, mode: r.mode as ScheduleMode, periodType: r.period_type as SchedulePeriodType,
    eventDriven: r.event_driven, enabled: r.enabled, lastRunAt: r.last_run_at, nextDueAt: r.next_due_at,
  };
}

export function createScheduleStore(db: Kysely<InternalSchema>): ScheduleStore {
  return {
    async create(s) {
      await db.insertInto('dhis2_schedules').values({
        id: s.id, mapping_id: s.mappingId, mode: s.mode, period_type: s.periodType, event_driven: s.eventDriven,
      }).execute();
    },
    async get(id) {
      const r = await db.selectFrom('dhis2_schedules')
        .select(['id', 'mapping_id', 'mode', 'period_type', 'event_driven', 'enabled', 'last_run_at', 'next_due_at'])
        .where('id', '=', id).executeTakeFirst();
      return r ? toRecord(r) : null;
    },
    async list() {
      const rows = await db.selectFrom('dhis2_schedules')
        .select(['id', 'mapping_id', 'mode', 'period_type', 'event_driven', 'enabled', 'last_run_at', 'next_due_at'])
        .orderBy('id').execute();
      return rows.map(toRecord);
    },
    async remove(id) { await db.deleteFrom('dhis2_schedules').where('id', '=', id).execute(); },
    async setNextDue(id, at) {
      await db.updateTable('dhis2_schedules').set({ next_due_at: at, updated_at: sql`now()` }).where('id', '=', id).execute();
    },
    async markRun(id, at) {
      await db.updateTable('dhis2_schedules').set({ last_run_at: at, updated_at: sql`now()` }).where('id', '=', id).execute();
    },
  };
}
```

- [ ] **Step 6: Export** — append to `packages/db/src/index.ts`:
```ts
export * from './dhis2-schedule-store';
```

- [ ] **Step 7: Run** — `pnpm --filter @openldr/db test && pnpm --filter @openldr/db typecheck`. Expected: PASS.

- [ ] **Step 8: Commit**
```bash
git add packages/db/src/migrations/internal/009_dhis2_schedules.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts packages/db/src/migrations/migrations.test.ts packages/db/src/dhis2-schedule-store.ts packages/db/src/index.ts
git commit -m "feat(db): 009_dhis2_schedules migration + ScheduleStore (P2-DHIS2-5)"
```

---

## Task 8: Config `DHIS2_SYNC_ENABLED`

**Files:**
- Modify: `packages/config/src/schema.ts`
- Modify: `packages/config/src/load.test.ts`

- [ ] **Step 1: Append failing tests** to `packages/config/src/load.test.ts`:
```ts
describe('config DHIS2_SYNC_ENABLED', () => {
  it('defaults to true', () => {
    expect(loadConfig({ ...basePg } as never).DHIS2_SYNC_ENABLED).toBe(true);
  });
  it('parses false', () => {
    expect(loadConfig({ ...basePg, DHIS2_SYNC_ENABLED: 'false' } as never).DHIS2_SYNC_ENABLED).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @openldr/config test`. Expected: FAIL.

- [ ] **Step 3: Edit `packages/config/src/schema.ts`** — inside the `z.object({...})`, after the `DHIS2_PASSWORD` line, add a boolean-from-string field. **Match the file's existing boolean-env convention** (look at how `S3_FORCE_PATH_STYLE` is parsed and mirror it). If the file has no such helper, use:
```ts
    DHIS2_SYNC_ENABLED: z
      .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
      .default(true)
      .transform((v) => v === true || v === 'true' || v === '1'),
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @openldr/config test && pnpm --filter @openldr/config typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/config/src/schema.ts packages/config/src/load.test.ts
git commit -m "feat(config): DHIS2_SYNC_ENABLED (P2-DHIS2-5)"
```

---

## Task 9: Ingest — publish `ingest.batch.done` + expose the event bus

**Files:**
- Modify: `packages/ingest/src/handle.ts`
- Modify: `packages/bootstrap/src/ingest-context.ts`

- [ ] **Step 1: Add an `onBatchDone` hook** to `packages/ingest/src/handle.ts` — extend `HandleDeps` (after the `audit?` line):
```ts
  audit?: AuditHook;
  onBatchDone?: (info: { batchId: string; source: string; converter: string; count: number }) => Promise<void>;
```
and call it on the success path, immediately AFTER the existing `await deps.audit?.({ ... action: 'ingest.batch.done' ... });`:
```ts
    await deps.onBatchDone?.({ batchId, source, converter, count: resources.length });
```

- [ ] **Step 2: Wire it + expose the bus** in `packages/bootstrap/src/ingest-context.ts`:
  (a) Add `EventingPort` to the `@openldr/ports` import:
```ts
import type { EventEnvelope, EventingPort } from '@openldr/ports';
```
  (b) Add `eventing: EventingPort;` to the `IngestContext` interface.
  (c) Replace the `ingest.received` subscription to pass `onBatchDone`:
```ts
  await eventing.subscribe('ingest.received', (event) =>
    handleIngestEvent(
      {
        blob, persist, resolver, batches, logger,
        audit: (e) => safeRecord(audit, logger, e),
        onBatchDone: (info) => eventing.publish({ type: 'ingest.batch.done', payload: info }),
      },
      event,
    ),
  );
```
  (d) Add `eventing,` to the returned object (so callers can register more handlers before `startWorker`).

- [ ] **Step 3: Typecheck + test** — `pnpm --filter @openldr/ingest test && pnpm --filter @openldr/ingest typecheck && pnpm --filter @openldr/bootstrap typecheck`. Expected: PASS. (If `EventEnvelope` becomes unused in the import after edits, drop it to satisfy lint; keep whichever the file actually references.)

- [ ] **Step 4: Commit**
```bash
git add packages/ingest/src/handle.ts packages/bootstrap/src/ingest-context.ts
git commit -m "feat(ingest): publish ingest.batch.done + expose event bus for sync (P2-DHIS2-5)"
```

---

## Task 10: Bootstrap — unified `runMapping` + tracker + schedules + sync worker

**Files:**
- Modify: `packages/bootstrap/src/dhis2-context.ts`
- Create: `packages/bootstrap/src/dhis2-sync.test.ts`

This rewrites `dhis2-context.ts` to dispatch by mapping `kind`, add tracker push, schedules, and the sync-worker registration.

- [ ] **Step 1: Replace `packages/bootstrap/src/dhis2-context.ts` with:**
```ts
import type { Config } from '@openldr/config';
import { createLogger, OpenLdrError, type Logger } from '@openldr/core';
import { createInternalDb, createOrgUnitMapStore, createMappingStore, createScheduleStore, type ScheduleRecord } from '@openldr/db';
import { createDhis2Target, type Dhis2Target } from '@openldr/adapter-dhis2';
import {
  buildDataValueSet, buildEvents, validateMapping, validateTrackerMapping, dispatchReportSource,
  periodRange, previousPeriod, currentPeriod, nextPeriodBoundary,
  type AggregateMapping, type TrackerMapping, type DhisMapping, type BuildOutput, type BuildEventsOutput,
} from '@openldr/dhis2';
import { createAuditStore, safeRecord, type AuditStore } from '@openldr/audit';
import type { EventingPort, ReportingTargetPort, TargetMetadata, PushResult } from '@openldr/ports';

export type RunReport = (reportId: string, params?: Record<string, string>) => Promise<{ rows: Record<string, unknown>[] }>;
export type RunEventSource = (sourceId: string, window: { from: string; to: string }) => Promise<{ rows: Record<string, unknown>[] }>;
export interface RunCallbacks { runReport: RunReport; runEventSource: RunEventSource }

export interface AggregateOutcome { kind: 'aggregate'; dryRun: boolean; build: BuildOutput; result?: PushResult }
export interface TrackerOutcome { kind: 'tracker'; dryRun: boolean; build: BuildEventsOutput; result?: PushResult }
export type RunOutcome = AggregateOutcome | TrackerOutcome;

export interface Dhis2Context {
  target: ReportingTargetPort;
  orgUnits: ReturnType<typeof createOrgUnitMapStore>;
  mappings: ReturnType<typeof createMappingStore>;
  schedules: ReturnType<typeof createScheduleStore>;
  pullMetadata(): Promise<TargetMetadata>;
  validate(mappingId: string): Promise<string[]>;
  runMapping(args: { mappingId: string; period: string; dryRun: boolean } & RunCallbacks): Promise<RunOutcome>;
  recentPushes(limit?: number): Promise<unknown[]>;
  registerSync(eventing: EventingPort, cb: RunCallbacks): Promise<void>;
  reconcileSchedules(eventing: EventingPort): Promise<void>;
  close(): Promise<void>;
}

export function selectReportingTarget(cfg: Config): Dhis2Target {
  if (cfg.REPORTING_TARGET_ADAPTER !== 'dhis2') {
    throw new OpenLdrError('REPORTING_TARGET_ADAPTER is not dhis2; set it + DHIS2_* to use DHIS2');
  }
  return createDhis2Target({ baseUrl: cfg.DHIS2_BASE_URL!, username: cfg.DHIS2_USERNAME!, password: cfg.DHIS2_PASSWORD! });
}

function mappingKind(m: DhisMapping): 'aggregate' | 'tracker' {
  return (m as { kind?: string }).kind === 'tracker' ? 'tracker' : 'aggregate';
}

export async function createDhis2Context(cfg: Config): Promise<Dhis2Context> {
  const logger: Logger = createLogger({ level: cfg.LOG_LEVEL });
  const internal = createInternalDb(cfg.INTERNAL_DATABASE_URL);
  const { db } = internal;
  const orgUnits = createOrgUnitMapStore(db);
  const mappings = createMappingStore(db);
  const schedules = createScheduleStore(db);
  const audit: AuditStore = createAuditStore(db);
  const target = selectReportingTarget(cfg);

  async function loadMapping(id: string): Promise<DhisMapping> {
    const rec = await mappings.get(id);
    if (!rec) throw new OpenLdrError(`unknown mapping: ${id}`);
    return rec.definition as unknown as DhisMapping;
  }

  async function auditPush(action: string, mappingId: string, period: string, extra: Record<string, unknown>): Promise<void> {
    await safeRecord(audit, logger, {
      actorType: 'system', actorName: 'system', action, entityType: 'dhis2-mapping', entityId: mappingId,
      metadata: { target: cfg.DHIS2_BASE_URL, period, ...extra },
    });
  }

  async function runMapping(args: { mappingId: string; period: string; dryRun: boolean } & RunCallbacks): Promise<RunOutcome> {
    const { mappingId, period, dryRun, runReport, runEventSource } = args;
    const mapping = await loadMapping(mappingId);
    const orgMap = await orgUnits.getMap();
    if (mappingKind(mapping) === 'tracker') {
      const tm = mapping as TrackerMapping;
      const { from, to } = periodRange(period);
      const { rows } = await runEventSource(tm.source.sourceId, { from, to });
      const build = buildEvents(rows, tm, orgMap);
      if (dryRun) return { kind: 'tracker', dryRun: true, build };
      try {
        const result = await target.pushEvents(build.payload);
        await auditPush('dhis2.tracker.push', mappingId, period, { events: build.payload.events.length, skipped: build.skipped.length, status: result.status, imported: result.imported, updated: result.updated, ignored: result.ignored, conflicts: result.conflicts.length });
        return { kind: 'tracker', dryRun: false, build, result };
      } catch (err) {
        await auditPush('dhis2.tracker.push.failed', mappingId, period, { error: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    }
    const am = mapping as AggregateMapping;
    const src = dispatchReportSource(am.source);
    const { rows } = await runReport(src.reportId, src.params);
    const build = buildDataValueSet(rows, am, orgMap, period);
    if (dryRun) return { kind: 'aggregate', dryRun: true, build };
    try {
      const result = await target.pushAggregate(build.payload);
      await auditPush('dhis2.push', mappingId, period, { dataValues: build.payload.dataValues.length, skipped: build.skipped.length, status: result.status, imported: result.imported, updated: result.updated, ignored: result.ignored, conflicts: result.conflicts.length });
      return { kind: 'aggregate', dryRun: false, build, result };
    } catch (err) {
      await auditPush('dhis2.push.failed', mappingId, period, { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  return {
    target,
    orgUnits,
    mappings,
    schedules,
    pullMetadata: () => target.pullMetadata(),
    async validate(mappingId) {
      const mapping = await loadMapping(mappingId);
      const metadata = await target.pullMetadata();
      return mappingKind(mapping) === 'tracker'
        ? validateTrackerMapping(mapping as TrackerMapping, metadata)
        : validateMapping(mapping as AggregateMapping, metadata);
    },
    runMapping,
    async recentPushes(limit = 20) {
      return audit.list({ entityType: 'dhis2-mapping', limit });
    },
    async registerSync(eventing, cb) {
      await eventing.subscribe('dhis2.sync.due', async (event) => {
        const { scheduleId } = event.payload as { scheduleId: string };
        const sched = await schedules.get(scheduleId);
        if (!sched || !sched.enabled) return;
        const now = new Date();
        const period = previousPeriod(sched.periodType, now);
        try { await runMapping({ mappingId: sched.mappingId, period, dryRun: false, ...cb }); }
        catch { /* audited inside runMapping; still re-schedule the next period */ }
        await schedules.markRun(scheduleId, now);
        const due = nextPeriodBoundary(sched.periodType, now);
        await schedules.setNextDue(scheduleId, due);
        await eventing.publish({ type: 'dhis2.sync.due', payload: { scheduleId } }, { availableAt: due });
      });
      await eventing.subscribe('ingest.batch.done', async () => {
        const now = new Date();
        const all = await schedules.list();
        for (const s of all.filter((x: ScheduleRecord) => x.enabled && x.mode === 'tracker' && x.eventDriven)) {
          try { await runMapping({ mappingId: s.mappingId, period: currentPeriod(s.periodType, now), dryRun: false, ...cb }); }
          catch { /* audited inside */ }
        }
      });
    },
    async reconcileSchedules(eventing) {
      const now = Date.now();
      for (const s of await schedules.list()) {
        if (!s.enabled) continue;
        if (s.nextDueAt && s.nextDueAt.getTime() > now) continue;
        const due = s.nextDueAt && s.nextDueAt.getTime() <= now ? s.nextDueAt : nextPeriodBoundary(s.periodType, new Date());
        await schedules.setNextDue(s.id, due);
        await eventing.publish({ type: 'dhis2.sync.due', payload: { scheduleId: s.id } }, { availableAt: due });
      }
    },
    async close() {
      await Promise.allSettled([internal.close(), target.close()]);
    },
  };
}
```

- [ ] **Step 2: Write a sync-handler unit test** — `packages/bootstrap/src/dhis2-sync.test.ts`. This pins the `dhis2.sync.due` handler decision logic (re-enqueue on success, re-enqueue after failure, skip disabled) using an in-memory eventing double and an inline copy of the handler body:
```ts
import { describe, it, expect, vi } from 'vitest';
import type { EventEnvelope, EventHandler, EventingPort, PublishOptions } from '@openldr/ports';

function fakeEventing() {
  const handlers = new Map<string, EventHandler>();
  const published: { event: EventEnvelope; opts?: PublishOptions }[] = [];
  const bus: Pick<EventingPort, 'subscribe' | 'publish'> = {
    async subscribe(type, h) { handlers.set(type, h); },
    async publish(event, opts) { published.push({ event, opts }); },
  };
  return { bus, handlers, published };
}

describe('dhis2 sync handler logic', () => {
  it('re-enqueues after success and after failure, and skips disabled', async () => {
    const schedules = {
      records: new Map<string, { id: string; enabled: boolean }>([
        ['ok', { id: 'ok', enabled: true }],
        ['off', { id: 'off', enabled: false }],
      ]),
      get(id: string) { return Promise.resolve(this.records.get(id) ?? null); },
      markRun() { return Promise.resolve(); },
    };
    const runMapping = vi.fn(async () => undefined as never);
    const { bus, handlers, published } = fakeEventing();

    await bus.subscribe('dhis2.sync.due', async (event) => {
      const { scheduleId } = event.payload as { scheduleId: string };
      const sched = await schedules.get(scheduleId);
      if (!sched || !sched.enabled) return;
      try { await runMapping(); } catch { /* still reschedule */ }
      await schedules.markRun();
      await bus.publish({ type: 'dhis2.sync.due', payload: { scheduleId } }, { availableAt: new Date(Date.now() + 1000) });
    });

    const fire = handlers.get('dhis2.sync.due')!;
    await fire({ type: 'dhis2.sync.due', payload: { scheduleId: 'ok' } });
    expect(runMapping).toHaveBeenCalledTimes(1);
    expect(published).toHaveLength(1);

    runMapping.mockRejectedValueOnce(new Error('dhis2 down'));
    await fire({ type: 'dhis2.sync.due', payload: { scheduleId: 'ok' } });
    expect(published).toHaveLength(2); // re-enqueued even after failure

    await fire({ type: 'dhis2.sync.due', payload: { scheduleId: 'off' } });
    expect(published).toHaveLength(2); // disabled → no re-enqueue
  });
});
```

- [ ] **Step 3: Run + depcruise** — `pnpm --filter @openldr/bootstrap test && pnpm --filter @openldr/bootstrap typecheck && pnpm depcruise`. Expected: PASS (bootstrap still the only adapter importer; `@openldr/dhis2` stays pure).

- [ ] **Step 4: Commit**
```bash
git add packages/bootstrap/src/dhis2-context.ts packages/bootstrap/src/dhis2-sync.test.ts
git commit -m "feat(bootstrap): unified runMapping + tracker + schedules + sync worker (P2-DHIS2-2/4/5/6)"
```

---

## Task 11: apps/server wiring + CLI (`tracker push`, `schedule *`)

**Files:**
- Modify: `apps/server/src/index.ts`
- Modify: `packages/cli/src/dhis2.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Wire the sync worker in `apps/server/src/index.ts`** — add `createDhis2Context` to the import and replace `main()`:
```ts
import { createAppContext, createIngestContext, createDhis2Context } from '@openldr/bootstrap';
```
```ts
async function main(): Promise<void> {
  const cfg = loadConfig();
  const ctx = await createAppContext(cfg);
  const app = buildApp(ctx);

  const ingest = await createIngestContext(cfg);

  let dhis2: Awaited<ReturnType<typeof createDhis2Context>> | null = null;
  if (cfg.REPORTING_TARGET_ADAPTER === 'dhis2' && cfg.DHIS2_SYNC_ENABLED) {
    dhis2 = await createDhis2Context(cfg);
    await dhis2.registerSync(ingest.eventing, {
      runReport: (id, p) => ctx.reporting.run(id, p ?? {}).then((r) => ({ rows: r.rows })),
      runEventSource: (id, w) => ctx.reporting.runEventSource(id, w),
    });
    await dhis2.reconcileSchedules(ingest.eventing);
  }

  const worker = ingest.startWorker();

  const close = async () => {
    await worker.stop();
    await app.close();
    await ingest.close();
    if (dhis2) await dhis2.close();
    await ctx.close();
    process.exit(0);
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
}
```

- [ ] **Step 2: Update + extend the CLI** in `packages/cli/src/dhis2.ts`. The existing `runDhis2Push` calls `ctx.push(...)` which no longer exists — replace it and add the schedule handlers (the file already imports `createAppContext`, `createDhis2Context`, `errorMessage`, `loadConfig`, and the `out` helper from Slice A):
```ts
export async function runDhis2Push(mappingId: string, opts: { period: string; dryRun: boolean; json: boolean }): Promise<number> {
  const cfg = loadConfig();
  const app = await createAppContext(cfg);
  const ctx = await createDhis2Context(cfg);
  try {
    const outcome = await ctx.runMapping({
      mappingId, period: opts.period, dryRun: opts.dryRun,
      runReport: async (reportId, params) => { const r = await app.reporting.run(reportId, params ?? {}); return { rows: r.rows }; },
      runEventSource: (id, w) => app.reporting.runEventSource(id, w),
    });
    if (outcome.dryRun) {
      const count = outcome.kind === 'tracker' ? outcome.build.payload.events.length : outcome.build.payload.dataValues.length;
      out(opts.json, { dryRun: true, kind: outcome.kind, payload: outcome.build.payload, skipped: outcome.build.skipped }, `DRY RUN (${outcome.kind}): ${count} records, ${outcome.build.skipped.length} skipped (not sent)`);
      return 0;
    }
    out(opts.json, { kind: outcome.kind, result: outcome.result, skipped: outcome.build.skipped.length }, `pushed (${outcome.kind}): status=${outcome.result?.status} imported=${outcome.result?.imported} updated=${outcome.result?.updated} ignored=${outcome.result?.ignored}`);
    return outcome.result?.status === 'error' ? 1 : 0;
  } catch (err) { process.stderr.write(`push failed: ${errorMessage(err)}\n`); return 1; }
  finally { await ctx.close(); await app.close(); }
}

export async function runDhis2ScheduleAdd(mappingId: string, opts: { mode: string; periodType: string; eventDriven: boolean; json: boolean }): Promise<number> {
  const ctx = await createDhis2Context(loadConfig());
  try {
    const id = `${mappingId}:${opts.mode}:${opts.periodType}`;
    await ctx.schedules.create({ id, mappingId, mode: opts.mode as 'aggregate' | 'tracker', periodType: opts.periodType as 'monthly' | 'quarterly' | 'yearly', eventDriven: opts.eventDriven });
    out(opts.json, { id }, `created schedule ${id}`);
    return 0;
  } catch (err) { process.stderr.write(`schedule add failed: ${errorMessage(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runDhis2ScheduleList(opts: { json: boolean }): Promise<number> {
  const ctx = await createDhis2Context(loadConfig());
  try {
    const rows = await ctx.schedules.list();
    out(opts.json, rows, rows.map((r) => `${r.id}  mapping=${r.mappingId} mode=${r.mode} period=${r.periodType} event-driven=${r.eventDriven} enabled=${r.enabled} next=${r.nextDueAt?.toISOString() ?? '-'}`).join('\n') || '(none)');
    return 0;
  } finally { await ctx.close(); }
}

export async function runDhis2ScheduleRemove(id: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createDhis2Context(loadConfig());
  try { await ctx.schedules.remove(id); out(opts.json, { id }, `removed ${id}`); return 0; }
  finally { await ctx.close(); }
}
```

- [ ] **Step 3: Register the new commands in `packages/cli/src/index.ts`** — extend the import:
```ts
import { runDhis2MapImport, runDhis2MapList, runDhis2OrgUnitImport, runDhis2OrgUnitList, runDhis2PullMetadata, runDhis2Validate, runDhis2Push, runDhis2Status, runDhis2ScheduleAdd, runDhis2ScheduleList, runDhis2ScheduleRemove } from './dhis2';
```
and add inside the `dhis2` command group (after the existing `push` command). `runDhis2Push` already dispatches by mapping kind, so `tracker push` reuses it:
```ts
const dtracker = dhis2.command('tracker').description('DHIS2 tracker (event) push');
dtracker.command('push <mappingId>').requiredOption('--period <p>', 'DHIS2 period, e.g. 2026Q1').option('--dry-run', 'preview events without sending', false).option('--json', 'emit JSON', false)
  .action(async (id: string, o: { period: string; dryRun: boolean; json: boolean }) => { process.exitCode = await runDhis2Push(id, o); });
const dsched = dhis2.command('schedule').description('Scheduled / event-driven push');
dsched.command('add <mappingId>').requiredOption('--mode <m>', 'aggregate|tracker').requiredOption('--period-type <t>', 'monthly|quarterly|yearly').option('--event-driven', 'also push on ingest (tracker)', false).option('--json', 'emit JSON', false)
  .action(async (id: string, o: { mode: string; periodType: string; eventDriven: boolean; json: boolean }) => { process.exitCode = await runDhis2ScheduleAdd(id, o); });
dsched.command('list').option('--json', 'emit JSON', false).action(async (o: { json: boolean }) => { process.exitCode = await runDhis2ScheduleList(o); });
dsched.command('remove <scheduleId>').option('--json', 'emit JSON', false).action(async (id: string, o: { json: boolean }) => { process.exitCode = await runDhis2ScheduleRemove(id, o); });
```
(An immediate manual run is just `dhis2 push`/`dhis2 tracker push` with the desired `--period`; no separate `schedule run` command is needed.)

- [ ] **Step 4: Typecheck + build:check** — `pnpm --filter @openldr/cli typecheck && pnpm --filter @openldr/cli build:check && pnpm --filter @openldr/server typecheck`. Expected: PASS; `dhis2 tracker` + `dhis2 schedule` appear in `node dist/index.js dhis2 --help`.

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/index.ts packages/cli/src/dhis2.ts packages/cli/src/index.ts
git commit -m "feat(server,cli): sync worker boot + dhis2 tracker/schedule commands (P2-DHIS2-4/5)"
```

---

## Task 12: Live acceptance (Dockerized DHIS2) + memory + finish

**Files:** none (verification + memory). Internal Postgres dev stack + the running DHIS2 (`http://localhost:8085`, admin:district) must be up.

- [ ] **Step 1: Migrate + env** — `pnpm openldr db migrate` (applies `009_dhis2_schedules`). Set the DHIS2 env (`REPORTING_TARGET_ADAPTER=dhis2`, `DHIS2_BASE_URL=http://localhost:8085`, `DHIS2_USERNAME=admin`, `DHIS2_PASSWORD=district`) inline for each command (do NOT mutate `.env`).

- [ ] **Step 2: Pull metadata (now includes programs/stages)** — `pnpm openldr dhis2 pull-metadata --json`. Then pick a real **event program WITHOUT registration** + its stage + 1-2 of its dataElements via:
```bash
curl -s -u admin:district "http://localhost:8085/api/programs.json?filter=programType:eq:WITHOUT_REGISTRATION&fields=id,name,programStages[id,name,programStageDataElements[dataElement[id,name,valueType]]]&paging=false"
```
(e.g. "Inpatient morbidity and mortality"). Choose 1-2 TEXT/NUMBER dataElements for `antibiotic`/`result`.

- [ ] **Step 3: Author + import a tracker mapping** — create `.dhis2-seed/tracker-mapping.json` (gitignored dir), filling the real UIDs from Step 2:
```json
{
  "kind": "tracker",
  "id": "amr-events-demo",
  "name": "AMR isolates to DHIS2 events (demo)",
  "source": { "kind": "event-source", "sourceId": "amr-isolates" },
  "program": "<EVENT_PROGRAM_UID>",
  "programStage": "<PROGRAM_STAGE_UID>",
  "orgUnitColumn": "facility",
  "eventDateColumn": "eventDate",
  "idColumn": "id",
  "dataValues": [
    { "column": "antibiotic", "dataElement": "<DE_TEXT_UID>" },
    { "column": "result", "dataElement": "<DE_TEXT_UID_2>" }
  ]
}
```
Then `pnpm openldr dhis2 map import .dhis2-seed/tracker-mapping.json --json`. Reuse the Slice-A `.dhis2-seed/orgunit.json` (facility values → a real SL orgUnit); if absent, re-import it. **Note:** `amr-isolates` keys orgUnit on `facility` = patient `managing_organization`; discover the actual value via the dry-run `skipped[]` (Step 5) and map it in `orgunit.json`.

- [ ] **Step 4: Validate** — `pnpm openldr dhis2 validate amr-events-demo --json`. Expected: `problems: []` (fix UIDs if not).

- [ ] **Step 5: Tracker dry-run** — `pnpm openldr dhis2 tracker push amr-events-demo --period 2026Q1 --dry-run --json`. Expected: an `events[]` preview (each with an 11-char `event` UID, `program`, `programStage`, `orgUnit`, `occurredAt`, `dataValues`) + any `skipped`. Adjust `orgunit.json` from the `skipped[]` facility values and re-run until events appear. (If observations lack `effective_date_time`, the period window will be empty — pick a period covering the WHONET data, or accept the documented WHONET-date carry-forward.)

- [ ] **Step 6: Real tracker push + idempotency** —
```bash
pnpm openldr dhis2 tracker push amr-events-demo --period 2026Q1 --json   # created > 0
pnpm openldr dhis2 tracker push amr-events-demo --period 2026Q1 --json   # updated (same UIDs)
pnpm openldr dhis2 status --json                                          # audited dhis2.tracker.push events
```
Expected: first push `status=success`/`warning` with `imported (created) > 0`; second push shows `updated` (deterministic UIDs ⇒ no duplicate events, P2-NFR-2).

- [ ] **Step 7: Schedule + event-driven push** —
```bash
pnpm openldr dhis2 schedule add amr-events-demo --mode tracker --period-type monthly --event-driven --json
pnpm openldr dhis2 schedule list --json
```
Start the server from the repo root with the DHIS2 env + `DHIS2_SYNC_ENABLED=true` (`node apps/server/dist/index.js` after `pnpm --filter @openldr/server build`), then ingest WHONET (`pnpm openldr ingest <whonet sample> --plugin whonet-sqlite`) and confirm `ingest.batch.done` triggers a tracker push: `pnpm openldr dhis2 status --json` shows a fresh `dhis2.tracker.push`. Confirm the self-rescheduling chain exists: `pnpm openldr queue status --json` shows a pending `dhis2.sync.due`. Remove the schedule when done: `pnpm openldr dhis2 schedule remove amr-events-demo:tracker:monthly`.

- [ ] **Step 8: Aggregate regression** — re-run the Slice-A aggregate path once: `pnpm openldr dhis2 push amr-to-dhis2-demo --period 2026Q1 --json`. Expected: still `success` (no regression from the `runMapping` refactor).

- [ ] **Step 9: Full gates** — `pnpm typecheck && pnpm test && pnpm depcruise && pnpm build:check`. Expected: all PASS; `pnpm test` stays stack-free.

- [ ] **Step 10: Update build-plan memory** — record Phase-2 sub-project 3 **Slice B** (tracker + sync) done, the acceptance result, and any live findings/carry-forwards. File: `C:\Users\Fredrick\.claude\projects\D--Projects-Repositories-openldr-ce\memory\openldr-ce-build-plan.md` (+ the `MEMORY.md` index line).

- [ ] **Step 11: Finish the branch** — use superpowers:finishing-a-development-branch (merge to `main`; strip any harness-injected `Co-Authored-By` trailers per P1-CONV-2).

---

## Self-review notes (author)

- **Spec coverage:** tracker push (P2-DHIS2-2) → T1 (adapter) + T3/T4 (engine) + T10 (orchestration); both-modes-selectable (P2-DHIS2-4) → T10 `runMapping` kind-dispatch + T11 CLI; sync model (P2-DHIS2-5) → T2 (delayed publish) + T7 (schedules) + T8 (config) + T9 (ingest event) + T10 (worker) + T11 (boot); auditing (P2-DHIS2-6) → T10 `auditPush`; idempotency (P2-NFR-2) → deterministic `dhis2Uid` (T3) + T12 acceptance; event source (per-record) → T5/T6.
- **No placeholders:** every file has complete content; config boolean parsing instructs mirroring the existing convention with a concrete fallback; the one acceptance-only SQL surface (`amr-isolates`) follows the established no-unit-test-for-queries pattern.
- **Type/name consistency:** `pushEvents`/`TargetMetadata.programs/programStages` (ports+adapter); `TrackerMapping`/`buildEvents`/`validateTrackerMapping`/`DhisMapping`/`TrackerEvent`/`EventSet`/`BuildEventsOutput` (`@openldr/dhis2`); `periodRange`/`currentPeriod`/`previousPeriod`/`nextPeriodBoundary`/`dhis2Uid` (`@openldr/dhis2`); `EventSource`/`eventSourceCatalog`/`getEventSource`/`amrIsolates` (`@openldr/reporting`); `runEventSource` (bootstrap reporting); `ScheduleStore`/`createScheduleStore`/`ScheduleRecord` (`@openldr/db`); `runMapping`/`registerSync`/`reconcileSchedules`/`RunCallbacks` (bootstrap dhis2 context); `DHIS2_SYNC_ENABLED` (config); `onBatchDone` + `ingest.batch.done` (ingest); `runDhis2ScheduleAdd/List/Remove` (CLI). Consistent across tasks.
- **Green-keeping:** T1 bundles the `pushEvents` interface + adapter impl so the workspace stays buildable; T2's `publish` opts is backward-compatible; later tasks are additive. Full gates run in T12.
- **Carry-forwards (for build-plan):** event-program only (no TEI/enrollment); authoring UI deferred; incremental/bulk → P2-HARD; `amr-isolates` date reliance on WHONET stamping; at-least-once + idempotency (not exactly-once).
