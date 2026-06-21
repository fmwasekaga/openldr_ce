import type { FastifyInstance } from 'fastify';
import type { AppContext, Dhis2Context } from '@openldr/bootstrap';
import type { Dhis2MetadataCache, OrgUnitMapStore, MappingStore } from '@openldr/db';
import { redact } from '@openldr/core';
import { z } from 'zod';
import { requireRole } from './rbac';
import { recordAudit } from './audit-helper';

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).host; } catch { return null; }
}

export interface Dhis2RouteDeps {
  metadataCache: Dhis2MetadataCache;
  orgUnitStore: OrgUnitMapStore;
  mappingStore: MappingStore;
}

const orgUnitMapInput = z.object({ orgUnitId: z.string().min(1), orgUnitName: z.string().nullable() });

const aggregateColumn = z.object({ column: z.string().min(1), dataElement: z.string().min(1), categoryOptionCombo: z.string().optional() });
const aggregateDefinition = z.object({
  kind: z.literal('aggregate').optional(),
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.object({ kind: z.literal('report'), reportId: z.string().min(1), params: z.record(z.string()).optional() }),
  orgUnitColumn: z.string().min(1),
  periodColumn: z.string().optional(),
  columns: z.array(aggregateColumn),
});
const mappingPutInput = z.object({ name: z.string().min(1), definition: aggregateDefinition });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerDhis2Routes(app: FastifyInstance<any, any, any, any>, ctx: AppContext, dhis2: Dhis2Context | null, deps: Dhis2RouteDeps): void {
  const cfg = ctx.cfg;
  const configured =
    cfg.REPORTING_TARGET_ADAPTER === 'dhis2' && !!cfg.DHIS2_BASE_URL && !!cfg.DHIS2_USERNAME && !!cfg.DHIS2_PASSWORD;

  app.get('/api/dhis2/status', { preHandler: requireRole('lab_admin') }, async () => {
    const base = { configured, syncEnabled: cfg.DHIS2_SYNC_ENABLED, host: hostOf(cfg.DHIS2_BASE_URL) };
    if (!configured || !dhis2) {
      return { ...base, reachable: null, counts: null, recentPushes: [] };
    }
    let reachable;
    try {
      reachable = await dhis2.target.healthCheck();
    } catch (e) {
      reachable = { status: 'down' as const, latencyMs: 0, detail: redact(e instanceof Error ? e.message : String(e)) };
    }
    const [mappings, orgUnitMappings, schedules] = await Promise.all([
      dhis2.mappings.list(),
      dhis2.orgUnits.list(),
      dhis2.schedules.list(),
    ]);
    const recentPushes = await dhis2.recentPushes(10);
    return {
      ...base,
      reachable,
      counts: { mappings: mappings.length, orgUnitMappings: orgUnitMappings.length, schedules: schedules.length },
      recentPushes,
    };
  });

  app.post('/api/dhis2/metadata/pull', { preHandler: requireRole('lab_admin') }, async (_req, reply) => {
    if (!configured || !dhis2) {
      reply.code(409);
      return { error: 'DHIS2 target not configured' };
    }
    try {
      const md = await dhis2.pullMetadata();
      await deps.metadataCache.save(md);
      const cached = await deps.metadataCache.get();
      return {
        pulledAt: cached?.pulledAt ?? null,
        counts: {
          dataElements: md.dataElements.length,
          orgUnits: md.orgUnits.length,
          categoryOptionCombos: md.categoryOptionCombos.length,
          programs: md.programs?.length ?? 0,
          programStages: md.programStages?.length ?? 0,
        },
      };
    } catch (e) {
      reply.code(502);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });

  app.get('/api/dhis2/orgunit-mappings', { preHandler: requireRole('lab_admin') }, async () => {
    const [locations, mappings, cached] = await Promise.all([
      ctx.fhirStore.listByType('Location'),
      deps.orgUnitStore.list(),
      deps.metadataCache.get(),
    ]);
    const byFacility = new Map(mappings.map((m) => [m.facilityId, m]));
    const facilities = locations.map((l) => {
      const name = (l.resource as { name?: unknown }).name;
      const facilityName = typeof name === 'string' && name.length > 0 ? name : l.id;
      const m = byFacility.get(l.id);
      return { facilityId: l.id, facilityName, orgUnitId: m?.orgUnitId ?? null, orgUnitName: m?.orgUnitName ?? null };
    });
    return { facilities, orgUnits: cached?.metadata.orgUnits ?? [], metadataPulledAt: cached?.pulledAt ?? null };
  });

  app.put('/api/dhis2/orgunit-mappings/:facilityId', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = orgUnitMapInput.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const facilityId = (req.params as { facilityId: string }).facilityId;
    const before = (await deps.orgUnitStore.list()).find((m) => m.facilityId === facilityId) ?? null;
    const after = { facilityId, orgUnitId: p.data.orgUnitId, orgUnitName: p.data.orgUnitName };
    await deps.orgUnitStore.upsert([after]);
    await recordAudit(ctx, req, { action: 'dhis2.orgunit.map', entityType: 'dhis2-orgunit-map', entityId: facilityId, before, after, metadata: { orgUnitId: p.data.orgUnitId } });
    return after;
  });

  app.delete('/api/dhis2/orgunit-mappings/:facilityId', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const facilityId = (req.params as { facilityId: string }).facilityId;
    const before = (await deps.orgUnitStore.list()).find((m) => m.facilityId === facilityId) ?? null;
    await deps.orgUnitStore.remove(facilityId);
    await recordAudit(ctx, req, { action: 'dhis2.orgunit.unmap', entityType: 'dhis2-orgunit-map', entityId: facilityId, before, after: null });
    reply.code(204);
    return null;
  });

  app.get('/api/dhis2/mappings', { preHandler: requireRole('lab_admin') }, async () => deps.mappingStore.list());

  app.get('/api/dhis2/mappings/:id', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const m = await deps.mappingStore.get(id);
    if (!m) { reply.code(404); return { error: 'not found' }; }
    return m;
  });

  app.put('/api/dhis2/mappings/:id', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = mappingPutInput.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const id = (req.params as { id: string }).id;
    const before = await deps.mappingStore.get(id);
    const record = { id, name: p.data.name, definition: p.data.definition as Record<string, unknown> };
    await deps.mappingStore.upsert(record);
    await recordAudit(ctx, req, { action: 'dhis2.mapping.save', entityType: 'dhis2-mapping', entityId: id, before, after: record });
    return record;
  });

  app.delete('/api/dhis2/mappings/:id', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await deps.mappingStore.get(id);
    await deps.mappingStore.remove(id);
    await recordAudit(ctx, req, { action: 'dhis2.mapping.delete', entityType: 'dhis2-mapping', entityId: id, before, after: null });
    reply.code(204);
    return null;
  });

  app.get('/api/dhis2/metadata', { preHandler: requireRole('lab_admin') }, async () => {
    const cached = await deps.metadataCache.get();
    if (!cached) return null;
    const m = cached.metadata;
    return {
      dataElements: m.dataElements,
      categoryOptionCombos: m.categoryOptionCombos,
      orgUnits: m.orgUnits,
      programs: m.programs ?? [],
      programStages: m.programStages ?? [],
      pulledAt: cached.pulledAt,
    };
  });
}
