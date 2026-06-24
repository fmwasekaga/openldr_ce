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
  type DataValue, type TrackerEvent,
} from '@openldr/dhis2';
import { createAuditStore, safeRecord, type AuditStore } from '@openldr/audit';
import type { WasmSink } from '@openldr/plugins';
import type { EventingPort, ReportingTargetPort, TargetMetadata, PushResult } from '@openldr/ports';
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
