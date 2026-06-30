import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

/** Drop duplicate items, keeping the first. Keyed by a field, or whole-item JSON. */
export const removeDuplicatesHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const field = (config.field as string) ?? '';
  const seen = new Set<string>();
  const out: WorkflowItem[] = [];
  for (const item of input) {
    const key = field ? JSON.stringify(item.json[field]) : JSON.stringify(item.json);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};
