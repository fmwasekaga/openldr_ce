import { type Kysely, sql, expressionBuilder, type SelectQueryBuilder } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { QueryModel, ModelDimension, ModelJoin } from './models/registry';
import { exposableColumns } from './models/registry';
import type { WidgetQuery, Metric, QueryFilter, DateGrain, ConditionNode, ConditionRule } from './types';
import type { ReportResultData, ReportColumn, ChartHint } from '@openldr/reporting';
import { ageBandArms } from './age-band';

type BuilderQuery = Extract<WidgetQuery, { mode: 'builder' }>;
type AnyQB = SelectQueryBuilder<ExternalSchema, keyof ExternalSchema, unknown>;

function hasMeasure(q: BuilderQuery): boolean {
  return !!q.metric || !!(q.metrics && q.metrics.length > 0);
}

function dim(model: QueryModel, key: string): ModelDimension {
  const d = model.dimensions.find((x) => x.key === key);
  if (!d) throw new Error(`unknown dimension: ${key}`);
  return d;
}

/** LIKE pattern for a `contains` match, escaping % _ \ so they're literal. */
function likePattern(value: unknown): string {
  return `%${String(value).replace(/[%_\\]/g, '\\$&')}%`;
}

// A dimension's column ref string: joined dims → "alias"."col"; base dims → qualified only when a join is active.
function colName(model: QueryModel, dimKey: string, qualify: boolean): string {
  const d = dim(model, dimKey);
  if (d.join) return `${d.join}.${d.column}`;
  return qualify ? `${model.table}.${d.column}` : d.column;
}
// A raw base-table column (metric columns): qualified only when a join is active.
function baseCol(model: QueryModel, col: string, qualify: boolean): string {
  return qualify ? `${model.table}.${col}` : col;
}

/** A portable boolean SQL fragment for a metric's conditional predicate (ANDed). */
function condExpr(model: QueryModel, where: QueryFilter[], qualify: boolean) {
  const frags: ReturnType<typeof sql> [] = [];
  for (const f of where) {
    if (f.value === null) continue;
    const ref = sql.ref(colName(model, f.dimension, qualify)); // throws on unknown dimension (via dim in colName)
    switch (f.op) {
      case 'eq': frags.push(sql`${ref} = ${f.value}`); break;
      case 'in': {
        const arr = Array.isArray(f.value) ? f.value : [f.value];
        frags.push(sql`${ref} in (${sql.join(arr)})`);
        break;
      }
      case 'contains': frags.push(sql`${ref} like ${likePattern(f.value)}`); break;
      case 'gte': frags.push(sql`${ref} >= ${f.value}`); break;
      case 'lte': frags.push(sql`${ref} <= ${f.value}`); break;
      case 'between':
        if (Array.isArray(f.value) && f.value.length === 2) {
          frags.push(sql`(${ref} >= ${f.value[0]} and ${ref} <= ${f.value[1]})`);
        }
        break;
    }
  }
  if (frags.length === 0) return sql<boolean>`1=1`;
  return sql<boolean>`(${sql.join(frags, sql` and `)})`;
}

function metricExpr(model: QueryModel, m: Metric, qualify: boolean) {
  const cond = m.where && m.where.length ? condExpr(model, m.where, qualify) : null;
  if (m.agg === 'count') {
    return cond ? sql<number>`sum(case when ${cond} then 1 else 0 end)` : sql<number>`count(*)`;
  }
  if (!m.column) throw new Error(`metric ${m.agg} requires a column`);
  const knownAsDimension = model.dimensions.some((d) => d.column === m.column);
  const knownAsMetric = model.metrics.some((x) => x.column === m.column);
  if (!knownAsDimension && !knownAsMetric) throw new Error(`unknown metric column: ${m.column}`);
  const col = sql.ref(baseCol(model, m.column, qualify));
  switch (m.agg) {
    case 'count_distinct': return cond ? sql<number>`count(distinct case when ${cond} then ${col} else null end)` : sql<number>`count(distinct ${col})`;
    case 'sum': return cond ? sql<number>`sum(case when ${cond} then ${col} else 0 end)` : sql<number>`sum(${col})`;
    case 'avg': return cond ? sql<number>`avg(case when ${cond} then ${col} else null end)` : sql<number>`avg(${col})`;
    case 'min': return cond ? sql<number>`min(case when ${cond} then ${col} else null end)` : sql<number>`min(${col})`;
    case 'max': return cond ? sql<number>`max(case when ${cond} then ${col} else null end)` : sql<number>`max(${col})`;
    default: throw new Error(`unsupported agg: ${m.agg}`);
  }
}

// Portable date grain bucketing happens in JS (repo convention: math in JS, not dialect SQL).
function grainKey(value: unknown, grain: DateGrain): string {
  const s = String(value ?? '');
  const d = s.slice(0, 10); // YYYY-MM-DD
  if (grain === 'year') return d.slice(0, 4);
  if (grain === 'month') return d.slice(0, 7);
  if (grain === 'day') return d;
  if (grain === 'week') {
    const dt = new Date(d + 'T00:00:00Z');
    if (isNaN(dt.getTime())) return 'invalid';
    const day = dt.getUTCDay();
    dt.setUTCDate(dt.getUTCDate() - day);
    return dt.toISOString().slice(0, 10);
  }
  return d;
}

function applyFilters(qb: AnyQB, model: QueryModel, filters: QueryFilter[], qualify: boolean): AnyQB {
  let q = qb;
  for (const f of filters) {
    if (f.value === null) continue;
    const ref = colName(model, f.dimension, qualify) as never;
    switch (f.op) {
      case 'eq': q = q.where(ref, '=', f.value as never); break;
      case 'in': q = q.where(ref, 'in', (Array.isArray(f.value) ? f.value : [f.value]) as never); break;
      case 'contains': {
        q = q.where(ref, 'like', likePattern(f.value) as never);
        break;
      }
      case 'gte': q = q.where(ref, '>=', f.value as never); break;
      case 'lte': q = q.where(ref, '<=', f.value as never); break;
      case 'between':
        if (Array.isArray(f.value) && f.value.length === 2) {
          q = q.where(ref, '>=', f.value[0] as never).where(ref, '<=', f.value[1] as never);
        }
        break;
    }
  }
  return q;
}

// Compile one rule to a Kysely expression, mirroring applyFilters' operator logic.
function compileRule(eb: any, model: QueryModel, rule: ConditionRule, qualify: boolean): any {
  const ref = colName(model, rule.dimension, qualify) as never;
  const v = rule.value;
  switch (rule.op) {
    case 'in': return eb(ref, 'in', (Array.isArray(v) ? v : [v]) as never);
    case 'contains': return eb(ref, 'like', likePattern(v) as never);
    case 'gte': return eb(ref, '>=', v as never);
    case 'lte': return eb(ref, '<=', v as never);
    case 'between':
      return Array.isArray(v) && v.length === 2
        ? eb.and([eb(ref, '>=', v[0] as never), eb(ref, '<=', v[1] as never)])
        : null;
    case 'eq':
    default: return eb(ref, '=', v as never);
  }
}

// Compile a node; returns null for an empty group (no rule descendants) so callers can skip it.
function compileNode(eb: any, model: QueryModel, node: ConditionNode, qualify: boolean): any {
  if (node.kind === 'rule') return node.value === null ? null : compileRule(eb, model, node, qualify);
  const parts = node.children.map((c) => compileNode(eb, model, c, qualify)).filter((p: any) => p != null);
  if (parts.length === 0) return null;
  return node.combinator === 'or' ? eb.or(parts) : eb.and(parts);
}

// Build label + rank CASE expressions for a computed age-band dimension, thresholds bound (not inlined).
function ageBandExprs(d: ModelDimension, reference?: string) {
  const parsed = reference ? new Date(reference) : new Date();
  const ref = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const a = ageBandArms(d.compute!, ref);
  const col = sql.ref(d.column);
  let label = sql`case when ${col} is null then ${a.unknownLabel} when ${col} > ${a.refYMD} then ${a.unknownLabel}`;
  let rank = sql`case when ${col} is null then ${a.unknownRank} when ${col} > ${a.refYMD} then ${a.unknownRank}`;
  for (const arm of a.arms) {
    label = sql`${label} when ${col} > ${arm.thresholdYMD} then ${arm.label}`;
    rank = sql`${rank} when ${col} > ${arm.thresholdYMD} then ${arm.rank}`;
  }
  label = sql`${label} else ${a.openEndedLabel} end`;
  rank = sql`${rank} else ${a.openEndedRank} end`;
  return { label, rank };
}

/**
 * Fold a query's ad-hoc join columns into the model as real dimensions, so the rest of the compiler
 * (dim/colName/collectUsedJoins → leftJoin) treats them like any joined dimension. Validates each
 * ad-hoc dim against the optional-join + denylist rules — this is the server-side guard that stops a
 * hand-edited widget JSON from exposing a denied or foreign column. No-op (returns the same model)
 * when the query has no ad-hoc dimensions.
 */
export function effectiveModel(model: QueryModel, q: BuilderQuery): QueryModel {
  const adhoc = q.adhocDimensions ?? [];
  if (adhoc.length === 0) return model;
  const existing = new Set(model.dimensions.map((d) => d.key));
  const extra: ModelDimension[] = [];
  for (const a of adhoc) {
    const j = (model.joins ?? []).find((x) => x.alias === a.join);
    if (!j || !j.optional) throw new Error(`adhoc dimension ${a.key}: unknown or non-optional join: ${a.join}`);
    if (!exposableColumns(model, a.join).includes(a.column)) {
      throw new Error(`adhoc dimension ${a.key}: column not exposable: ${a.column}`);
    }
    // idempotent: safe to call on an already-merged model. A collision with a REAL model dimension key
    // is also intentionally skipped — the trusted base dimension wins (fail-safe; an adhoc dim can never shadow it).
    if (existing.has(a.key)) continue;
    extra.push({ key: a.key, label: a.label, column: a.column, kind: a.kind, join: a.join });
    existing.add(a.key);
  }
  return extra.length ? { ...model, dimensions: [...model.dimensions, ...extra] } : model;
}

// Distinct joins referenced by any dimension the query uses (dimension/breakdown/filters/filterTree/metric-where).
export function collectUsedJoins(model: QueryModel, q: BuilderQuery): ModelJoin[] {
  const aliases = new Set<string>();
  const add = (dimKey?: string) => { if (!dimKey) return; const d = model.dimensions.find((x) => x.key === dimKey); if (d?.join) aliases.add(d.join); };
  add(q.dimension?.key);
  add(q.breakdown?.key);
  for (const f of q.filters ?? []) add(f.dimension);
  const walk = (node?: ConditionNode) => { if (!node) return; if (node.kind === 'rule') add(node.dimension); else node.children.forEach(walk); };
  walk(q.filterTree);
  for (const m of [q.metric, ...(q.metrics ?? [])]) { if (!m) continue; for (const w of m.where ?? []) add(w.dimension); }
  return [...aliases].map((a) => {
    const j = (model.joins ?? []).find((x) => x.alias === a);
    if (!j) throw new Error(`unknown join alias: ${a}`);
    return j;
  });
}

/** Build the Kysely query (no grain bucketing — date grain is applied in JS after fetch). */
export function compileBuilderQuery(db: Kysely<ExternalSchema>, model: QueryModel, q: BuilderQuery): AnyQB {
  model = effectiveModel(model, q);
  const wide = !!(q.metrics && q.metrics.length > 0);
  let qb = db.selectFrom(model.table) as unknown as AnyQB;
  const usedJoins = collectUsedJoins(model, q);
  const qualify = usedJoins.length > 0;
  for (const j of usedJoins) {
    const left = j.leftReplace
      ? sql`replace(${sql.ref(`${model.table}.${j.left}`)}, ${j.leftReplace[0]}, ${j.leftReplace[1]})`
      : sql.ref(`${model.table}.${j.left}`);
    qb = qb.leftJoin(`${j.table} as ${j.alias}` as never, (jb: any) => jb.on(sql`${left} = ${sql.ref(`${j.alias}.${j.right}`)}` as never)) as AnyQB;
  }
  if (wide) {
    if (q.breakdown) throw new Error('multi-metric (wide) queries cannot use a breakdown');
    const aggKeys = new Set(q.metrics!.filter((m) => !m.derived).map((m) => m.key));
    const seen = new Set<string>();
    for (const m of q.metrics!) {
      if (seen.has(m.key)) throw new Error(`duplicate metric key: ${m.key}`);
      seen.add(m.key);
      if (m.derived) {
        for (const ref of [m.derived.numerator, m.derived.denominator]) {
          if (!aggKeys.has(ref)) throw new Error(`derived metric ${m.key} references unknown metric: ${ref}`);
        }
        continue; // derived metrics are computed post-aggregation, not selected in SQL
      }
      qb = qb.select(metricExpr(model, m, qualify).as(m.key));
    }
  } else if (q.metric) {
    qb = qb.select(metricExpr(model, q.metric, qualify).as('value'));
  } else {
    qb = qb.select(sql<number>`0`.as('value')); // no measure: valid but trivial SQL for preview
  }
  if (q.dimension) {
    const d = dim(model, q.dimension.key);
    if (d.compute) {
      const { label, rank } = ageBandExprs(d, q.dimension.reference);
      // GROUP BY both label + rank so ORDER BY rank is a grouped expression on strict engines
      // (Postgres/MSSQL reject ORDER BY an ungrouped expression). rank is 1:1 with label → same groups.
      qb = qb.select(label.as('label') as never).groupBy(label as never).groupBy(rank as never).orderBy(rank as never);
    } else {
      const ref = colName(model, q.dimension.key, qualify);
      qb = qb.select(sql.ref(ref).as('label')).groupBy(ref as never).orderBy(ref as never);
    }
  }
  if (!wide && q.breakdown) {
    const b = dim(model, q.breakdown.key);
    if (b.compute) {
      const { label, rank } = ageBandExprs(b, undefined); // breakdown has no reference → current date
      qb = qb.select(label.as('series') as never).groupBy(label as never).groupBy(rank as never).orderBy(rank as never);
    } else {
      const ref = colName(model, q.breakdown.key, qualify);
      qb = qb.select(sql.ref(ref).as('series')).groupBy(ref as never).orderBy(ref as never);
    }
  }
  if (q.filterTree) {
    // Compile the tree once; apply only if it yields a predicate (an all-null/empty tree adds none).
    const eb = expressionBuilder(qb as never) as never;
    const expr = compileNode(eb, model, q.filterTree, qualify);
    if (expr) qb = qb.where(expr as never) as AnyQB;
  } else {
    qb = applyFilters(qb, model, q.filters ?? [], qualify);
  }
  return qb;
}

/** Derived ratio: numerator/denominator × scale, rounded to `decimals`; div-by-zero → 0. */
function ratio(d: NonNullable<Metric['derived']>, row: Record<string, unknown>): number {
  const den = Number(row[d.denominator] ?? 0);
  if (!den) return 0;
  const v = (Number(row[d.numerator] ?? 0) / den) * d.scale;
  const f = 10 ** d.decimals;
  return Math.round(v * f) / f;
}

/** Top-N of shaped rows: by label-total when a breakdown splits rows, else by the measure value. */
function applyTopN(
  rows: Record<string, unknown>[], limit: number | undefined, valueKey: string, hasBreakdown: boolean,
): Record<string, unknown>[] {
  if (!limit || rows.length <= limit) return rows;
  if (hasBreakdown) {
    const totals = new Map<unknown, number>();
    for (const r of rows) totals.set(r.label, (totals.get(r.label) ?? 0) + Number(r[valueKey] ?? 0));
    const keep = new Set([...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([l]) => l));
    return rows.filter((r) => keep.has(r.label));
  }
  return [...rows].sort((a, b) => Number(b[valueKey] ?? 0) - Number(a[valueKey] ?? 0)).slice(0, limit);
}

/** Shape a multi-metric (wide) query into a table: label + one column per metric (aggregate or derived). */
async function runWideQuery(
  db: Kysely<ExternalSchema>, model: QueryModel, q: BuilderQuery,
): Promise<ReportResultData> {
  model = effectiveModel(model, q);
  const metrics = q.metrics!;
  const aggKeys = metrics.filter((m) => !m.derived).map((m) => m.key);
  const derivedMetrics = metrics.filter((m) => m.derived);
  const rows = (await compileBuilderQuery(db, model, q).execute()) as Record<string, unknown>[];
  const d = q.dimension ? dim(model, q.dimension.key) : undefined;

  let shaped: Record<string, unknown>[];
  if (d && d.kind === 'date' && q.dimension?.grain) {
    const buckets = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const bk = grainKey(r.label, q.dimension.grain);
      const acc = buckets.get(bk) ?? Object.fromEntries(aggKeys.map((k) => [k, 0]));
      for (const k of aggKeys) acc[k] += Number(r[k] ?? 0);
      buckets.set(bk, acc);
    }
    shaped = [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([label, acc]) => ({ label, ...acc }));
  } else if (d) {
    shaped = rows.map((r) => {
      const out: Record<string, unknown> = { label: r.label ?? '(none)' };
      for (const k of aggKeys) out[k] = Number(r[k] ?? 0);
      return out;
    });
  } else {
    const out: Record<string, unknown> = { label: model.label };
    for (const k of aggKeys) out[k] = Number(rows[0]?.[k] ?? 0);
    shaped = [out];
  }

  // Derived (ratio) metrics: computed per output row, after aggregate values are final.
  for (const row of shaped) {
    for (const m of derivedMetrics) row[m.key] = ratio(m.derived!, row);
  }
  shaped = applyTopN(shaped, q.limit, aggKeys[0] ?? 'label', false);

  const columns: ReportColumn[] = [
    { key: 'label', label: d?.label ?? model.label, kind: d?.kind === 'date' ? 'date' : 'string' },
    ...metrics.map((m) => ({
      key: m.key, label: m.label ?? m.key,
      kind: (m.derived && m.derived.scale === 100 ? 'percent' : 'number') as 'percent' | 'number',
      ...(m.derived ? { decimals: m.derived.decimals } : {}),
    })),
  ];
  const chart: ChartHint = { type: 'bar', x: 'label', y: aggKeys[0] ?? 'label' };
  return { columns, rows: shaped, chart };
}

/** Execute and shape into ReportResultData, applying date-grain bucketing in JS. */
export async function runBuilderQuery(
  db: Kysely<ExternalSchema>, model: QueryModel, q: BuilderQuery,
): Promise<ReportResultData> {
  model = effectiveModel(model, q);
  if (!hasMeasure(q)) return { columns: [], rows: [], chart: { type: 'stat', value: '', label: 'No measure' } };
  if (q.metrics && q.metrics.length > 0) return runWideQuery(db, model, q);
  const rows = (await compileBuilderQuery(db, model, q).execute()) as { value: number; label?: unknown; series?: unknown }[];
  const d = q.dimension ? dim(model, q.dimension.key) : undefined;

  if (q.breakdown) {
    const b = dim(model, q.breakdown.key);
    let shaped: Record<string, unknown>[];
    if (d && d.kind === 'date' && q.dimension?.grain) {
      const buckets = new Map<string, number>();
      for (const r of rows) {
        const key = `${grainKey(r.label, q.dimension.grain)}\0${String(r.series ?? '(none)')}`;
        buckets.set(key, (buckets.get(key) ?? 0) + Number(r.value ?? 0));
      }
      shaped = [...buckets.entries()].sort((a, b2) => (a[0] < b2[0] ? -1 : 1)).map(([key, value]) => {
        const [label, series] = key.split('\0');
        return { label, series, value };
      });
    } else {
      shaped = rows.map((r) => ({ label: r.label ?? '(none)', series: String(r.series ?? '(none)'), value: Number(r.value ?? 0) }));
    }
    shaped = applyTopN(shaped, q.limit, 'value', true);
    const columns: ReportColumn[] = [
      { key: 'label', label: d?.label ?? model.label, kind: d?.kind === 'date' ? 'date' : 'string' },
      { key: 'series', label: b.label, kind: 'string' },
      { key: 'value', label: q.metric?.label ?? 'Value', kind: 'number' },
    ];
    return { columns, rows: shaped, chart: { type: 'bar', x: 'label', y: 'value' } };
  }

  let shaped: Record<string, unknown>[];
  if (d && d.kind === 'date' && q.dimension?.grain) {
    const buckets = new Map<string, number>();
    for (const r of rows) {
      const key = grainKey(r.label, q.dimension.grain);
      buckets.set(key, (buckets.get(key) ?? 0) + Number(r.value ?? 0));
    }
    shaped = [...buckets.entries()].sort((a, b2) => (a[0] < b2[0] ? -1 : 1)).map(([label, value]) => ({ label, value }));
  } else if (d) {
    shaped = rows.map((r) => ({ label: r.label ?? '(none)', value: Number(r.value ?? 0) }));
  } else {
    shaped = [{ label: model.label, value: Number(rows[0]?.value ?? 0) }];
  }
  shaped = applyTopN(shaped, q.limit, 'value', false);
  const columns: ReportColumn[] = [
    { key: 'label', label: d?.label ?? model.label, kind: d?.kind === 'date' ? 'date' : 'string' },
    { key: 'value', label: q.metric?.label ?? 'Value', kind: 'number' },
  ];
  const chart: ChartHint = d
    ? { type: 'bar', x: 'label', y: 'value' }
    : { type: 'stat', value: String(shaped[0]?.value ?? 0), label: model.label };
  return { columns, rows: shaped, chart };
}
