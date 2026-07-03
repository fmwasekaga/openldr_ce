import { readFileSync, writeFileSync } from 'node:fs';
import { createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { ReportTemplateSchema, type ReportTemplate } from '@openldr/report-builder/pure';
import { renderReportTemplatePdf, type ReportTemplateStore } from '@openldr/report-builder';
import type { WidgetQuery } from '@openldr/dashboards';
import type { ReportResult } from '@openldr/reporting';

type Writer = (s: string) => void;
const stdout: Writer = (s) => process.stdout.write(s);

// ── Pure handlers (store injected → unit-testable) ──────────────────────────
export async function listTemplates(store: ReportTemplateStore, opts: { json: boolean }, write: Writer = stdout): Promise<void> {
  const templates = await store.list();
  if (opts.json) { write(JSON.stringify(templates, null, 2) + '\n'); return; }
  const lines = templates.map((t) => `${t.id}\t${t.name}\t${t.category}\t${t.status}\t${t.rows.length} rows`);
  write((lines.length ? lines.join('\n') : '(no report templates)') + '\n');
}

export async function exportTemplate(store: ReportTemplateStore, id: string, write: Writer = stdout): Promise<void> {
  const t = await store.get(id);
  if (!t) throw new Error(`report template not found: ${id}`);
  write(JSON.stringify(t, null, 2) + '\n');
}

export async function importTemplate(store: ReportTemplateStore, json: string): Promise<ReportTemplate> {
  const parsed = ReportTemplateSchema.parse(JSON.parse(json));
  return store.create(parsed);
}

export async function deleteTemplate(store: ReportTemplateStore, id: string, opts: { force: boolean }): Promise<void> {
  if (!opts.force) throw new Error('refusing to delete without --force');
  await store.remove(id);
}

// ── Command entrypoints (open a real AppContext) ────────────────────────────
export async function runList(opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { await listTemplates(ctx.reportTemplates, opts); return 0; } finally { await ctx.close(); }
}
export async function runExport(id: string): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { await exportTemplate(ctx.reportTemplates, id); return 0; } finally { await ctx.close(); }
}
export async function runImport(file: string): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { const t = await importTemplate(ctx.reportTemplates, readFileSync(file, 'utf8')); process.stdout.write(`imported ${t.id}\n`); return 0; } finally { await ctx.close(); }
}
export async function runDelete(id: string, opts: { force: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { await deleteTemplate(ctx.reportTemplates, id, opts); process.stdout.write(`deleted ${id}\n`); return 0; } finally { await ctx.close(); }
}

export function parseParams(s: string | undefined): Record<string, string> {
  if (!s) return {};
  const out: Record<string, string> = {};
  for (const pair of s.split(',')) {
    const eq = pair.indexOf('=');
    if (eq > 0) out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return out;
}

export async function renderTemplateToFile(
  store: ReportTemplateStore,
  queryFn: (q: WidgetQuery) => Promise<ReportResult>,
  id: string,
  params: Record<string, string>,
  outPath: string,
): Promise<void> {
  const tpl = await store.get(id);
  if (!tpl) throw new Error(`report template not found: ${id}`);
  const pdf = await renderReportTemplatePdf(tpl, params, queryFn);
  writeFileSync(outPath, pdf);
}

export async function runRender(id: string, opts: { params?: string; out: string }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    await renderTemplateToFile(ctx.reportTemplates, (q) => ctx.dashboards.query(q), id, parseParams(opts.params), opts.out);
    process.stdout.write(`rendered ${id} -> ${opts.out}\n`);
    return 0;
  } finally { await ctx.close(); }
}
