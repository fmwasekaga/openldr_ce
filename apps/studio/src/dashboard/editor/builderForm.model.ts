// Pure state-transition helpers for the builder-mode WidgetQuery. Kept free of React/DOM so
// they're unit-testable without jsdom or Radix — see BuilderForm.tsx, which is a thin shadcn
// shell over these functions.

import type { QueryModel, WidgetQuery, WidgetVariableDef } from '../../api';
import { pruneDimensions, type TreeGroup } from './conditionTree.model';
import { toBuilderMetrics, type Measure } from './measures.model';

export type BuilderQuery = Extract<WidgetQuery, { mode: 'builder' }>;

export type AdhocDimension = { key: string; label: string; join: string; column: string; kind: 'string' | 'date' | 'number' };

/**
 * Switch the source model. Resets everything scoped to the previous model's shape (metric,
 * extra metrics, group-by dimension, breakdown, and both filter forms) since dimension/metric
 * keys from the old model are meaningless against the new one.
 */
export function setModelPatch(models: QueryModel[], value: BuilderQuery, id: string): BuilderQuery {
  const m = models.find((x) => x.id === id);
  if (!m) return value;
  return {
    ...value,
    model: id,
    metric: m.metrics[0] ?? value.metric,
    metrics: undefined,
    dimension: undefined,
    breakdown: undefined,
    filters: [],
    filterTree: undefined,
    adhocDimensions: undefined,
    customColumns: undefined,
  };
}

/** Swap in the full metric definition for the chosen key from the current model. */
export function setMetricPatch(model: QueryModel | undefined, value: BuilderQuery, key: string): BuilderQuery {
  const mm = model?.metrics.find((x) => x.key === key);
  if (!mm) return value;
  return { ...value, metric: mm };
}

/** Set (or, for an empty key, clear) the group-by dimension. Always drops any prior grain. */
export function setDimensionPatch(value: BuilderQuery, key: string): BuilderQuery {
  return { ...value, dimension: key ? { key } : undefined };
}

/** Set the date grain on the existing group-by dimension; a no-op when there is none. */
export function setGrainPatch(value: BuilderQuery, grain: string): BuilderQuery {
  if (!value.dimension) return value;
  return { ...value, dimension: { ...value.dimension, grain } };
}

/** Set (or, for an empty key, clear) the breakdown dimension. */
export function setBreakdownPatch(value: BuilderQuery, key: string): BuilderQuery {
  return { ...value, breakdown: key ? { key } : undefined };
}

/** Replace the top-level filters list. */
export function setFiltersPatch(value: BuilderQuery, filters: BuilderQuery['filters']): BuilderQuery {
  return { ...value, filters };
}

/** Set (or, for a non-positive / undefined value, clear) the top-N row limit. */
export function setLimitPatch(value: BuilderQuery, limit: number | undefined): BuilderQuery {
  const next = { ...value };
  const floored = limit !== undefined ? Math.floor(limit) : undefined;
  if (floored && Number.isFinite(floored) && floored > 0) next.limit = floored;
  else delete next.limit;
  return next;
}

/** Author the AND/OR tree: set `filterTree` and clear the legacy flat `filters` (compiler prefers
 *  the tree when present). Passing `undefined` reverts to the flat `filters`. */
export function setFilterTreePatch(value: BuilderQuery, tree: TreeGroup | undefined): BuilderQuery {
  const next = { ...value };
  if (tree) { next.filterTree = tree as BuilderQuery['filterTree']; next.filters = []; }
  else delete next.filterTree;
  return next;
}

/**
 * Build the `WidgetQuery` that `WidgetEditorDialog.save()` persists, given the current editor
 * mode. Kept pure (and separate from the dialog's Radix-heavy JSX) so save-payload construction
 * is unit-testable without jsdom — see WidgetEditorDialog.test.tsx and this file's tests.
 */
export function buildSaveQuery(
  mode: 'builder' | 'sql',
  builderQuery: BuilderQuery,
  sqlText: string,
  bindings: Record<string, string>,
  varDefs: Record<string, WidgetVariableDef>,
): WidgetQuery {
  return mode === 'builder' ? builderQuery : { mode: 'sql', sql: sqlText, variableBindings: bindings, variables: varDefs };
}

/**
 * Decide whether toggling from SQL back to Builder can losslessly restore the in-memory
 * `builderQuery` instead of re-parsing `sqlText` with `recognizeSql`.
 *
 * Builder -> SQL eject compiles the builder query to SQL with quoted identifiers and inlined
 * params (e.g. `from "lab_requests"`, `"status" as "label"`) that `recognizeSql` — which only
 * understands unquoted `FROM \w+` style SQL — cannot parse. So a plain round-trip (the SQL is
 * exactly what was last ejected) must skip the recognizer and restore `builderQuery` directly.
 *
 * The moment the user edits the ejected SQL, `sqlText` no longer equals `lastEjectedSql` and this
 * returns false so the caller falls through to `recognizeSql` — re-recognizing the edit instead of
 * silently discarding it and restoring the stale pre-edit builder query.
 */
export function shouldRestoreEjected(mode: 'builder' | 'sql', sqlText: string, lastEjectedSql: string | undefined): boolean {
  return mode === 'sql' && lastEjectedSql !== undefined && sqlText === lastEjectedSql;
}

/** The current measures as a list (the single `metric`, or the `metrics[]` array when wide). */
export function measuresOf(value: BuilderQuery): Measure[] {
  return (value.metrics as Measure[] | undefined) ?? (value.metric ? [value.metric as Measure] : []);
}

/** Persist an edited measures list back into the query's `metric`/`metrics` fields. */
export function setMeasuresPatch(value: BuilderQuery, list: Measure[]): BuilderQuery {
  const { metric, metrics } = toBuilderMetrics(list);
  const next = { ...value, metric: metric as BuilderQuery['metric'] };
  if (metrics) next.metrics = metrics as BuilderQuery['metrics'];
  else delete next.metrics;
  return next;
}

/** Remove an ad-hoc dimension by key, dropping the field when empty and clearing every reference
 *  the removed column left behind — group-by, breakdown, flat `filters`, and `filterTree` rules —
 *  so the query never carries a dangling dimension key (mirrors the derived-measure orphan cleanup
 *  in measures.model.ts). */
export function removeAdhocDimensionPatch(value: BuilderQuery, key: string): BuilderQuery {
  const list = (value.adhocDimensions ?? []).filter((d) => d.key !== key);
  const next = { ...value, adhocDimensions: list };
  return clearDimensionRefs(next, new Set([key]));
}

// --- "Join data" helpers (moved here from JoinColumnPicker so they're pure + unit-testable) ---

/** Query-local key for an ad-hoc join column. */
export function adhocKey(join: string, column: string): string {
  return `${join}__${column}`;
}

/** Columns that look like dates/numbers get a better default kind; everything else is a string. */
export function inferKind(column: string): AdhocDimension['kind'] {
  if (/(_at|_time|date|timestamp|issued|authored|received|effective)/i.test(column)) return 'date';
  if (/(count|value|amount|age|number|_id$)/i.test(column)) return 'number';
  return 'string';
}

/** Title-case a snake_case column name for a default label. */
export function humanize(column: string): string {
  return column.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Build an ad-hoc dimension for one join column, with a derived key/label/kind. */
export function makeAdhocDimension(joinAlias: string, joinLabel: string, column: string): AdhocDimension {
  return { key: adhocKey(joinAlias, column), label: `${joinLabel} → ${humanize(column)}`, join: joinAlias, column, kind: inferKind(column) };
}

/** Clear every reference (group-by, breakdown, flat filters, filterTree) to any key in `keys`. */
export function clearDimensionRefs(next: BuilderQuery, keys: Set<string>): BuilderQuery {
  if (next.dimension && keys.has(next.dimension.key)) next.dimension = undefined;
  if (next.breakdown && keys.has(next.breakdown.key)) next.breakdown = undefined;
  if (next.filters?.length) next.filters = next.filters.filter((f) => !keys.has(f.dimension));
  if (next.filterTree) next.filterTree = pruneDimensions(next.filterTree as TreeGroup, keys) as BuilderQuery['filterTree'];
  return next;
}

/**
 * Reconcile the ad-hoc columns for ONE relationship (join alias) to exactly `columns`: keep every
 * ad-hoc dimension from OTHER relationships, replace this alias's set with freshly-derived dims, and
 * orphan-clean any group-by/breakdown/filter reference to a column that was dropped. The derived key
 * is stable, so an unchanged column keeps its key (and its references) across a reconcile.
 */
export function setRelationshipColumnsPatch(value: BuilderQuery, joinAlias: string, joinLabel: string, columns: string[]): BuilderQuery {
  const others = (value.adhocDimensions ?? []).filter((d) => d.join !== joinAlias);
  const desired = columns.map((c) => makeAdhocDimension(joinAlias, joinLabel, c));
  const desiredKeys = new Set(desired.map((d) => d.key));
  const removedKeys = new Set(
    (value.adhocDimensions ?? []).filter((d) => d.join === joinAlias && !desiredKeys.has(d.key)).map((d) => d.key),
  );
  const next = { ...value, adhocDimensions: [...others, ...desired] };
  return clearDimensionRefs(next, removedKeys);
}

/** Remove an entire relationship (all ad-hoc dims for `joinAlias`) and orphan-clean their references. */
export function removeRelationshipPatch(value: BuilderQuery, joinAlias: string): BuilderQuery {
  const removedKeys = new Set((value.adhocDimensions ?? []).filter((d) => d.join === joinAlias).map((d) => d.key));
  const next = { ...value, adhocDimensions: (value.adhocDimensions ?? []).filter((d) => d.join !== joinAlias) };
  return clearDimensionRefs(next, removedKeys);
}
