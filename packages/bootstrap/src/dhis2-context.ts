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
  runMapping(args: { mappingId: string; period: string; dryRun: boolean; trigger?: string } & RunCallbacks): Promise<RunOutcome>;
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

  async function runMapping(args: { mappingId: string; period: string; dryRun: boolean; trigger?: string } & RunCallbacks): Promise<RunOutcome> {
    const { mappingId, period, dryRun, runReport, runEventSource, trigger = 'manual' } = args;
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
        await auditPush('dhis2.tracker.push', mappingId, period, { trigger, events: build.payload.events.length, skipped: build.skipped.length, status: result.status, imported: result.imported, updated: result.updated, ignored: result.ignored, conflicts: result.conflicts.length });
        return { kind: 'tracker', dryRun: false, build, result };
      } catch (err) {
        await auditPush('dhis2.tracker.push.failed', mappingId, period, { trigger, error: err instanceof Error ? err.message : String(err) });
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
      await auditPush('dhis2.push', mappingId, period, { trigger, dataValues: build.payload.dataValues.length, skipped: build.skipped.length, status: result.status, imported: result.imported, updated: result.updated, ignored: result.ignored, conflicts: result.conflicts.length });
      return { kind: 'aggregate', dryRun: false, build, result };
    } catch (err) {
      await auditPush('dhis2.push.failed', mappingId, period, { trigger, error: err instanceof Error ? err.message : String(err) });
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
        try { await runMapping({ mappingId: sched.mappingId, period, dryRun: false, trigger: 'scheduled', ...cb }); }
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
          try { await runMapping({ mappingId: s.mappingId, period: currentPeriod(s.periodType, now), dryRun: false, trigger: 'ingest-event', ...cb }); }
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
