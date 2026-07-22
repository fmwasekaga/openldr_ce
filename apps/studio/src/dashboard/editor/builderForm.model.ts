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
