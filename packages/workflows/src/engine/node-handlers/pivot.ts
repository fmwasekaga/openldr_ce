import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

/** Reshape long rows into wide rows: one output row per distinct groupBy key,
 *  with one column per entry in `columns` filled from pivotColumn/valueColumn.
 *  Missing values default to ''. Collisions combine via `aggregate` (max|min|first|last). */
export const pivotHandler: NodeHandler = async (node, _ctx, input) => {
  if (input.length === 0) return [];
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const groupBy = (config.groupBy as string[]) ?? [];
  const pivotColumn = String(config.pivotColumn ?? '');
  const valueColumn = String(config.valueColumn ?? '');
  const columns = (config.columns as string[]) ?? [];
  const carry = (config.carry as string[]) ?? [];
  const aggregate = String(config.aggregate ?? 'max');
  if (groupBy.length === 0 || !pivotColumn || !valueColumn) {
    throw new Error('Pivot node: groupBy, pivotColumn and valueColumn are required');
  }

  const combine = (prev: unknown, next: unknown): unknown => {
    if (prev === undefined || prev === '') return next;
    if (next === undefined || next === '') return prev;
    switch (aggregate) {
      case 'min': return String(next) < String(prev) ? next : prev;
      case 'first': return prev;
      case 'last': return next;
      case 'max': default: return String(next) > String(prev) ? next : prev;
    }
  };

  const groups = new Map<string, WorkflowItem>();
  for (const it of input) {
    const key = groupBy.map((g) => String(it.json[g] ?? '')).join(' ');
    let row = groups.get(key);
    if (!row) {
      const json: Record<string, unknown> = {};
      for (const g of groupBy) json[g] = it.json[g];
      for (const c of carry) json[c] = it.json[c];
      for (const c of columns) json[c] = '';
      row = { json };
      groups.set(key, row);
    }
    const col = String(it.json[pivotColumn] ?? '');
    if (columns.includes(col)) row.json[col] = combine(row.json[col], it.json[valueColumn]);
  }
  return [...groups.values()];
};
