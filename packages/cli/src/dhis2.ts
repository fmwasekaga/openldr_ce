import { readFileSync } from 'node:fs';
import { loadConfig } from '@openldr/config';
import { createDhis2Context, createAppContext } from '@openldr/bootstrap';
import { redactError } from './redact-error';
import type { AggregateMapping } from '@openldr/dhis2';

function out(json: boolean, obj: unknown, human: string): void {
  process.stdout.write((json ? JSON.stringify(obj, null, 2) : human) + '\n');
}

export async function runDhis2MapImport(file: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createDhis2Context(loadConfig());
  try {
    const m = JSON.parse(readFileSync(file, 'utf8')) as AggregateMapping;
    await ctx.mappings.upsert({ id: m.id, name: m.name, definition: m as unknown as Record<string, unknown> });
    out(opts.json, { id: m.id }, `imported mapping ${m.id}`);
    return 0;
  } catch (err) { process.stderr.write(`map import failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runDhis2MapList(opts: { json: boolean }): Promise<number> {
  const ctx = await createDhis2Context(loadConfig());
  try { const rows = await ctx.mappings.list(); out(opts.json, rows, rows.map((r) => `${r.id}  ${r.name}`).join('\n') || '(none)'); return 0; }
  finally { await ctx.close(); }
}

export async function runDhis2OrgUnitImport(file: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createDhis2Context(loadConfig());
  try {
    const entries = JSON.parse(readFileSync(file, 'utf8')) as { facilityId: string; orgUnitId: string; orgUnitName?: string }[];
    await ctx.orgUnits.upsert(entries.map((e) => ({ facilityId: e.facilityId, orgUnitId: e.orgUnitId, orgUnitName: e.orgUnitName ?? null })));
    out(opts.json, { count: entries.length }, `imported ${entries.length} orgUnit mappings`);
    return 0;
  } catch (err) { process.stderr.write(`orgunit import failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runDhis2OrgUnitList(opts: { json: boolean }): Promise<number> {
  const ctx = await createDhis2Context(loadConfig());
  try { const rows = await ctx.orgUnits.list(); out(opts.json, rows, rows.map((r) => `${r.facilityId} -> ${r.orgUnitId}`).join('\n') || '(none)'); return 0; }
  finally { await ctx.close(); }
}

export async function runDhis2PullMetadata(opts: { json: boolean }): Promise<number> {
  const ctx = await createDhis2Context(loadConfig());
  try {
    const m = await ctx.pullMetadata();
    out(opts.json, { dataElements: m.dataElements.length, orgUnits: m.orgUnits.length, categoryOptionCombos: m.categoryOptionCombos.length }, `dataElements=${m.dataElements.length} orgUnits=${m.orgUnits.length} coc=${m.categoryOptionCombos.length}`);
    return 0;
  } catch (err) { process.stderr.write(`pull-metadata failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

export async function runDhis2Validate(mappingId: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createDhis2Context(loadConfig());
  try {
    const problems = await ctx.validate(mappingId);
    out(opts.json, { problems }, problems.length ? problems.join('\n') : 'OK');
    return problems.length ? 1 : 0;
  } catch (err) { process.stderr.write(`validate failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); }
}

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
  } catch (err) { process.stderr.write(`push failed: ${redactError(err)}\n`); return 1; }
  finally { await ctx.close(); await app.close(); }
}

export async function runDhis2ScheduleAdd(mappingId: string, opts: { mode: string; periodType: string; eventDriven: boolean; json: boolean }): Promise<number> {
  const ctx = await createDhis2Context(loadConfig());
  try {
    const id = `${mappingId}:${opts.mode}:${opts.periodType}`;
    await ctx.schedules.create({ id, mappingId, mode: opts.mode as 'aggregate' | 'tracker', periodType: opts.periodType as 'monthly' | 'quarterly' | 'yearly', eventDriven: opts.eventDriven });
    out(opts.json, { id }, `created schedule ${id}`);
    return 0;
  } catch (err) { process.stderr.write(`schedule add failed: ${redactError(err)}\n`); return 1; }
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

export async function runDhis2Status(opts: { json: boolean }): Promise<number> {
  const ctx = await createDhis2Context(loadConfig());
  try {
    const rows = await ctx.recentPushes(20) as { occurredAt: string; action: string; entityId: string; metadata?: Record<string, unknown> }[];
    out(opts.json, rows, rows.map((r) => `${r.occurredAt}  ${r.action}  ${r.entityId}  ${JSON.stringify(r.metadata ?? {})}`).join('\n') || '(no pushes)');
    return 0;
  } finally { await ctx.close(); }
}
