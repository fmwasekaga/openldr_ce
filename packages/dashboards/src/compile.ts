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

function metricExpr(model: QueryModel, m: Metric) {
  if (m.agg === 'count') return sql<number>`count(*)`;
  if (!m.column) throw new Error(`metric ${m.agg} requires a column`);
  const knownAsDimension = model.dimensions.some((d) => d.column === m.column);
  const knownAsMetric = model.metrics.some((x) => x.column === m.column);
  if (!knownAsDimension && !knownAsMetric) throw new Error(`unknown metric column: ${m.column}`);
  const col = sql.ref(m.column);
  switch (m.agg) {
    case 'count_distinct': return sql<number>`count(distinct ${col})`;
    case 'sum': return sql<number>`sum(${col})`;
    case 'avg': return sql<number>`avg(${col})`;
    case 'min': return sql<number>`min(${col})`;
    case 'max': return sql<number>`max(${col})`;
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
        const escaped = String(f.value).replace(/[%_\\]/g, '\\$&');
        q = q.where(ref, 'like', `%${escaped}%` as never);
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
  const expr = metricExpr(model, q.metric); // validates + builds
  let qb = db.selectFrom(model.table) as unknown as AnyQB;
  qb = qb.select(expr.as('value'));
  if (q.dimension) {
    const d = dim(model, q.dimension.key);
    qb = qb.select(sql.ref(d.column).as('label')).groupBy(d.column as never).orderBy(d.column as never);
  }
  qb = applyFilters(qb, model, q.filters ?? []);
  return qb;
}

/** Execute and shape into ReportResultData, applying date-grain bucketing in JS. */
export async function runBuilderQuery(
  db: Kysely<ExternalSchema>, model: QueryModel, q: BuilderQuery,
): Promise<ReportResultData> {
  const rows = (await compileBuilderQuery(db, model, q).execute()) as { value: number; label?: unknown }[];
  const d = q.dimension ? dim(model, q.dimension.key) : undefined;

  let shaped: Record<string, unknown>[];
  if (d && d.kind === 'date' && q.dimension?.grain) {
    const buckets = new Map<string, number>();
    for (const r of rows) {
      const key = grainKey(r.label, q.dimension.grain);
      buckets.set(key, (buckets.get(key) ?? 0) + Number(r.value ?? 0));
    }
    shaped = [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([label, value]) => ({ label, value }));
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
