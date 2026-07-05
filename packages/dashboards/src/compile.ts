import { type Kysely, sql, type SelectQueryBuilder } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { QueryModel, ModelDimension } from './models/registry';
import type { WidgetQuery, Metric, QueryFilter, DateGrain } from './types';
import type { ReportResultData, ReportColumn, ChartHint } from '@openldr/reporting';

type BuilderQuery = Extract<WidgetQuery, { mode: 'builder' }>;
type AnyQB = SelectQueryBuilder<ExternalSchema, keyof ExternalSchema, unknown>;

function dim(model: QueryModel, key: string): ModelDimension {
  const d = model.dimensions.find((x) => x.key === key);
  if (!d) throw new Error(`unknown dimension: ${key}`);
  return d;
}

/** LIKE pattern for a `contains` match, escaping % _ \ so they're literal. */
function likePattern(value: unknown): string {
  return `%${String(value).replace(/[%_\\]/g, '\\$&')}%`;
}

/** A portable boolean SQL fragment for a metric's conditional predicate (ANDed). */
function condExpr(model: QueryModel, where: QueryFilter[]) {
  const frags: ReturnType<typeof sql> [] = [];
  for (const f of where) {
    if (f.value === null) continue;
    const d = dim(model, f.dimension); // throws on unknown dimension
    const ref = sql.ref(d.column);
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

function metricExpr(model: QueryModel, m: Metric) {
  const cond = m.where && m.where.length ? condExpr(model, m.where) : null;
  if (m.agg === 'count') {
    return cond ? sql<number>`sum(case when ${cond} then 1 else 0 end)` : sql<number>`count(*)`;
  }
  if (!m.column) throw new Error(`metric ${m.agg} requires a column`);
  const knownAsDimension = model.dimensions.some((d) => d.column === m.column);
  const knownAsMetric = model.metrics.some((x) => x.column === m.column);
  if (!knownAsDimension && !knownAsMetric) throw new Error(`unknown metric column: ${m.column}`);
  const col = sql.ref(m.column);
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

function applyFilters(qb: AnyQB, model: QueryModel, filters: QueryFilter[]): AnyQB {
  let q = qb;
  for (const f of filters) {
    if (f.value === null) continue;
    const d = dim(model, f.dimension);
    const ref = d.column as never;
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

/** Build the Kysely query (no grain bucketing — date grain is applied in JS after fetch). */
export function compileBuilderQuery(db: Kysely<ExternalSchema>, model: QueryModel, q: BuilderQuery): AnyQB {
  const wide = !!(q.metrics && q.metrics.length > 0);
  let qb = db.selectFrom(model.table) as unknown as AnyQB;
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
      qb = qb.select(metricExpr(model, m).as(m.key));
    }
  } else {
    qb = qb.select(metricExpr(model, q.metric).as('value'));
  }
  if (q.dimension) {
    const d = dim(model, q.dimension.key);
    qb = qb.select(sql.ref(d.column).as('label')).groupBy(d.column as never).orderBy(d.column as never);
  }
  if (!wide && q.breakdown) {
    const b = dim(model, q.breakdown.key);
    qb = qb.select(sql.ref(b.column).as('series')).groupBy(b.column as never).orderBy(b.column as never);
  }
  qb = applyFilters(qb, model, q.filters ?? []);
  return qb;
}

/** Shape a multi-metric (wide) query into a table: label + one numeric column per metric. */
async function runWideQuery(
  db: Kysely<ExternalSchema>, model: QueryModel, q: BuilderQuery,
): Promise<ReportResultData> {
  const metrics = q.metrics!;
  const keys = metrics.map((m) => m.key);
  const rows = (await compileBuilderQuery(db, model, q).execute()) as Record<string, unknown>[];
  const d = q.dimension ? dim(model, q.dimension.key) : undefined;

  let shaped: Record<string, unknown>[];
  if (d && d.kind === 'date' && q.dimension?.grain) {
    const buckets = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const bk = grainKey(r.label, q.dimension.grain);
      const acc = buckets.get(bk) ?? Object.fromEntries(keys.map((k) => [k, 0]));
      for (const k of keys) acc[k] += Number(r[k] ?? 0);
      buckets.set(bk, acc);
    }
    shaped = [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([label, acc]) => ({ label, ...acc }));
  } else if (d) {
    shaped = rows.map((r) => {
      const out: Record<string, unknown> = { label: r.label ?? '(none)' };
      for (const k of keys) out[k] = Number(r[k] ?? 0);
      return out;
    });
  } else {
    const out: Record<string, unknown> = { label: model.label };
    for (const k of keys) out[k] = Number(rows[0]?.[k] ?? 0);
    shaped = [out];
  }

  const columns: ReportColumn[] = [
    { key: 'label', label: d?.label ?? model.label, kind: d?.kind === 'date' ? 'date' : 'string' },
    ...metrics.map((m) => ({ key: m.key, label: m.label ?? m.key, kind: 'number' as const })),
  ];
  const chart: ChartHint = { type: 'bar', x: 'label', y: keys[0] ?? 'label' };
  return { columns, rows: shaped, chart };
}

/** Execute and shape into ReportResultData, applying date-grain bucketing in JS. */
export async function runBuilderQuery(
  db: Kysely<ExternalSchema>, model: QueryModel, q: BuilderQuery,
): Promise<ReportResultData> {
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
    const columns: ReportColumn[] = [
      { key: 'label', label: d?.label ?? model.label, kind: d?.kind === 'date' ? 'date' : 'string' },
      { key: 'series', label: b.label, kind: 'string' },
      { key: 'value', label: q.metric.label ?? 'Value', kind: 'number' },
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
  const columns: ReportColumn[] = [
    { key: 'label', label: d?.label ?? model.label, kind: d?.kind === 'date' ? 'date' : 'string' },
    { key: 'value', label: q.metric.label ?? 'Value', kind: 'number' },
  ];
  const chart: ChartHint = d
    ? { type: 'bar', x: 'label', y: 'value' }
    : { type: 'stat', value: String(shaped[0]?.value ?? 0), label: model.label };
  return { columns, rows: shaped, chart };
}
