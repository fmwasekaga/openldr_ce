import { randomUUID } from 'node:crypto';
import { OpenLdrError, type Logger } from '@openldr/core';
import type { ConnectorRecord } from '@openldr/db';
import type { PluginDataStore } from '@openldr/db';
import {
  validateMapping, validateTrackerMapping, dispatchReportSource, periodRange,
  type AggregateMapping, type TrackerMapping, type DhisMapping, type BuildOutput,
  type BuildEventsOutput, type DataValue, type TrackerEvent,
} from '@openldr/dhis2';
import { safeRecord, type AuditStore } from '@openldr/audit';
import type { WasmSink } from '@openldr/plugins';
import type { ReportingTargetPort, TargetMetadata, PushResult } from '@openldr/ports';
import type { createPluginTarget } from './connector-target';

export interface AggregateOutcome { kind: 'aggregate'; dryRun: boolean; build: BuildOutput; result?: PushResult }
export interface TrackerOutcome { kind: 'tracker'; dryRun: boolean; build: BuildEventsOutput; result?: PushResult }
export type RunOutcome = AggregateOutcome | TrackerOutcome;

export interface ConnectorPushInput {
  connectorId: string;
  mapping: unknown;
  orgUnitMap?: Record<string, string>;
  period: string;
  dryRun: boolean;
  /** Optional caller-supplied trigger label for the push-history doc (defaults to 'manual'). */
  trigger?: string;
}

export interface Dhis2OrchestrationDeps {
  connectors: {
    get(id: string): Promise<ConnectorRecord | null>;
    getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>>;
  };
  loadSink: (id: string, version?: string) => Promise<WasmSink | undefined>;
  reporting: {
    run(id: string, params?: Record<string, string>): Promise<{ rows: Record<string, unknown>[] }>;
    runEventSource(id: string, window: { from: string; to: string }): Promise<{ rows: Record<string, unknown>[] }>;
  };
  createTarget: typeof createPluginTarget;
  /** AES key for connector secrets; `getDecryptedConfig` fails closed when undefined. */
  secretsKey: string | undefined;
  /** DHIS2-specific push-history collection lives under the dhis2-sink plugin namespace. */
  pluginData: PluginDataStore;
  /** Optional: mirror the host DHIS2 audit trail when present. */
  audit?: AuditStore;
  logger: Logger;
}

export interface Dhis2Orchestration {
  metadata(connectorId: string): Promise<TargetMetadata>;
  validate(input: { connectorId: string; mapping: unknown }): Promise<string[]>;
  push(input: ConnectorPushInput): Promise<RunOutcome>;
}

const PUSH_PLUGIN_ID = 'dhis2-sink';
const PUSH_COLLECTION = 'pushes';

function mappingKind(m: DhisMapping): 'aggregate' | 'tracker' {
  return (m as { kind?: string }).kind === 'tracker' ? 'tracker' : 'aggregate';
}

/**
 * Generic, caller-driven DHIS2 push orchestration. Mirrors the host dhis2-context
 * `runMapping`/`resolveTarget`/`validate` behaviour, but reads the mapping, orgUnitMap,
 * and connectorId from the CALLER instead of loading them from host stores — so the
 * DHIS2 plugin UI can own its own mapping/org-unit data while the host still drives
 * the egress-gated push through a connector + sink plugin.
 */
export function createDhis2Orchestration(deps: Dhis2OrchestrationDeps): Dhis2Orchestration {
  const logger = deps.logger;

  async function resolveTarget(connectorId: string): Promise<{ target: ReportingTargetPort; connector: ConnectorRecord }> {
    const connector = await deps.connectors.get(connectorId);
    if (!connector) throw new OpenLdrError(`connector ${connectorId} not found`);
    if (!connector.enabled) throw new OpenLdrError(`connector ${connectorId} is disabled`);
    const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
    const sink = await deps.loadSink(connector.pluginId);
    if (!sink) throw new OpenLdrError(`sink plugin '${connector.pluginId}' for connector ${connectorId} is not installed`);
    return { target: deps.createTarget(sink, config, connector.allowedHost), connector };
  }

  async function recordAudit(action: string, mappingId: string, period: string, extra: Record<string, unknown>): Promise<void> {
    if (!deps.audit) return;
    await safeRecord(deps.audit, logger, {
      actorType: 'system', actorName: 'system', action, entityType: 'dhis2-mapping', entityId: mappingId,
      metadata: { period, ...extra },
    });
  }

  async function writePushDoc(doc: Record<string, unknown>): Promise<void> {
    const id = randomUUID();
    await deps.pluginData.put(PUSH_PLUGIN_ID, PUSH_COLLECTION, id, { id, ...doc });
  }

  return {
    async metadata(connectorId) {
      const { target } = await resolveTarget(connectorId);
      return target.pullMetadata();
    },

    async validate({ connectorId, mapping }) {
      const { target } = await resolveTarget(connectorId);
      const md = await target.pullMetadata();
      const m = mapping as DhisMapping;
      return mappingKind(m) === 'tracker'
        ? validateTrackerMapping(m as TrackerMapping, md)
        : validateMapping(m as AggregateMapping, md);
    },

    async push(input) {
      const { connectorId, period, dryRun, trigger = 'manual' } = input;
      const orgUnitMap = input.orgUnitMap ?? {};
      const mapping = input.mapping as DhisMapping;
      const mappingId = (mapping as { id?: string }).id ?? 'unknown';
      const { target, connector } = await resolveTarget(connectorId);

      if (mappingKind(mapping) === 'tracker') {
        const tm = mapping as TrackerMapping;
        const { from, to } = periodRange(period);
        const { rows } = await deps.reporting.runEventSource(tm.source.sourceId, { from, to });
        try {
          const out = await target.pushEvents({ rows, mapping: tm, orgUnitMap, period, dryRun });
          const build: BuildEventsOutput = { payload: out.payload as { events: TrackerEvent[] }, skipped: out.skipped };
          if (dryRun) return { kind: 'tracker', dryRun: true, build };
          const result = out.result!;
          await recordAudit('dhis2.tracker.push', mappingId, period, {
            trigger, connector: connector.id, events: build.payload.events.length, skipped: build.skipped.length,
            status: result.status, imported: result.imported, updated: result.updated, ignored: result.ignored, conflicts: result.conflicts.length,
          });
          await writePushDoc({
            period, kind: 'tracker', connectorId, status: result.status, imported: result.imported,
            updated: result.updated, ignored: result.ignored, conflicts: result.conflicts.length,
            skipped: build.skipped.length, count: build.payload.events.length, at: new Date().toISOString(), trigger,
          });
          return { kind: 'tracker', dryRun: false, build, result };
        } catch (err) {
          if (!dryRun) {
            const msg = err instanceof Error ? err.message : String(err);
            await recordAudit('dhis2.tracker.push.failed', mappingId, period, { trigger, connector: connector.id, error: msg });
            await writePushDoc({ period, kind: 'tracker', connectorId, status: 'failed', error: msg, at: new Date().toISOString(), trigger });
          }
          throw err;
        }
      }

      const am = mapping as AggregateMapping;
      const src = dispatchReportSource(am.source);
      const { rows } = await deps.reporting.run(src.reportId, src.params);
      try {
        const out = await target.pushAggregate({ rows, mapping: am, orgUnitMap, period, dryRun });
        const build: BuildOutput = { payload: out.payload as { dataValues: DataValue[] }, skipped: out.skipped };
        if (dryRun) return { kind: 'aggregate', dryRun: true, build };
        const result = out.result!;
        await recordAudit('dhis2.push', mappingId, period, {
          trigger, connector: connector.id, dataValues: build.payload.dataValues.length, skipped: build.skipped.length,
          status: result.status, imported: result.imported, updated: result.updated, ignored: result.ignored, conflicts: result.conflicts.length,
        });
        await writePushDoc({
          period, kind: 'aggregate', connectorId, status: result.status, imported: result.imported,
          updated: result.updated, ignored: result.ignored, conflicts: result.conflicts.length,
          skipped: build.skipped.length, count: build.payload.dataValues.length, at: new Date().toISOString(), trigger,
        });
        return { kind: 'aggregate', dryRun: false, build, result };
      } catch (err) {
        if (!dryRun) {
          const msg = err instanceof Error ? err.message : String(err);
          await recordAudit('dhis2.push.failed', mappingId, period, { trigger, connector: connector.id, error: msg });
          await writePushDoc({ period, kind: 'aggregate', connectorId, status: 'failed', error: msg, at: new Date().toISOString(), trigger });
        }
        throw err;
      }
    },
  };
}
