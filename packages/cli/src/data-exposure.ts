import { createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { cliActor } from './cli-actor';

interface JsonOpt {
  json: boolean;
}

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}

export async function runDataExposureList(opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const hidden = await ctx.dashboards.columnPolicy.listHidden();
    const human =
      Object.entries(hidden)
        .map(([table, cols]) => `${table}\t${cols.join(', ')}`)
        .join('\n') || '(no hidden columns)';
    emit(opts.json, hidden, human);
    return 0;
  } finally {
    await ctx.close();
  }
}

async function mutate(table: string, columns: string[], hide: boolean, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const hiddenMap = await ctx.dashboards.columnPolicy.listHidden();
    const set = new Set(hiddenMap[table] ?? []);
    for (const c of columns) (hide ? set.add(c) : set.delete(c));
    try {
      await ctx.dashboards.columnPolicy.replaceTable(table, [...set], cliActor().actorName);
    } catch (e) {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
    await ctx.dashboards.reloadColumnPolicy();
    emit(opts.json, { table, hidden: [...set] }, `${table} hidden: ${[...set].join(', ') || '(none)'}`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export function runDataExposureHide(table: string, columns: string[], opts: JsonOpt): Promise<number> {
  return mutate(table, columns, true, opts);
}

export function runDataExposureShow(table: string, columns: string[], opts: JsonOpt): Promise<number> {
  return mutate(table, columns, false, opts);
}
