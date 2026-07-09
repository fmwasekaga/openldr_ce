import { writeFileSync } from 'node:fs';
import { createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { toCsv } from '@openldr/reporting';

interface RunOpts {
  param?: string[];
  json: boolean;
  csv: boolean;
}

function parseParams(pairs: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    const idx = p.indexOf('=');
    if (idx > 0) out[p.slice(0, idx)] = p.slice(idx + 1);
  }
  return out;
}

export async function runReportList(opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    // listAll() (async) resolves ALL reports — data-driven records + published templates. The sync
    // list() is catalog-only and returns [] now that the catalog is retired (Slice S6), so
    // `report list` would otherwise print nothing.
    const rows = await ctx.reporting.listAll();
    if (opts.json) process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    else process.stdout.write(rows.map((r) => `  ${r.id.padEnd(22)} ${r.name}`).join('\n') + '\n');
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runReportRun(id: string, opts: RunOpts & { format?: string; out?: string }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    if (opts.format === 'pdf') {
      const buf = await ctx.reporting.renderPdf(id, parseParams(opts.param));
      const out = opts.out ?? `${id}.pdf`;
      writeFileSync(out, buf);
      process.stdout.write(`wrote ${out} (${buf.length} bytes)\n`);
      return 0;
    }
    const result = await ctx.reporting.run(id, parseParams(opts.param));
    if (opts.csv) process.stdout.write(toCsv(result.columns, result.rows));
    else if (opts.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else {
      const header = result.columns.map((c) => c.label).join(' | ');
      const body = result.rows.map((r) => result.columns.map((c) => String(r[c.key] ?? '')).join(' | ')).join('\n');
      process.stdout.write(`${header}\n${body || '(no rows)'}\n`);
    }
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runReportGlassExport(opts: { country: string; year: string; from?: string; to?: string; out?: string; json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const params: Record<string, string> = { country: opts.country, year: opts.year };
    if (opts.from) params.from = opts.from;
    if (opts.to) params.to = opts.to;
    const result = await ctx.reporting.run('r-amr-glass-ris', params);
    const csv = toCsv(result.columns, result.rows);
    if (opts.out) { writeFileSync(opts.out, csv); process.stdout.write(`wrote ${opts.out}\n`); }
    else if (opts.json) process.stdout.write(JSON.stringify(result.rows, null, 2) + '\n');
    else process.stdout.write(csv);
    return 0;
  } finally {
    await ctx.close();
  }
}
