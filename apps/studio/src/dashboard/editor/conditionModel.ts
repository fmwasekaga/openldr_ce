// Pure state-transition helpers for a list of filter conditions ({dimension, op, value}[]).
// Kept free of React/DOM so they're unit-testable without jsdom or Radix — see
// FilterConditionEditor.tsx, which is a thin shadcn shell over these functions.

export interface FilterCondition {
  dimension: string;
  op: string;
  value: unknown;
}

export const OPS = ['eq', 'in', 'contains', 'gte', 'lte', 'between'] as const;

/** Parse a raw input-box string into the value shape a given operator expects. */
export function toValue(op: string, raw: string): unknown {
  return op === 'in' || op === 'between' ? raw.split(',').map((s) => s.trim()).filter((s) => s !== '') : raw;
}

/** Render a condition's value back to the literal text an <Input> should show. */
export function toLiteral(v: unknown): string {
  return Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
}

/** Append a new condition defaulting to the first available dimension. */
export function addCondition(list: FilterCondition[], dims: { key: string }[]): FilterCondition[] {
  return [...list, { dimension: dims[0]?.key ?? '', op: 'eq', value: '' }];
}

/** Patch the condition at index `i`, leaving the rest of the list untouched. */
export function updateCondition(list: FilterCondition[], i: number, patch: Partial<FilterCondition>): FilterCondition[] {
  return list.map((c, j) => (j === i ? { ...c, ...patch } : c));
}

/** Remove the condition at index `i`. */
export function removeCondition(list: FilterCondition[], i: number): FilterCondition[] {
  return list.filter((_, j) => j !== i);
}
