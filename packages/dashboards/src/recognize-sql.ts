import type { WidgetQuery, Agg, DateGrain } from './types';
import { listModels } from './models/registry';

type BuilderQuery = Extract<WidgetQuery, { mode: 'builder' }>;
export type RecognizeCode =
  | 'union' | 'join' | 'cte' | 'window' | 'case_measure' | 'multi_measure'
  | 'detail_rows' | 'unknown_table' | 'unknown_dimension' | 'unknown_metric'
  | 'unrecognized_predicate' | 'not_null_unsupported' | 'parse_failed';
export type RecognizeResult =
  | { ok: true; query: BuilderQuery }
  | { ok: false; code: RecognizeCode; reason: string };

class Refuse extends Error { constructor(public code: RecognizeCode, msg: string) { super(msg); } }
const refuse = (code: RecognizeCode, msg: string): never => { throw new Refuse(code, msg); };

// Reverse index built from the model registry so it never drifts from the source of truth.
interface TableEntry { model: string; dims: Record<string, { key: string; kind: string }>; metrics: Record<string, string> }
function buildIndex(): Record<string, TableEntry> {
  const idx: Record<string, TableEntry> = {};
  for (const m of listModels()) {
    const table: string = m.table;
    const dims: TableEntry['dims'] = {};
    for (const d of m.dimensions) dims[d.column.toLowerCase()] = { key: d.key, kind: d.kind };
    const metrics: TableEntry['metrics'] = {};
    for (const x of m.metrics) if (x.column) metrics[`${x.agg}:${x.column.toLowerCase()}`] = x.key;
    idx[table.toLowerCase()] = { model: m.id, dims, metrics };
  }
  return idx;
}
const INDEX = buildIndex();

const SUBSTR = /^substring\(\s*(\w+)\s*,\s*1\s*,\s*10\s*\)$/i;
function unwrapNum(e: string): string {
  let s = e.trim(); let m: RegExpMatchArray | null;
  while ((m = s.match(/^round\(\s*(.+?)\s*,\s*\d+\s*\)$/i)) || (m = s.match(/^cast\(\s*(.+)\s+as\s+.+\)$/i))) s = m[1].trim();
  return s;
}
function splitTop(s: string, sep = ','): string[] {
  const out: string[] = []; let depth = 0, last = 0;
  for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '(') depth++; else if (c === ')') depth--; else if (c === sep && depth === 0) { out.push(s.slice(last, i)); last = i + 1; } }
  out.push(s.slice(last)); return out.map((x) => x.trim()).filter(Boolean);
}
function splitAlias(item: string): { expr: string; alias: string | null } {
  const m = item.match(/^(.*?)\s+as\s+(\w+)$/is); return m ? { expr: m[1].trim(), alias: m[2] } : { expr: item.trim(), alias: null };
}
function classifyAgg(expr: string, reg: TableEntry): { key: string; agg: Agg; column?: string } | null {
  const e = unwrapNum(expr); let m: RegExpMatchArray | null;
  if (/^count\(\s*\*\s*\)$/i.test(e)) return { key: 'count', agg: 'count' };
  if ((m = e.match(/^count\(\s*distinct\s+(\w+)\s*\)$/i))) {
    const mk = reg.metrics[`count_distinct:${m[1].toLowerCase()}`];
    if (!mk) refuse('unknown_metric', `count(distinct ${m[1]}) has no model metric`);
    return { key: mk, agg: 'count_distinct', column: m[1] };
  }
  if ((m = e.match(/^(sum|avg|min|max)\(\s*(\w+)\s*\)$/i))) {
    const agg = m[1].toLowerCase() as Agg, col = m[2].toLowerCase();
    const mk = reg.metrics[`${agg}:${col}`];
    if (!mk) refuse('unknown_metric', `${agg}(${col}) has no model metric`);
    return { key: mk, agg, column: col };
  }
  if (/\bcase\b/i.test(e)) refuse('case_measure', 'CASE expression in a measure (e.g. conditional ratio)');
  return null;
}

export function recognizeSql(sql: string): RecognizeResult {
  try {
    const raw = sql.trim();
    if (/\bunion\b/i.test(raw)) refuse('union', 'UNION (combines multiple tables/queries)');
    if (/\bjoin\b/i.test(raw)) refuse('join', 'explicit JOIN');
    if (/\bwith\b\s+\w+\s+as\s*\(/i.test(raw)) refuse('cte', 'CTE (WITH ...)');
    if (/\bover\s*\(/i.test(raw)) refuse('window', 'window function (OVER)');

    const mSel = raw.match(/^select\s+(.+?)\s+from\s+(\w+)\b/is);
    if (!mSel) refuse('parse_failed', 'could not parse SELECT ... FROM');
    const reg = INDEX[mSel![2].toLowerCase()];
    if (!reg) refuse('unknown_table', `unknown table "${mSel![2]}"`);

    const measures: { key: string; agg: Agg; column?: string }[] = [];
    let dimItem: string | null = null;
    for (const item of splitTop(mSel![1])) {
      const { expr } = splitAlias(item);
      const agg = classifyAgg(expr, reg);
      if (agg) { measures.push(agg); continue; }
      if (dimItem) refuse('detail_rows', 'projects multiple non-aggregated columns (detail row list, not a metric)');
      dimItem = expr;
    }
    if (measures.length === 0) refuse('detail_rows', 'no aggregate measure (detail row list, not a metric)');
    if (measures.length > 1) refuse('multi_measure', 'multiple measures — not supported in the builder yet');

    let dimension: BuilderQuery['dimension'];
    if (dimItem) {
      let col = dimItem; let grain: DateGrain | undefined; const sm = col.match(SUBSTR);
      if (sm) { col = sm[1]; grain = 'day'; }
      const d = reg.dims[col.toLowerCase()];
      if (!d) refuse('unknown_dimension', `group-by column "${col}" is not a model dimension`);
      dimension = grain ? { key: d.key, grain } : { key: d.key };
    }

    const query: BuilderQuery = { mode: 'builder', model: reg.model, metric: measures[0], filters: [] };
    if (dimension) query.dimension = dimension;
    return { ok: true, query };
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, code: e.code, reason: e.message };
    throw e;
  }
}
