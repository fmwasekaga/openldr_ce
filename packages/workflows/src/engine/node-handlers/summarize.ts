import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

/** Group items by a field and reduce a numeric field (sum/avg/min/max) or count. */
export const summarizeHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const groupBy = (config.groupBy as string) ?? '';
  const field = (config.field as string) ?? '';
  const operation = (config.operation as string) ?? 'count';

  const groups = new Map<string, WorkflowItem[]>();
  for (const item of input) {
    const key = groupBy ? String(item.json[groupBy] ?? '') : '__all__';
    const arr = groups.get(key) ?? [];
    arr.push(item);
    groups.set(key, arr);
  }

  const compute = (items: WorkflowItem[]): number => {
    if (operation === 'count') return items.length;
    const nums = items.map((i) => Number(i.json[field])).filter((n) => Number.isFinite(n));
    if (nums.length === 0) return 0;
    switch (operation) {
      case 'sum': return nums.reduce((a, b) => a + b, 0);
      case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
      case 'min': return Math.min(...nums);
      case 'max': return Math.max(...nums);
      default: return items.length;
    }
  };

  const resultKey = operation === 'count' ? 'count' : `${operation}_${field}`;
  return [...groups.entries()].map(([key, items]) => ({
    json: {
      ...(groupBy ? { [groupBy]: key } : {}),
      [resultKey]: compute(items),
    },
  }));
};
