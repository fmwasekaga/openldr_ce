// Pure state-transition helpers for user-authored custom columns (row-level computed dimensions).
// React/DOM-free so they're unit-testable — see CustomColumnEditor.tsx for the shell.

import type { BuilderQuery } from './builderForm.model';
import type { CustomColumn, CustomColumnExpr, CustomColumnOperand } from '../../api';
import { pruneDimensions, type TreeGroup } from './conditionTree.model';

export type { CustomColumn, CustomColumnExpr, CustomColumnOperand };

/** concat → string, arithmetic → number (mirrors the server's customColumnKind). */
export function customColumnKind(expr: CustomColumnExpr): 'string' | 'number' {
  return expr.kind === 'concat' ? 'string' : 'number';
}

/** `custom`, then `custom-2`, `custom-3`, … until it doesn't collide. */
export function uniqueCustomKey(list: CustomColumn[], base = 'custom'): string {
  const keys = new Set(list.map((c) => c.key));
  if (!keys.has(base)) return base;
  let n = 2;
  while (keys.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

const operandLabel = (o: CustomColumnOperand, dimLabel: (k: string) => string): string =>
  o.type === 'field' ? dimLabel(o.dimension) : o.type === 'string' ? `"${o.value}"` : String(o.value);

/** A readable default label, e.g. `Status + "/" + Priority` or `Value / 1000`. */
export function deriveCustomLabel(expr: CustomColumnExpr, dimLabel: (k: string) => string): string {
  if (expr.kind === 'concat') return expr.parts.map((p) => operandLabel(p, dimLabel)).join(' + ');
  return `${operandLabel(expr.left, dimLabel)} ${expr.op} ${operandLabel(expr.right, dimLabel)}`;
}

/** Append a custom column (dedupe by key). */
export function addCustomColumn(value: BuilderQuery, col: CustomColumn): BuilderQuery {
  const list = value.customColumns ?? [];
  if (list.some((c) => c.key === col.key)) return value;
  return { ...value, customColumns: [...list, col] };
}

/** Patch one custom column by key. */
export function updateCustomColumn(value: BuilderQuery, key: string, patch: Partial<CustomColumn>): BuilderQuery {
  return { ...value, customColumns: (value.customColumns ?? []).map((c) => (c.key === key ? { ...c, ...patch } : c)) };
}

/** Remove a custom column and clear every reference it left behind (group-by, breakdown, filters, tree). */
export function removeCustomColumn(value: BuilderQuery, key: string): BuilderQuery {
  const next: BuilderQuery = { ...value, customColumns: (value.customColumns ?? []).filter((c) => c.key !== key) };
  if (next.dimension?.key === key) next.dimension = undefined;
  if (next.breakdown?.key === key) next.breakdown = undefined;
  if (next.filters?.length) next.filters = next.filters.filter((f) => f.dimension !== key);
  if (next.filterTree) next.filterTree = pruneDimensions(next.filterTree as TreeGroup, new Set([key])) as BuilderQuery['filterTree'];
  return next;
}
