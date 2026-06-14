import type { Config } from '@openldr/config';
import { createLogger, OpenLdrError } from '@openldr/core';
import { createInternalDb, createOrgUnitMapStore, createMappingStore } from '@openldr/db';
import { createDhis2Target, type Dhis2Target } from '@openldr/adapter-dhis2';
import { buildDataValueSet, validateMapping, dispatchReportSource, type AggregateMapping, type BuildOutput } from '@openldr/dhis2';
import { createAuditStore, safeRecord } from '@openldr/audit';
import type { ReportingTargetPort, TargetMetadata, PushResult } from '@openldr/ports';

export interface PushOutcome { dryRun: boolean; build: BuildOutput; result?: PushResult }

export interface Dhis2Context {
  target: ReportingTargetPort;
  orgUnits: ReturnType<typeof createOrgUnitMapStore>;
  mappings: ReturnType<typeof createMappingStore>;
  pullMetadata(): Promise<TargetMetadata>;
  validate(mappingId: string): Promise<string[]>;
  push(args: { mappingId: string; period: string; dryRun: boolean; runReport: (reportId: string, params?: Record<string, string>) => Promise<{ rows: Record<string, unknown>[] }> }): Promise<PushOutcome>;
  recentPushes(limit?: number): Promise<unknown[]>;
  close(): Promise<void>;
}

export function selectReportingTarget(cfg: Config): Dhis2Target {
  if (cfg.REPORTING_TARGET_ADAPTER !== 'dhis2') {
    throw new OpenLdrError('REPORTING_TARGET_ADAPTER is not dhis2; set it + DHIS2_* to use DHIS2');
  }
  return createDhis2Target({ baseUrl: cfg.DHIS2_BASE_URL!, username: cfg.DHIS2_USERNAME!, password: cfg.DHIS2_PASSWORD! });
}

export async function createDhis2Context(cfg: Config): Promise<Dhis2Context> {
  const logger = createLogger({ level: cfg.LOG_LEVEL });
  const internal = createInternalDb(cfg.INTERNAL_DATABASE_URL);
  const { db } = internal;
  const orgUnits = createOrgUnitMapStore(db);
  const mappings = createMappingStore(db);
  const audit = createAuditStore(db);
  const target = selectReportingTarget(cfg);

  async function loadMapping(id: string): Promise<AggregateMapping> {
    const rec = await mappings.get(id);
    if (!rec) throw new OpenLdrError(`unknown mapping: ${id}`);
    return rec.definition as unknown as AggregateMapping;
  }

  return {
    target,
    orgUnits,
    mappings,
    pullMetadata: () => target.pullMetadata(),
    async validate(mappingId) {
      const mapping = await loadMapping(mappingId);
      const metadata = await target.pullMetadata();
      return validateMapping(mapping, metadata);
    },
    async push({ mappingId, period, dryRun, runReport }) {
      const mapping = await loadMapping(mappingId);
      const src = dispatchReportSource(mapping.source);
      const { rows } = await runReport(src.reportId, src.params);
      const orgMap = await orgUnits.getMap();
      const build = buildDataValueSet(rows, mapping, orgMap, period);
      if (dryRun) return { dryRun: true, build };
      try {
        const result = await target.pushAggregate(build.payload);
        await safeRecord(audit, logger, { actorType: 'system', actorName: 'system', action: 'dhis2.push', entityType: 'dhis2-mapping', entityId: mappingId, metadata: { target: cfg.DHIS2_BASE_URL, period, dataValues: build.payload.dataValues.length, skipped: build.skipped.length, status: result.status, imported: result.imported, updated: result.updated, ignored: result.ignored, conflicts: result.conflicts.length } });
        return { dryRun: false, build, result };
      } catch (err) {
        await safeRecord(audit, logger, { actorType: 'system', actorName: 'system', action: 'dhis2.push.failed', entityType: 'dhis2-mapping', entityId: mappingId, metadata: { target: cfg.DHIS2_BASE_URL, period, error: err instanceof Error ? err.message : String(err) } });
        throw err;
      }
    },
    async recentPushes(limit = 20) {
      return audit.list({ entityType: 'dhis2-mapping', limit });
    },
    async close() {
      await Promise.allSettled([internal.close(), target.close()]);
    },
  };
}
