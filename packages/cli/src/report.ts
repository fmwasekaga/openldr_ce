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
    const rows = ctx.reporting.list();
    if (opts.json) process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    else process.stdout.write(rows.map((r) => `  ${r.id.padEnd(22)} ${r.name}`).join('\n') + '\n');
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runReportRun(id: string, opts: RunOpts): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
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
