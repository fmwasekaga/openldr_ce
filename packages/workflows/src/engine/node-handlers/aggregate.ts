import type { NodeHandler } from './types';

/** Collect a field (or whole-item json) across all items into one item with an array. */
export const aggregateHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const field = (config.field as string) ?? '';
  const outputField = (config.outputField as string) || field || 'data';
  const values = field ? input.map((i) => i.json[field]) : input.map((i) => i.json);
  return [{ json: { [outputField]: values } }];
};
