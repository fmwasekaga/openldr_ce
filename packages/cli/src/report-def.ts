import { createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import type { ReportStore } from '@openldr/db';

type Writer = (s: string) => void;
const stdout: Writer = (s) => process.stdout.write(s);

// ── Pure handlers (store injected → unit-testable) ──────────────────────────
export async function listReportDefs(store: ReportStore, opts: { json: boolean }, write: Writer = stdout): Promise<void> {
  const defs = await store.list();
  if (opts.json) { write(JSON.stringify(defs, null, 2) + '\n'); return; }
  const lines = defs.map((d) => `${d.id}\t${d.name}\t${d.category}\t${d.status}`);
  write((lines.length ? lines.join('\n') : '(no reports)') + '\n');
}

export async function deleteReportDef(store: ReportStore, id: string, opts: { force: boolean }): Promise<void> {
  if (!opts.force) throw new Error('refusing to delete without --force');
  await store.remove(id);
}

// ── Command entrypoints (open a real AppContext) ────────────────────────────
export async function runList(opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { await listReportDefs(ctx.reportDefs, opts); return 0; } finally { await ctx.close(); }
}

export async function runDelete(id: string, opts: { force: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { await deleteReportDef(ctx.reportDefs, id, opts); process.stdout.write(`deleted ${id}\n`); return 0; } finally { await ctx.close(); }
}
