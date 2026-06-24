# DHIS2 Sink Plugin — SP-4: Host Rewiring (connector-backed target) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the host-side DHIS2 sink implementation from the HTTP `@openldr/adapter-dhis2` package to a **connector-resolved wasm sink** (load connector → decrypt config → `loadSink` → bind `{config, allowedHosts}` → invoke). Change `ReportingTargetPort.pushAggregate`/`pushEvents` to pass `{rows, mapping, orgUnitMap, period, dryRun}` (the wasm does the mapping). Delete `@openldr/adapter-dhis2`, shrink `@openldr/dhis2` to host-only helpers, remove the `DHIS2_*` connection env vars, and thread a `connectorId` (stored in the mapping definition).

**Architecture:** The `ReportingTargetPort` stays the host-side seam (routes/sync/ops/workflow node keep calling `runMapping`/the port above it). Only the *implementation* changes: a new `createPluginTarget(sink, config, allowedHost)` wraps a `WasmSink` (SP-1) as a `ReportingTargetPort`, and `dhis2-context.runMapping` resolves the mapping's `connectorId` → the connector store (SP-3) → `getDecryptedConfig` → `loadSink` (SP-1) → bound target, per call. Dry-run goes through the sink with no `allowedHosts` (mapping preview, no egress); a real push pins `[connector.allowedHost]` → the worker-path HTTP egress (the egress fix). The sink's `{payload, skipped, result?}` output is mapped back into the existing `RunOutcome.build` shape so routes + web are unchanged.

**Tech Stack:** TypeScript, Kysely/Postgres, Fastify, vitest. Builds on SP-1 (`WasmSink`/`loadSink`), SP-2 (`wasm/dhis2-sink`), SP-3 (`createConnectorStore`/crypto), and the merged worker-path egress.

---

## Context for the implementer (read first)

This is **SP-4 of 6**, the workstream's most invasive step. Design: `docs/superpowers/specs/2026-06-23-dhis2-sink-plugin-connectors-design.md` (§L4). SP-1/2/3 + the egress fix are merged. **Locked decisions (user-confirmed):** keep a *slimmed* `@openldr/dhis2` (host helpers stay; don't fold into bootstrap); **remove** the `DHIS2_BASE_URL/USERNAME/PASSWORD` env vars (connection lives only in connectors); keep `REPORTING_TARGET_ADAPTER='dhis2'` as the on/off gate for wiring DHIS2.

**Coupling note (important):** removing the `DHIS2_*` config vars + changing the port signature breaks references across `@openldr/ports`, `@openldr/adapter-dhis2` (deleted), `@openldr/bootstrap`, `@openldr/config`, `apps/server` *simultaneously*. The full `pnpm typecheck` is therefore only green after the whole seam swap (Task 2) lands. **Task 1** (the `@openldr/dhis2` shrink) is independently green; **Task 2** is one atomic change verified by `pnpm typecheck && pnpm test` at its end; **Task 3** is the final whole-repo gate.

**Key existing facts (already verified — don't re-derive):**
- `WasmSink.invoke(entrypoint, input, { config, allowedHosts })` returns the parsed JSON (SP-1, `packages/plugins/src/wasm-sink.ts`).
- `PluginRuntime.loadSink(id, version?) => Promise<WasmSink | undefined>` (SP-1); reachable in apps/server as `ctx.plugins.loadSink`.
- `createConnectorStore(db)` → `get/list/getDecryptedConfig(id, key)/...`; `ConnectorRecord` = `{id,name,pluginId,kind,allowedHost,enabled,createdAt,updatedAt}` (SP-3, `packages/db/src/connector-store.ts`).
- `cfg.SECRETS_ENCRYPTION_KEY: string | undefined` (SP-3).
- `dhis2-sink` manifest: `pluginId='dhis2-sink'`, entrypoints `health_check`/`pull_metadata`/`push_aggregate`/`push_tracker`; its push input is `{rows, mapping, orgUnitMap, period, dryRun}`, output `{payload, skipped, result?}` (SP-2). Rust serde ignores unknown mapping fields, so passing the full `AggregateMapping`/`TrackerMapping` is fine.
- `HealthResult` = `{ status: 'up'|'down'|'degraded'; latencyMs: number; detail?: string }` (`packages/ports/src/health.ts`). Use `probe()` from `@openldr/core` to produce it.
- The wasm egress worker path triggers when `allowedHosts` is non-empty — so dry-run (empty) = no egress, real push (pinned host) = egress. Already merged + proven.

---

## File Structure

**Created:**
- `packages/bootstrap/src/connector-target.ts` — `createPluginTarget(sink, config, allowedHost)` → `ReportingTargetPort`.
- `packages/bootstrap/src/dhis2-context.test.ts` — context test with a mocked `loadSink` + in-memory connector.

**Modified:**
- `packages/ports/src/reporting-target.ts` — new `pushAggregate`/`pushEvents` signatures + `TargetPushArgs`/`TargetPushResult`.
- `packages/dhis2/src/mapping.ts` — drop `buildDataValueSet` (keep `dispatchReportSource`).
- `packages/dhis2/src/tracker.ts` — drop `buildEvents` (keep `validateTrackerMapping`).
- `packages/dhis2/src/mapping.test.ts` / `tracker.test.ts` — drop the deleted-fn tests.
- `packages/dhis2/src/types.ts` — add optional `connectorId` to `AggregateMapping` + `TrackerMapping`.
- `packages/dhis2/src/index.ts` — drop the `uid` re-export.
- `packages/bootstrap/src/dhis2-context.ts` — full rewrite (connector resolution).
- `packages/config/src/schema.ts` — remove `DHIS2_*` vars + their validation.
- `packages/config/src/load.test.ts` — update the dhis2 config tests.
- `apps/server/src/index.ts` — pass `{ loadSink }` into `createDhis2Context`.
- `apps/server/src/dhis2-routes.ts` — `configured` from adapter only; `host` from default connector; `dhis2.healthCheck()`.
- `apps/server/src/dhis2-routes.test.ts` — fixture + fake-context updates.
- `apps/web/src/i18n/en.ts` — update `notConfiguredHelp` text.
- `packages/bootstrap/package.json` + `tsconfig.depcruise.json` — drop `@openldr/adapter-dhis2`.

**Deleted:**
- `packages/dhis2/src/uid.ts` + `packages/dhis2/src/uid.test.ts`.
- `packages/adapter-dhis2/` (whole package).

---

## Task 1: Shrink `@openldr/dhis2` to host helpers (independently green)

The mapping/tracker/uid builders are now in the Rust plugin (SP-2). Delete the duplicates; keep the host-only helpers (`dispatchReportSource`, `validateMapping`, `validateTrackerMapping`, period math, types). Add `connectorId` to the mapping types.

**Files:** Modify `packages/dhis2/src/{mapping.ts,tracker.ts,mapping.test.ts,tracker.test.ts,types.ts,index.ts}`; Delete `packages/dhis2/src/uid.ts` + `uid.test.ts`.

- [ ] **Step 1: Trim `mapping.ts` to just `dispatchReportSource`**

Replace the entire contents of `packages/dhis2/src/mapping.ts` with:

```ts
import { OpenLdrError } from '@openldr/core';
import type { MappingSource } from './types';

export function dispatchReportSource(source: MappingSource): { reportId: string; params?: Record<string, string> } {
  if (source.kind !== 'report') {
    throw new OpenLdrError(`unsupported mapping source kind '${(source as { kind: string }).kind}' (Slice A supports 'report')`);
  }
  return { reportId: source.reportId, params: source.params };
}
```

(`buildDataValueSet` + its `isEmpty`/`DataValue`/`SkipRecord`/`AggregateMapping`/`BuildOutput` imports are removed — they live in the wasm plugin now.)

- [ ] **Step 2: Trim `tracker.ts` to just `validateTrackerMapping`**

Replace the entire contents of `packages/dhis2/src/tracker.ts` with:

```ts
import type { TargetMetadata } from '@openldr/ports';
import type { TrackerMapping } from './types';

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

(`buildEvents` + its `dhis2Uid`/`isEmpty`/`TrackerEvent`/`BuildEventsOutput` imports are removed.)

- [ ] **Step 3: Delete the uid module + test**

```bash
git rm packages/dhis2/src/uid.ts packages/dhis2/src/uid.test.ts
```

- [ ] **Step 4: Drop the uid re-export from the barrel**

In `packages/dhis2/src/index.ts`, delete the line `export * from './uid';`. The file becomes:

```ts
export * from './types';
export * from './mapping';
export * from './validate';
export * from './period';
export * from './tracker';
```

- [ ] **Step 5: Add `connectorId` to the mapping types**

In `packages/dhis2/src/types.ts`, add `connectorId?: string;` to BOTH `AggregateMapping` (after `columns: ColumnMapping[];`) and `TrackerMapping` (after `dataValues: TrackerColumnMapping[];`):

```ts
export interface AggregateMapping {
  kind?: 'aggregate';
  id: string;
  name: string;
  source: MappingSource;
  orgUnitColumn: string;
  periodColumn?: string;
  columns: ColumnMapping[];
  /** Which connector (sink plugin + sealed credentials) this mapping pushes through. */
  connectorId?: string;
}
```

```ts
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
  /** Which connector (sink plugin + sealed credentials) this mapping pushes through. */
  connectorId?: string;
}
```

(Leave `BuildOutput`, `BuildEventsOutput`, `DataValue`, `TrackerEvent`, etc. in `types.ts` — `dhis2-context` still uses `BuildOutput`/`BuildEventsOutput` for the `RunOutcome` shape.)

- [ ] **Step 6: Trim the tests**

In `packages/dhis2/src/mapping.test.ts`: remove the `import` of `buildDataValueSet` (keep `dispatchReportSource`) and delete the entire `describe('buildDataValueSet', ...)` block. Keep the `describe('dispatchReportSource', ...)` block. The `AggregateMapping` fixture + the `import type { AggregateMapping }` stay (used by `dispatchReportSource` test via `mapping.source`).

In `packages/dhis2/src/tracker.test.ts`: remove the `import` of `buildEvents` (keep `validateTrackerMapping`) and delete the entire `describe('buildEvents', ...)` block. Keep `describe('validateTrackerMapping', ...)`. Keep the `TrackerMapping`/`TargetMetadata` imports + the `mapping` fixture.

- [ ] **Step 7: Verify the package is green on its own**

Run: `pnpm -C packages/dhis2 typecheck && pnpm -C packages/dhis2 test`
Expected: PASS. (`@openldr/dhis2` doesn't import the port methods being changed, so it's green independently. Downstream `@openldr/bootstrap` won't typecheck yet — that's Task 2.)

- [ ] **Step 8: Commit**

```bash
git add packages/dhis2/src
git commit -m "$(cat <<'EOF'
refactor(dhis2): shrink to host helpers — mapping/uid builders moved to wasm

Deletes buildDataValueSet/buildEvents/dhis2Uid (now in wasm/dhis2-sink); keeps
dispatchReportSource/validateMapping/validateTrackerMapping/period + types. Adds
optional connectorId to the mapping types.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: The seam swap (atomic — port + connector target + context + config + delete adapter + server)

This is one coherent change: every edit below must land together for the repo to typecheck. Implement all of it, then run the full gate at the end of the task.

**Files:** as listed in each step.

- [ ] **Step 1: Change the port signature** — `packages/ports/src/reporting-target.ts`

Replace the file with:

```ts
import type { HealthResult } from './health';

export interface TargetMetadata {
  dataElements: { id: string; name: string }[];
  orgUnits: { id: string; name: string }[];
  categoryOptionCombos: { id: string; name: string }[];
  programs?: { id: string; name: string }[];
  programStages?: { id: string; name: string; program: string }[];
}

export interface PushResult {
  status: 'success' | 'warning' | 'error';
  imported: number;
  updated: number;
  ignored: number;
  deleted: number;
  conflicts: { object: string; value: string }[];
  raw: unknown;
}

/** Inputs the host hands a sink target per push. The sink (wasm plugin) owns the
 *  mapping, so `mapping` is opaque here (keeps the port connector-generic). */
export interface TargetPushArgs {
  rows: Record<string, unknown>[];
  mapping: unknown;
  orgUnitMap: Record<string, string>;
  period: string;
  dryRun: boolean;
}

/** Sink output: the mapped payload preview (always) + the import result (live only). */
export interface TargetPushResult {
  payload: unknown;
  skipped: { row: number; reason: string }[];
  result?: PushResult;
}

// Generic external-reporting-target seam (DHIS2 now; GLASS/FHIR targets reuse it).
export interface ReportingTargetPort {
  healthCheck(): Promise<HealthResult>;
  pullMetadata(): Promise<TargetMetadata>;
  pushAggregate(args: TargetPushArgs): Promise<TargetPushResult>;
  pushEvents(args: TargetPushArgs): Promise<TargetPushResult>;
}
```

- [ ] **Step 2: Create the plugin-backed target** — `packages/bootstrap/src/connector-target.ts`

```ts
import { probe } from '@openldr/core';
import type { WasmSink } from '@openldr/plugins';
import type { ReportingTargetPort, TargetMetadata, TargetPushArgs, TargetPushResult } from '@openldr/ports';

/** Wrap a loaded sink plugin as a ReportingTargetPort bound to one connector's
 *  decrypted config + pinned egress host. Dry-runs pin no host (no egress); real
 *  pushes pin [allowedHost] → the runner's worker-path HTTP egress. */
export function createPluginTarget(
  sink: WasmSink,
  config: Record<string, string>,
  allowedHost: string | null,
): ReportingTargetPort {
  const hosts = allowedHost ? [allowedHost] : [];
  return {
    async healthCheck() {
      return probe(async () => {
        const out = (await sink.invoke('health_check', {}, { config, allowedHosts: hosts })) as { ok?: boolean; error?: string };
        if (!out.ok) throw new Error(out.error ?? 'health check returned not-ok');
      });
    },
    async pullMetadata() {
      return (await sink.invoke('pull_metadata', {}, { config, allowedHosts: hosts })) as TargetMetadata;
    },
    async pushAggregate({ rows, mapping, orgUnitMap, period, dryRun }: TargetPushArgs) {
      const input = { rows, mapping, orgUnitMap, period, dryRun };
      return (await sink.invoke('push_aggregate', input, { config, allowedHosts: dryRun ? [] : hosts })) as TargetPushResult;
    },
    async pushEvents({ rows, mapping, orgUnitMap, period, dryRun }: TargetPushArgs) {
      const input = { rows, mapping, orgUnitMap, period, dryRun };
      return (await sink.invoke('push_tracker', input, { config, allowedHosts: dryRun ? [] : hosts })) as TargetPushResult;
    },
  };
}
```

- [ ] **Step 3: Rewrite `dhis2-context.ts`** — `packages/bootstrap/src/dhis2-context.ts`

Replace the file with:

```ts
import type { Config } from '@openldr/config';
import { createLogger, OpenLdrError, type Logger } from '@openldr/core';
import {
  createInternalDb, createOrgUnitMapStore, createMappingStore, createScheduleStore,
  createDhis2MetadataCache, createConnectorStore, type ScheduleRecord, type ConnectorRecord,
} from '@openldr/db';
import {
  validateMapping, validateTrackerMapping, dispatchReportSource,
  periodRange, previousPeriod, currentPeriod, nextPeriodBoundary,
  type AggregateMapping, type TrackerMapping, type DhisMapping, type BuildOutput, type BuildEventsOutput,
} from '@openldr/dhis2';
import { createAuditStore, safeRecord, type AuditStore } from '@openldr/audit';
import type { WasmSink } from '@openldr/plugins';
import type { EventingPort, ReportingTargetPort, TargetMetadata, PushResult, DataValue, TrackerEvent } from '@openldr/ports';
import { createPluginTarget } from './connector-target';

export type RunReport = (reportId: string, params?: Record<string, string>) => Promise<{ rows: Record<string, unknown>[] }>;
export type RunEventSource = (sourceId: string, window: { from: string; to: string }) => Promise<{ rows: Record<string, unknown>[] }>;
export interface RunCallbacks { runReport: RunReport; runEventSource: RunEventSource }

export interface AggregateOutcome { kind: 'aggregate'; dryRun: boolean; build: BuildOutput; result?: PushResult }
export interface TrackerOutcome { kind: 'tracker'; dryRun: boolean; build: BuildEventsOutput; result?: PushResult }
export type RunOutcome = AggregateOutcome | TrackerOutcome;

/** Injected so the context can resolve a connector → its sink plugin. */
export interface Dhis2ContextDeps {
  loadSink: (id: string, version?: string) => Promise<WasmSink | undefined>;
}

export interface Dhis2Context {
  orgUnits: ReturnType<typeof createOrgUnitMapStore>;
  mappings: ReturnType<typeof createMappingStore>;
  schedules: ReturnType<typeof createScheduleStore>;
  metadataCache: ReturnType<typeof createDhis2MetadataCache>;
  connectors: ReturnType<typeof createConnectorStore>;
  healthCheck(): Promise<import('@openldr/ports').HealthResult>;
  defaultConnector(): Promise<ConnectorRecord | null>;
  pullMetadata(): Promise<TargetMetadata>;
  validate(mappingId: string): Promise<string[]>;
  runMapping(args: { mappingId: string; period: string; dryRun: boolean; trigger?: string } & RunCallbacks): Promise<RunOutcome>;
  recentPushes(limit?: number): Promise<unknown[]>;
  registerSync(eventing: EventingPort, cb: RunCallbacks): Promise<void>;
  reconcileSchedules(eventing: EventingPort): Promise<void>;
  close(): Promise<void>;
}

function mappingKind(m: DhisMapping): 'aggregate' | 'tracker' {
  return (m as { kind?: string }).kind === 'tracker' ? 'tracker' : 'aggregate';
}

export async function createDhis2Context(cfg: Config, deps: Dhis2ContextDeps): Promise<Dhis2Context> {
  const logger: Logger = createLogger({ level: cfg.LOG_LEVEL });
  const internal = createInternalDb(cfg.INTERNAL_DATABASE_URL);
  const { db } = internal;
  const orgUnits = createOrgUnitMapStore(db);
  const mappings = createMappingStore(db);
  const schedules = createScheduleStore(db);
  const metadataCache = createDhis2MetadataCache(db);
  const connectors = createConnectorStore(db);
  const audit: AuditStore = createAuditStore(db);

  async function loadMapping(id: string): Promise<DhisMapping> {
    const rec = await mappings.get(id);
    if (!rec) throw new OpenLdrError(`unknown mapping: ${id}`);
    return rec.definition as unknown as DhisMapping;
  }

  /** Resolve a connector id → a sink-backed target bound to its decrypted config + host. */
  async function resolveTarget(connectorId: string): Promise<{ target: ReportingTargetPort; connector: ConnectorRecord }> {
    const connector = await connectors.get(connectorId);
    if (!connector) throw new OpenLdrError(`connector ${connectorId} not found`);
    if (!connector.enabled) throw new OpenLdrError(`connector ${connectorId} is disabled`);
    const config = await connectors.getDecryptedConfig(connectorId, cfg.SECRETS_ENCRYPTION_KEY);
    const sink = await deps.loadSink(connector.pluginId);
    if (!sink) throw new OpenLdrError(`sink plugin '${connector.pluginId}' for connector ${connectorId} is not installed`);
    return { target: createPluginTarget(sink, config, connector.allowedHost), connector };
  }

  /** The connector used by connector-agnostic ops (status, metadata, validate) until
   *  SP-5 adds explicit selection: the first enabled connector. */
  async function defaultConnector(): Promise<ConnectorRecord | null> {
    const all = await connectors.list();
    return all.find((c) => c.enabled) ?? null;
  }
  async function defaultTarget(): Promise<ReportingTargetPort> {
    const c = await defaultConnector();
    if (!c) throw new OpenLdrError('no enabled connector is configured');
    return (await resolveTarget(c.id)).target;
  }

  function connectorIdOf(m: DhisMapping): string {
    const id = (m as { connectorId?: string }).connectorId;
    if (!id) throw new OpenLdrError(`mapping has no connector configured (set connectorId)`);
    return id;
  }

  async function auditPush(action: string, mappingId: string, period: string, extra: Record<string, unknown>): Promise<void> {
    await safeRecord(audit, logger, {
      actorType: 'system', actorName: 'system', action, entityType: 'dhis2-mapping', entityId: mappingId,
      metadata: { period, ...extra },
    });
  }

  async function runMapping(args: { mappingId: string; period: string; dryRun: boolean; trigger?: string } & RunCallbacks): Promise<RunOutcome> {
    const { mappingId, period, dryRun, runReport, runEventSource, trigger = 'manual' } = args;
    const mapping = await loadMapping(mappingId);
    const orgMapM = await orgUnits.getMap();
    const orgUnitMap = Object.fromEntries(orgMapM); // wasm expects a plain object
    const { target, connector } = await resolveTarget(connectorIdOf(mapping));

    if (mappingKind(mapping) === 'tracker') {
      const tm = mapping as TrackerMapping;
      const { from, to } = periodRange(period);
      const { rows } = await runEventSource(tm.source.sourceId, { from, to });
      try {
        const out = await target.pushEvents({ rows, mapping: tm, orgUnitMap, period, dryRun });
        const build: BuildEventsOutput = { payload: out.payload as { events: TrackerEvent[] }, skipped: out.skipped };
        if (dryRun) return { kind: 'tracker', dryRun: true, build };
        const result = out.result!;
        await auditPush('dhis2.tracker.push', mappingId, period, { trigger, connector: connector.id, events: build.payload.events.length, skipped: build.skipped.length, status: result.status, imported: result.imported, updated: result.updated, ignored: result.ignored, conflicts: result.conflicts.length });
        return { kind: 'tracker', dryRun: false, build, result };
      } catch (err) {
        if (!dryRun) await auditPush('dhis2.tracker.push.failed', mappingId, period, { trigger, connector: connector.id, error: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    }

    const am = mapping as AggregateMapping;
    const src = dispatchReportSource(am.source);
    const { rows } = await runReport(src.reportId, src.params);
    try {
      const out = await target.pushAggregate({ rows, mapping: am, orgUnitMap, period, dryRun });
      const build: BuildOutput = { payload: out.payload as { dataValues: DataValue[] }, skipped: out.skipped };
      if (dryRun) return { kind: 'aggregate', dryRun: true, build };
      const result = out.result!;
      await auditPush('dhis2.push', mappingId, period, { trigger, connector: connector.id, dataValues: build.payload.dataValues.length, skipped: build.skipped.length, status: result.status, imported: result.imported, updated: result.updated, ignored: result.ignored, conflicts: result.conflicts.length });
      return { kind: 'aggregate', dryRun: false, build, result };
    } catch (err) {
      if (!dryRun) await auditPush('dhis2.push.failed', mappingId, period, { trigger, connector: connector.id, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  return {
    orgUnits, mappings, schedules, metadataCache, connectors,
    healthCheck: async () => (await defaultTarget()).healthCheck(),
    defaultConnector,
    pullMetadata: async () => (await defaultTarget()).pullMetadata(),
    async validate(mappingId) {
      const mapping = await loadMapping(mappingId);
      const metadata = await (await defaultTarget()).pullMetadata();
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
        try { await runMapping({ mappingId: sched.mappingId, period, dryRun: false, trigger: 'scheduled', ...cb }); }
        catch (err) { logger.error({ err, scheduleId, mappingId: sched.mappingId, period }, 'dhis2 scheduled sync failed'); }
        await schedules.markRun(scheduleId, now);
        const due = nextPeriodBoundary(sched.periodType, now);
        await schedules.setNextDue(scheduleId, due);
        await eventing.publish({ type: 'dhis2.sync.due', payload: { scheduleId } }, { availableAt: due });
      });
      await eventing.subscribe('ingest.batch.done', async () => {
        const now = new Date();
        const all = await schedules.list();
        for (const s of all.filter((x: ScheduleRecord) => x.enabled && x.mode === 'tracker' && x.eventDriven)) {
          try { await runMapping({ mappingId: s.mappingId, period: currentPeriod(s.periodType, now), dryRun: false, trigger: 'ingest-event', ...cb }); }
          catch (err) { logger.error({ err, scheduleId: s.id, mappingId: s.mappingId }, 'dhis2 ingest-driven tracker push failed'); }
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
      await internal.close();
    },
  };
}
```

Notes: `DataValue`/`TrackerEvent` are re-exported by `@openldr/ports`? They are NOT — they live in `@openldr/dhis2` types. Import them from `@openldr/dhis2` instead. **Correction:** change the `@openldr/ports` import to drop `DataValue, TrackerEvent`, and add them to the `@openldr/dhis2` import:
```ts
import { /* …existing… */ type BuildOutput, type BuildEventsOutput, type DataValue, type TrackerEvent } from '@openldr/dhis2';
import type { EventingPort, ReportingTargetPort, TargetMetadata, PushResult } from '@openldr/ports';
```

- [ ] **Step 4: Remove the `DHIS2_*` config vars** — `packages/config/src/schema.ts`

Delete the three lines (currently 48-50):
```ts
    DHIS2_BASE_URL: z.string().url().optional(),
    DHIS2_USERNAME: z.string().min(1).optional(),
    DHIS2_PASSWORD: z.string().min(1).optional(),
```
Keep `DHIS2_SYNC_ENABLED`. Then delete the validation block in the `superRefine` (currently ~112-116):
```ts
    if (cfg.REPORTING_TARGET_ADAPTER === 'dhis2') {
      for (const key of ['DHIS2_BASE_URL', 'DHIS2_USERNAME', 'DHIS2_PASSWORD'] as const) {
        if (!cfg[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when REPORTING_TARGET_ADAPTER=dhis2` });
      }
    }
```

- [ ] **Step 5: Update `config/src/load.test.ts`**

Replace the `describe('config reporting-target (dhis2)', ...)` block (the "accepts a dhis2 config" + "rejects dhis2 without connection fields" tests) with:

```ts
describe('config reporting-target (dhis2)', () => {
  it('defaults REPORTING_TARGET_ADAPTER to none', () => {
    expect(loadConfig({ ...basePg } as never).REPORTING_TARGET_ADAPTER).toBe('none');
  });
  it('accepts a dhis2 adapter without connection env vars (connection lives in connectors)', () => {
    const cfg = loadConfig({ ...basePg, REPORTING_TARGET_ADAPTER: 'dhis2' } as never);
    expect(cfg.REPORTING_TARGET_ADAPTER).toBe('dhis2');
  });
});
```

- [ ] **Step 6: Wire `loadSink` into the server** — `apps/server/src/index.ts`

Change the DHIS2 context creation (currently line 50) from `dhis2 = await createDhis2Context(cfg);` to:

```ts
    dhis2 = await createDhis2Context(cfg, { loadSink: (id, version) => ctx.plugins.loadSink(id, version) });
```

- [ ] **Step 7: Update `dhis2-routes.ts`**

In `apps/server/src/dhis2-routes.ts`:

(a) `configured` (line ~59-60) — drop the `DHIS2_*` checks:
```ts
  const configured = cfg.REPORTING_TARGET_ADAPTER === 'dhis2';
```

(b) The status handler `base` (line ~67) — source the host from the default connector, not the removed env var:
```ts
  app.get('/api/dhis2/status', { preHandler: requireRole('lab_admin') }, async () => {
    const connector = configured && dhis2 ? await dhis2.defaultConnector() : null;
    const base = { configured, syncEnabled: cfg.DHIS2_SYNC_ENABLED, host: connector?.allowedHost ?? null };
    if (!configured || !dhis2) {
      return { ...base, reachable: null, counts: null, recentPushes: [] };
    }
    let reachable;
    try {
      reachable = await dhis2.healthCheck();
    } catch (e) {
      reachable = { status: 'down' as const, latencyMs: 0, detail: redact(e instanceof Error ? e.message : String(e)) };
    }
    // …rest unchanged (mappings/orgUnits/schedules lists + recentPushes + return)…
  });
```
(Leave the `hostOf` helper import if still used elsewhere; if `hostOf` becomes unused, remove it + its import to satisfy lint/typecheck.)

(c) The `/api/dhis2/metadata/pull` handler uses `dhis2.pullMetadata()` (unchanged). Confirm it still compiles (it does — `pullMetadata()` is still a context method).

- [ ] **Step 8: Update `dhis2-routes.test.ts`**

In `apps/server/src/dhis2-routes.test.ts`:
- `configuredCfg`: remove `DHIS2_BASE_URL/USERNAME/PASSWORD` (keep `REPORTING_TARGET_ADAPTER: 'dhis2'` + `DHIS2_SYNC_ENABLED: true`).
- `fakeDhis2`: replace `target: { healthCheck: async () => ({ status: 'up' as const, latencyMs: 12 }) }` with a top-level `healthCheck: async () => ({ status: 'up' as const, latencyMs: 12 })`, and add `defaultConnector: async () => ({ id: 'c1', name: 'Demo', pluginId: 'dhis2-sink', kind: 'sink', allowedHost: 'play.dhis2.example', enabled: true, createdAt: new Date(), updatedAt: new Date() })`.
- If any assertion checks `body.host` equals the old env-derived host, update it to the connector's `allowedHost` (`'play.dhis2.example'`) or `null` per the fake. Read the status-route assertions in this test and adjust to match `host: connector?.allowedHost ?? null`.

- [ ] **Step 9: Delete `@openldr/adapter-dhis2`**

```bash
git rm -r packages/adapter-dhis2
```
Remove the dependency line `"@openldr/adapter-dhis2": "workspace:*",` from `packages/bootstrap/package.json`. Remove the `"@openldr/adapter-dhis2": ["packages/adapter-dhis2/src/index.ts"]` path entry from `tsconfig.depcruise.json`. Run `pnpm install` to refresh the workspace lockfile.

- [ ] **Step 10: Update the i18n help text** — `apps/web/src/i18n/en.ts`

Change the `notConfiguredHelp` string (line ~134) to:
```ts
    notConfiguredHelp: 'Set REPORTING_TARGET_ADAPTER=dhis2 on the server, then create a DHIS2 Connector (Settings ▸ Connectors) with the base URL + credentials to enable DHIS2.',
```
(The `fr.ts`/`pt.ts` equivalents still reference the old env vars — update them analogously if straightforward, otherwise note them as a deferred i18n follow-up; do not block on translation wording.)

- [ ] **Step 11: Create the context test** — `packages/bootstrap/src/dhis2-context.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { createPluginTarget } from './connector-target';

const enc = (o: unknown) => o;

describe('createPluginTarget', () => {
  function fakeSink(outputs: Record<string, unknown>) {
    return {
      id: 'dhis2-sink', version: '0.1.0',
      entrypoints: ['health_check', 'pull_metadata', 'push_aggregate', 'push_tracker'],
      invoke: vi.fn(async (ep: string) => outputs[ep]),
    };
  }

  it('pushAggregate dry-run pins no host (no egress)', async () => {
    const sink = fakeSink({ push_aggregate: { payload: { dataValues: [] }, skipped: [] } });
    const t = createPluginTarget(sink as never, { baseUrl: 'https://x' }, 'x.example');
    const out = await t.pushAggregate({ rows: [], mapping: {}, orgUnitMap: {}, period: '2026Q1', dryRun: true });
    expect(out).toEqual({ payload: { dataValues: [] }, skipped: [] });
    expect(sink.invoke).toHaveBeenCalledWith('push_aggregate', expect.objectContaining({ dryRun: true }), { config: { baseUrl: 'https://x' }, allowedHosts: [] });
  });

  it('pushAggregate real push pins [allowedHost]', async () => {
    const sink = fakeSink({ push_aggregate: { payload: { dataValues: [] }, skipped: [], result: { status: 'success', imported: 1, updated: 0, ignored: 0, deleted: 0, conflicts: [], raw: {} } } });
    const t = createPluginTarget(sink as never, { baseUrl: 'https://x' }, 'x.example');
    const out = await t.pushAggregate({ rows: [], mapping: {}, orgUnitMap: {}, period: '2026Q1', dryRun: false });
    expect(out.result?.imported).toBe(1);
    expect(sink.invoke).toHaveBeenCalledWith('push_aggregate', expect.objectContaining({ dryRun: false }), { config: { baseUrl: 'https://x' }, allowedHosts: ['x.example'] });
  });

  it('healthCheck maps ok:false to a down HealthResult', async () => {
    const sink = fakeSink({ health_check: { ok: false, error: 'boom' } });
    const t = createPluginTarget(sink as never, {}, null);
    const h = await t.healthCheck();
    expect(h.status).toBe('down');
    expect(h.detail).toContain('boom');
  });

  it('healthCheck maps ok:true to up', async () => {
    const sink = fakeSink({ health_check: { ok: true, version: '2.40' } });
    const t = createPluginTarget(sink as never, {}, null);
    expect((await t.healthCheck()).status).toBe('up');
  });
});

void enc;
```

- [ ] **Step 12: Full gate (this task only goes green here)**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS across the workspace. Fix any straggler reference to `DHIS2_BASE_URL/USERNAME/PASSWORD`, `adapter-dhis2`, `.target` on the dhis2 context, or the old port signature that the compiler flags. Re-run `pnpm -C apps/web test` in isolation if `@openldr/web#test` flakes.

- [ ] **Step 13: depcruise + commit**

Run: `pnpm depcruise` → clean (the `adapter-dhis2` node is gone; `@openldr/bootstrap` no longer depends on it; bootstrap → plugins/db/dhis2/ports edges already exist).

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(dhis2): connector-resolved wasm sink target (delete adapter-dhis2)

ReportingTargetPort.pushAggregate/pushEvents now take {rows,mapping,orgUnitMap,
period,dryRun} and return {payload,skipped,result?}; createPluginTarget wraps a
WasmSink bound to a connector's decrypted config + pinned host. runMapping resolves
the mapping's connectorId per call (decrypt → loadSink → invoke); dry-run pins no
host (no egress), real push pins [allowedHost]. Removes the DHIS2_* env vars
(connection lives in connectors) and deletes @openldr/adapter-dhis2.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Final gate

**Files:** none.

- [ ] **Step 1:** `pnpm typecheck && pnpm lint && pnpm test` → green (web flake → isolate).
- [ ] **Step 2:** `pnpm depcruise` → clean.
- [ ] **Step 3:** Build the wasm + run the dhis2-sink integration test to confirm the runtime path still works end-to-end: `pnpm build:dhis2-sink && pnpm -C packages/plugins test dhis2-sink.integration` → 2 pass.
- [ ] **Step 4:** Final commit if anything was adjusted.

---

## Self-Review

**Spec coverage (SP-4 = L4):**
- Delete `@openldr/adapter-dhis2` → Task 2 Step 9. ✓
- Shrink `@openldr/dhis2` to host helpers (period/validate/types/dispatchReportSource + validateTrackerMapping) → Task 1. ✓
- `pushAggregate`/`pushEvents` signature → `({rows,mapping,orgUnitMap,period,dryRun})` returning `{payload,skipped,result?}` → Task 2 Step 1. ✓
- Per-connector resolution: `runMapping` resolves the mapping's `connectorId` → connector store → `getDecryptedConfig` → `loadSink` → bind `{config,allowedHosts}` → call → Task 2 Step 3 (`resolveTarget`). ✓
- Sync/ops/admin UI keep calling above the seam unchanged (routes touched only for the removed env vars + `target`→`healthCheck`) → Task 2 Steps 6-8. ✓
- `connectorId` carried by the mapping (in its definition JSON; types updated) → Task 1 Step 5. Schedule + workflow node reference a mapping, so they inherit it (no schedule/node change needed). ✓
- Remove `.env` DHIS2 vars (locked decision) → Task 2 Steps 4-5. ✓

**Correctly deferred:** Connectors UI + `/api/connectors` routes + the per-node/per-ops connector *selector* = **SP-5** (SP-4 uses `defaultConnector()` = first enabled). Live Docker DHIS2 e2e = **SP-6**.

**Placeholder scan:** complete code for the new/rewritten files; the routes/tests edits are exact (line refs + replacement code). The one read-and-adapt is the `dhis2-routes.test.ts` status assertions (Step 8) — the implementer adjusts the `host` assertion to the fake's `allowedHost`; everything else is given.

**Type consistency:** `TargetPushArgs`/`TargetPushResult` (ports) ↔ `createPluginTarget` ↔ `runMapping`'s `out.payload`/`out.skipped`/`out.result` mapped into `BuildOutput`/`BuildEventsOutput` (so `RunOutcome` shape — consumed by routes + web — is unchanged). `DataValue`/`TrackerEvent` imported from `@openldr/dhis2` (not ports). `loadSink` signature matches `ctx.plugins.loadSink` + the injected `Dhis2ContextDeps.loadSink`. `ConnectorRecord` fields match SP-3.

---

## Notes for execution

- Branch `feat/dhis2-sink-sp4` (merge to local `main`, not pushed).
- This is the coupled refactor: expect `pnpm typecheck` to be red between Task 1 and the end of Task 2 — that's structural, not a defect. Verify Task 1 with the `@openldr/dhis2` package commands; Task 2 ends with the full gate.
- After SP-4 merges, update the `dhis2-sink-plugin-workstream` memory: SP-4 done (connector-backed target live in the host; adapter deleted; env vars gone); next is **SP-5** (Settings ▸ Connectors page + `/api/connectors` CRUD/test routes + connector pickers in the DHIS2 mapping editor + workflow `dhis2-push` node) then **SP-6** (live Docker DHIS2 e2e). A dev `SECRETS_ENCRYPTION_KEY` (`openssl rand -base64 32`) + an installed `dhis2-sink` plugin + a connector row are now prerequisites to run a push.
