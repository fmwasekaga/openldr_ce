import type { WidgetQuery, Agg } from './types';
import { listModels } from './models/registry';

type BuilderQuery = Extract<WidgetQuery, { mode: 'builder' }>;
export type RecognizeCode =
  | 'union' | 'join' | 'cte' | 'window' | 'case_measure' | 'multi_measure'
  | 'detail_rows' | 'unknown_table' | 'unknown_dimension' | 'unknown_metric'
  | 'unrecognized_predicate' | 'not_null_unsupported' | 'parse_failed'
  | 'order_by_unsupported';
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
function splitTopRe(s: string, sep: RegExp): string[] {
  const out: string[] = []; let last = 0; let m: RegExpExecArray | null; sep.lastIndex = 0;
  const balanced = (t: string) => (t.match(/\(/g)?.length ?? 0) === (t.match(/\)/g)?.length ?? 0);
  while ((m = sep.exec(s))) { if (balanced(s.slice(last, m.index))) { out.push(s.slice(last, m.index)); last = sep.lastIndex; } }
  out.push(s.slice(last)); return out.map((x) => x.trim()).filter(Boolean);
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

const clean = (v: string): string => v.trim().replace(/^'(.*)'$/s, '$1');
function resolveDim(rawCol: string, reg: TableEntry): { key: string } {
  let col = rawCol.trim(); const sm = col.match(SUBSTR); if (sm) col = sm[1];
  const d = reg.dims[col.toLowerCase()];
  if (!d) refuse('unknown_dimension', `filter column "${col}" is not a model dimension`);
  return { key: d!.key };
}

export function recognizeSql(sql: string): RecognizeResult {
  try {
    const raw0 = sql.trim();
    if (/\bunion\b/i.test(raw0)) refuse('union', 'UNION (combines multiple tables/queries)');
    if (/\bjoin\b/i.test(raw0)) refuse('join', 'explicit JOIN');
    if (/\bwith\b\s+\w+\s+as\s*\(/i.test(raw0)) refuse('cte', 'CTE (WITH ...)');
    if (/\bover\s*\(/i.test(raw0)) refuse('window', 'window function (OVER)');

    let limit: number | undefined;
    const raw = raw0
      .replace(/offset\s+\d+\s+rows\s+fetch\s+next\s+(\d+)\s+rows\s+only/i, (_, n) => { limit = +n; return ''; })
      .replace(/\blimit\s+(\d+)/i, (_, n) => { limit = +n; return ''; });

    const optional: string[] = [];
    const body = raw.replace(/\[\[(.*?)\]\]/gs, (_, inner) => { optional.push(inner.trim()); return ' '; });

    const mSel = body.match(/^select\s+(.+?)\s+from\s+(\w+)\b/is);
    if (!mSel) refuse('parse_failed', 'could not parse SELECT ... FROM');
    const reg = INDEX[mSel![2].toLowerCase()];
    if (!reg) refuse('unknown_table', `unknown table "${mSel![2]}"`);

    const measures: { key: string; agg: string; column?: string }[] = [];
    let dimItem: string | null = null;
    let measureAlias = 'value';
    for (const item of splitTop(mSel![1])) {
      const { expr, alias } = splitAlias(item);
      const agg = classifyAgg(expr, reg!);
      if (agg) { if (alias && measures.length === 0) measureAlias = alias; measures.push(agg); continue; }
      if (dimItem) refuse('detail_rows', 'projects multiple non-aggregated columns (detail row list, not a metric)');
      dimItem = expr;
    }
    if (measures.length === 0) refuse('detail_rows', 'no aggregate measure (detail row list, not a metric)');

    let dimension: BuilderQuery['dimension']; let groupCol: string | undefined;
    if (dimItem) {
      let col = dimItem; let grain: string | undefined; const sm = col.match(SUBSTR);
      if (sm) { col = sm[1]; grain = 'day'; }
      groupCol = col.toLowerCase();
      const d = reg!.dims[groupCol];
      if (!d) refuse('unknown_dimension', `group-by column "${col}" is not a model dimension`);
      dimension = grain ? { key: d!.key, grain: grain as never } : { key: d!.key };
    }

    const whereM = body.match(/\bwhere\s+(.+?)(?:\s+group\s+by|\s+order\s+by|\s*$)/is);
    const preds: string[] = [];
    if (whereM) for (const p of splitTopRe(whereM[1], /\band\b/gi)) preds.push(p.trim());
    for (const o of optional) preds.push(o.replace(/^and\s+/i, '').trim());

    const filters: NonNullable<BuilderQuery['filters']> = [];
    for (const p of preds) {
      if (/^1\s*=\s*1$/.test(p)) continue;
      let m: RegExpMatchArray | null;
      if ((m = p.match(/^(.+?)\s+is\s+not\s+null$/i))) {
        const col = m[1].trim().toLowerCase();
        if (col === groupCol) continue; // builder shows group-by nulls as (none); other not-nulls change aggregates → refuse
        refuse('not_null_unsupported', `IS NOT NULL on "${col}"`);
      } else if ((m = p.match(/^(.+?)\s+in\s*\((.+)\)$/i))) {
        filters.push({ dimension: resolveDim(m[1], reg!).key, op: 'in', value: splitTop(m[2]).map(clean) });
      } else if ((m = p.match(/^(.+?)\s*(>=|<=|=)\s*(.+)$/))) {
        const op = m[2] === '>=' ? 'gte' : m[2] === '<=' ? 'lte' : 'eq';
        filters.push({ dimension: resolveDim(m[1], reg!).key, op, value: clean(m[3]) });
      } else refuse('unrecognized_predicate', `unrecognized predicate: "${p}"`);
    }

    if (limit != null) {
      const orderM = body.match(/order\s+by\s+(.+?)\s*$/i);
      if (orderM) {
        const firstTerm = splitTop(orderM[1])[0] ?? '';
        const orderCol = firstTerm.replace(/\s+(asc|desc)\s*$/i, '').trim();
        if (orderCol.toLowerCase() !== measureAlias.toLowerCase()) {
          refuse('order_by_unsupported', 'ORDER BY on a non-measure column combined with a row limit — top-N would change meaning');
        }
      }
    }

    const query: BuilderQuery = { mode: 'builder', model: reg!.model, metric: measures[0] as never, filters };
    if (measures.length > 1) query.metrics = measures as never;
    if (dimension) query.dimension = dimension;
    if (limit != null) query.limit = limit;
    return { ok: true, query };
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, code: e.code, reason: e.message };
    throw e;
  }
}
