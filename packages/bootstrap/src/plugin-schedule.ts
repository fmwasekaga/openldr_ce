import { randomUUID } from 'node:crypto';
import { currentPeriod, nextPeriodBoundary, type PeriodType } from '@openldr/dhis2';
import type { EventingPort } from '@openldr/ports';
import type { PluginDataStore } from '@openldr/db';

/**
 * Generic per-plugin schedule store. v1 is used by the DHIS2 webview plugin, but the
 * shape is plugin-agnostic: schedules live in plugin_data(pluginId,'schedules',id) as
 * plain KV docs (no typed store) — register read-modify-write upserts by id, which also
 * serves as the enable/disable toggle path.
 */
export interface PluginScheduleApi {
  /** Mint an id if absent, default enabled=true, store, and return the persisted doc. */
  register(pluginId: string, schedule: unknown): Promise<unknown>;
  /** All schedule docs for a plugin. */
  list(pluginId: string): Promise<unknown>;
  /** Delete a schedule doc. */
  remove(pluginId: string, id: string): Promise<unknown>;
}

const SCHEDULES = 'schedules';
const MAPPINGS = 'mappings';
const ORG_UNIT_MAPS = 'orgUnitMaps';

interface ScheduleDoc {
  id: string;
  mappingId: string;
  mode?: string;
  periodType: PeriodType;
  eventDriven?: boolean;
  enabled: boolean;
  lastRunAt: string | null;
  nextDueAt: string | null;
}

export function createPluginScheduleApi(pluginData: PluginDataStore): PluginScheduleApi {
  return {
    async register(pluginId, schedule) {
      const input = (schedule ?? {}) as Record<string, unknown>;
      const id = typeof input.id === 'string' && input.id ? input.id : randomUUID();
      const doc = {
        ...input,
        id,
        enabled: input.enabled === undefined ? true : Boolean(input.enabled),
      };
      await pluginData.put(pluginId, SCHEDULES, id, doc);
      return doc;
    },
    async list(pluginId) {
      const entries = await pluginData.list(pluginId, SCHEDULES);
      return entries.map((e) => e.doc);
    },
    async remove(pluginId, id) {
      await pluginData.delete(pluginId, SCHEDULES, id);
      return { ok: true };
    },
  };
}

export interface PluginScheduleRunnerDeps {
  pluginData: PluginDataStore;
  /** The DHIS2 orchestration push (from Task 2). */
  push: (input: {
    connectorId: string;
    mapping: unknown;
    orgUnitMap?: Record<string, string>;
    period: string;
    dryRun: boolean;
    trigger?: string;
  }) => Promise<unknown>;
  logger: { error(obj: unknown, msg?: string): void };
}

export interface PluginScheduleRunner {
  runDue(pluginId: string, scheduleId: string): Promise<void>;
  registerRunner(eventing: EventingPort): Promise<void>;
  reconcile(eventing: EventingPort): Promise<void>;
}

const DUE_EVENT = 'plugin.schedule.due';
/** v1 only the DHIS2 sink plugin owns schedules; widen if other plugins gain schedules. */
const RECONCILE_PLUGIN_ID = 'dhis2-sink';

export function createPluginScheduleRunner(deps: PluginScheduleRunnerDeps): PluginScheduleRunner {
  async function getSchedule(pluginId: string, id: string): Promise<ScheduleDoc | null> {
    return (await deps.pluginData.get(pluginId, SCHEDULES, id)) as ScheduleDoc | null;
  }

  async function runDue(pluginId: string, scheduleId: string): Promise<void> {
    const schedule = await getSchedule(pluginId, scheduleId);
    if (!schedule || !schedule.enabled) return;

    const mappingDoc = (await deps.pluginData.get(pluginId, MAPPINGS, schedule.mappingId)) as
      | { id: string; name?: string; definition?: unknown }
      | null;
    if (!mappingDoc) {
      deps.logger.error({ pluginId, scheduleId, mappingId: schedule.mappingId }, 'plugin schedule mapping not found');
    } else {
      const definition = mappingDoc.definition as { connectorId?: string } | undefined;
      const connectorId = definition?.connectorId;
      if (!connectorId) {
        deps.logger.error({ pluginId, scheduleId, mappingId: schedule.mappingId }, 'plugin schedule mapping has no connectorId');
      } else {
        const orgEntries = await deps.pluginData.list(pluginId, ORG_UNIT_MAPS);
        const orgUnitMap = Object.fromEntries(
          orgEntries
            .filter((e) => {
              const m = e.doc as Record<string, unknown>;
              return typeof m.facilityId === 'string' && typeof m.orgUnitId === 'string';
            })
            .map((e) => {
              const m = e.doc as { facilityId: string; orgUnitId: string };
              return [m.facilityId, m.orgUnitId] as [string, string];
            }),
        );
        const period = currentPeriod(schedule.periodType, new Date());
        try {
          await deps.push({ connectorId, mapping: definition, orgUnitMap, period, dryRun: false, trigger: 'scheduled' });
        } catch (err) {
          // The push records its own failure push-doc; do not rethrow (would crash the worker).
          deps.logger.error({ err, pluginId, scheduleId }, 'plugin schedule run failed');
        }
      }
    }

    // Read-modify-write lastRunAt (always, even on a broken mapping, so the schedule is
    // not stuck re-firing a crash loop; the runner re-arms it on the next boundary).
    const after = await getSchedule(pluginId, scheduleId);
    if (after) await deps.pluginData.put(pluginId, SCHEDULES, scheduleId, { ...after, lastRunAt: new Date().toISOString() });
  }

  return {
    runDue,
    async registerRunner(eventing) {
      await eventing.subscribe(DUE_EVENT, async (event) => {
        const payload = event.payload;
        if (typeof payload !== 'object' || payload === null) return;
        const { pluginId, scheduleId } = payload as { pluginId?: string; scheduleId?: string };
        if (typeof pluginId !== 'string' || typeof scheduleId !== 'string') return;
        if (!(await getSchedule(pluginId, scheduleId))) return;
        await runDue(pluginId, scheduleId);
        // Re-fetch after the run so a mid-run disable/edit (cadence change) is honored
        // when re-arming, rather than re-arming from a stale pre-run snapshot.
        const after = await getSchedule(pluginId, scheduleId);
        if (!after || !after.enabled) return;
        const due = nextPeriodBoundary(after.periodType, new Date());
        await deps.pluginData.put(pluginId, SCHEDULES, scheduleId, { ...after, nextDueAt: due.toISOString() });
        await eventing.publish({ type: DUE_EVENT, payload: { pluginId, scheduleId } }, { availableAt: due });
      });
    },
    async reconcile(eventing) {
      const now = Date.now();
      const entries = await deps.pluginData.list(RECONCILE_PLUGIN_ID, SCHEDULES);
      for (const entry of entries) {
        const s = entry.doc as ScheduleDoc;
        if (!s.enabled) continue;
        const nextDue = s.nextDueAt ? new Date(s.nextDueAt) : null;
        // Already armed for the future (its due event is still pending in the durable
        // outbox) — skip, or every restart would re-arm and compound duplicate runs.
        if (nextDue && nextDue.getTime() > now) continue;
        const due = nextDue && nextDue.getTime() <= now ? nextDue : nextPeriodBoundary(s.periodType, new Date());
        await deps.pluginData.put(RECONCILE_PLUGIN_ID, SCHEDULES, s.id, { ...s, nextDueAt: due.toISOString() });
        await eventing.publish({ type: DUE_EVENT, payload: { pluginId: RECONCILE_PLUGIN_ID, scheduleId: s.id } }, { availableAt: due });
      }
    },
  };
}
