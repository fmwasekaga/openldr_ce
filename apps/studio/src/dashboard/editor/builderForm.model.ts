// Pure state-transition helpers for the builder-mode WidgetQuery. Kept free of React/DOM so
// they're unit-testable without jsdom or Radix — see BuilderForm.tsx, which is a thin shadcn
// shell over these functions.

import type { QueryModel, WidgetQuery, WidgetVariableDef } from '../../api';

export type BuilderQuery = Extract<WidgetQuery, { mode: 'builder' }>;

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
  if (limit && Number.isFinite(limit) && limit > 0) next.limit = Math.floor(limit);
  else delete next.limit;
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
