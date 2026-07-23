// Pure state-transition helpers for the Summarize measures list. A row is a schema Metric; a list of
// one non-derived row compiles to the single `metric` field, more than one to `metrics[]` (wide table).
// Kept free of React/DOM for unit-testing — see MeasuresEditor.tsx.

export type Measure = {
  key: string; label?: string; agg: string; column?: string;
  where?: { dimension: string; op: string; value: unknown }[];
  derived?: { numerator: string; denominator: string; scale: number; decimals: number };
};

/** `base`, then `base-2`, `base-3`, … until it doesn't collide with an existing key. */
export function uniqueKey(list: Measure[], base: string): string {
  const keys = new Set(list.map((m) => m.key));
  if (!keys.has(base)) return base;
  let n = 2;
  while (keys.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function addMeasure(list: Measure[], model: { metrics: { key: string; label: string; agg: string; column?: string }[] }): Measure[] {
  const m = model.metrics[0] ?? { key: 'count', label: 'Count', agg: 'count' };
  const key = uniqueKey(list, m.key);
  const next: Measure = { key, label: m.label, agg: m.agg };
  if (m.column) next.column = m.column;
  return [...list, next];
}

export function addFormula(list: Measure[]): Measure[] {
  const aggs = aggregateMeasures(list);
  const key = uniqueKey(list, 'ratio');
  return [...list, {
    key, label: 'Ratio', agg: 'count', // agg is an unused placeholder for a derived row (schema requires it)
    derived: { numerator: aggs[0]?.key ?? '', denominator: aggs[1]?.key ?? '', scale: 100, decimals: 1 },
  }];
}

export function updateMeasure(list: Measure[], i: number, patch: Partial<Measure>): Measure[] {
  return list.map((m, j) => (j === i ? { ...m, ...patch } : m));
}

export function removeMeasure(list: Measure[], i: number): Measure[] {
  const removed = list[i]?.key;
  return list
    .filter((_, j) => j !== i)
    .map((m) => {
      if (!m.derived || !removed) return m;
      const d = { ...m.derived };
      if (d.numerator === removed) d.numerator = '';
      if (d.denominator === removed) d.denominator = '';
      return { ...m, derived: d };
    });
}

export function aggregateMeasures(list: Measure[]): Measure[] {
  return list.filter((m) => !m.derived);
}

export function toBuilderMetrics(list: Measure[]): { metric?: Measure; metrics?: Measure[] } {
  const firstAggregate = aggregateMeasures(list)[0] ?? list[0];
  // Only a single NON-derived row collapses to the scalar `metric`. A derived (formula) row is
  // computed post-aggregation from sibling measures and needs the wide `metrics[]` path — so any
  // list that contains a formula stays wide, even a lone formula row. Collapsing a derived row to
  // `metric` would render its placeholder `agg` (COUNT(*)) mislabeled as the ratio.
  if (list.length <= 1 && !list.some((m) => m.derived)) return { metric: list[0], metrics: undefined };
  return { metric: firstAggregate, metrics: list };
}
