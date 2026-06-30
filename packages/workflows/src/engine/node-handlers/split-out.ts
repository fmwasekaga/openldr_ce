import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

/** Explode an array field into one item per element. Non-array → passthrough. */
export const splitOutHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const field = (config.field as string) ?? '';
  if (!field) return input;
  const out: WorkflowItem[] = [];
  for (const item of input) {
    const value = item.json[field];
    if (Array.isArray(value)) {
      for (const el of value) {
        const json = el !== null && typeof el === 'object' && !Array.isArray(el)
          ? (el as Record<string, unknown>)
          : { value: el };
        out.push({ json });
      }
    } else {
      out.push(item);
    }
  }
  return out;
};
