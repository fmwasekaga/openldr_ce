import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppContext, Dhis2Context } from '@openldr/bootstrap';
import type { Dhis2MetadataCache, OrgUnitMapStore, MappingStore, ScheduleStore } from '@openldr/db';
import { redact } from '@openldr/core';
import { z } from 'zod';
import { validateMapping, validateTrackerMapping, type AggregateMapping, type TrackerMapping } from '@openldr/dhis2';
import { requireRole } from './rbac';
import { recordAudit } from './audit-helper';

type Eventing = Parameters<Dhis2Context['reconcileSchedules']>[0];

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).host; } catch { return null; }
}

export interface Dhis2RouteDeps {
  metadataCache: Dhis2MetadataCache;
  orgUnitStore: OrgUnitMapStore;
  mappingStore: MappingStore;
  scheduleStore: ScheduleStore;
}

const orgUnitMapInput = z.object({ orgUnitId: z.string().min(1), orgUnitName: z.string().nullable() });
const runInput = z.object({ period: z.string().min(1), dryRun: z.boolean() });
const scheduleCreateInput = z.object({ mappingId: z.string().min(1), periodType: z.enum(['monthly', 'quarterly', 'yearly']), eventDriven: z.boolean() });
const scheduleEnabledInput = z.object({ enabled: z.boolean() });

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
const trackerColumn = z.object({ column: z.string().min(1), dataElement: z.string().min(1) });
const trackerDefinition = z.object({
  kind: z.literal('tracker'),
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.object({ kind: z.literal('event-source'), sourceId: z.string().min(1), params: z.record(z.string()).optional() }),
  program: z.string().min(1),
  programStage: z.string().min(1),
  orgUnitColumn: z.string().min(1),
  eventDateColumn: z.string().min(1),
  idColumn: z.string().min(1),
  dataValues: z.array(trackerColumn),
});
const mappingDefinition = z.union([aggregateDefinition, trackerDefinition]);
const mappingPutInput = z.object({ name: z.string().min(1), definition: mappingDefinition });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerDhis2Routes(app: FastifyInstance<any, any, any, any>, ctx: AppContext, dhis2: Dhis2Context | null, deps: Dhis2RouteDeps, eventing: Eventing | null = null): void {
  const cfg = ctx.cfg;
  const configured =
    cfg.REPORTING_TARGET_ADAPTER === 'dhis2' && !!cfg.DHIS2_BASE_URL && !!cfg.DHIS2_USERNAME && !!cfg.DHIS2_PASSWORD;

  async function armSchedules(): Promise<void> {
    if (dhis2 && eventing) { try { await dhis2.reconcileSchedules(eventing); } catch { /* arming is best-effort */ } }
  }

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

  app.post('/api/dhis2/mappings/:id/run', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    if (!dhis2) { reply.code(409); return { error: 'DHIS2 target not configured' }; }
    const p = runInput.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const id = (req.params as { id: string }).id;
    try {
      const outcome = await dhis2.runMapping({
        mappingId: id, period: p.data.period, dryRun: p.data.dryRun, trigger: 'manual',
        runReport: (rid, params) => ctx.reporting.run(rid, params ?? {}).then((r) => ({ rows: r.rows })),
        runEventSource: (sid, w) => ctx.reporting.runEventSource(sid, w),
      });
      const payload = outcome.build.payload as { dataValues?: unknown[]; events?: unknown[] };
      const values = payload.dataValues?.length ?? payload.events?.length ?? 0;
      return { kind: outcome.kind, dryRun: outcome.dryRun, counts: { values, skipped: outcome.build.skipped.length }, skipped: outcome.build.skipped, result: outcome.result ?? null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/unknown mapping/i.test(msg)) { reply.code(400); return { error: msg }; }
      reply.code(502);
      return { error: redact(msg) };
    }
  });

  app.get('/api/dhis2/pushes', { preHandler: requireRole('lab_admin') }, async (req) => {
    const raw = Number((req.query as { limit?: string }).limit);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(1, raw), 100) : 20;
    return ctx.audit.list({ entityType: 'dhis2-mapping', limit });
  });

  app.get('/api/dhis2/schedules', { preHandler: requireRole('lab_admin') }, async () => {
    const [schedules, mappings] = await Promise.all([deps.scheduleStore.list(), deps.mappingStore.list()]);
    const nameById = new Map(mappings.map((m) => [m.id, m.name]));
    return schedules.map((s) => ({ ...s, mappingName: nameById.get(s.mappingId) ?? s.mappingId }));
  });

  app.post('/api/dhis2/schedules', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = scheduleCreateInput.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const mapping = await deps.mappingStore.get(p.data.mappingId);
    if (!mapping) { reply.code(404); return { error: 'unknown mapping' }; }
    const mode = (mapping.definition as { kind?: string }).kind === 'tracker' ? 'tracker' : 'aggregate';
    const id = `sched-${randomUUID()}`;
    await deps.scheduleStore.create({ id, mappingId: p.data.mappingId, mode, periodType: p.data.periodType, eventDriven: p.data.eventDriven });
    await armSchedules();
    await recordAudit(ctx, req, { action: 'dhis2.schedule.create', entityType: 'dhis2-schedule', entityId: id, before: null, after: { mappingId: p.data.mappingId, mode, periodType: p.data.periodType, eventDriven: p.data.eventDriven } });
    const created = await deps.scheduleStore.get(id);
    return created;
  });

  app.post('/api/dhis2/schedules/:id/enabled', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = scheduleEnabledInput.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const id = (req.params as { id: string }).id;
    if (!(await deps.scheduleStore.get(id))) { reply.code(404); return { error: 'unknown schedule' }; }
    await deps.scheduleStore.setEnabled(id, p.data.enabled);
    if (p.data.enabled) await armSchedules();
    await recordAudit(ctx, req, { action: 'dhis2.schedule.update', entityType: 'dhis2-schedule', entityId: id, before: null, after: null, metadata: { enabled: p.data.enabled } });
    return { ok: true };
  });

  app.delete('/api/dhis2/schedules/:id', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    await deps.scheduleStore.remove(id);
    await recordAudit(ctx, req, { action: 'dhis2.schedule.delete', entityType: 'dhis2-schedule', entityId: id, before: null, after: null });
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

  app.post('/api/dhis2/mappings/validate', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const p = mappingDefinition.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const cached = await deps.metadataCache.get();
    if (!cached) return { problems: ['no DHIS2 metadata cached — pull metadata from DHIS2 settings first'] };
    const problems = (p.data as { kind?: string }).kind === 'tracker'
      ? validateTrackerMapping(p.data as TrackerMapping, cached.metadata)
      : validateMapping(p.data as AggregateMapping, cached.metadata);
    return { problems };
  });

  app.get('/api/dhis2/event-sources', { preHandler: requireRole('lab_admin') }, async () => ctx.reporting.eventSources());

  app.get('/api/dhis2/report-columns', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
    const reportId = (req.query as { reportId?: string }).reportId;
    if (!reportId) { reply.code(400); return { error: 'reportId is required' }; }
    try {
      const result = await ctx.reporting.run(reportId, {});
      return { columns: result.columns.map((c) => ({ key: c.key, label: c.label })) };
    } catch (e) {
      if (e instanceof Error && e.name === 'ReportNotFoundError') { reply.code(404); return { error: 'unknown report' }; }
      reply.code(502);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });
}
