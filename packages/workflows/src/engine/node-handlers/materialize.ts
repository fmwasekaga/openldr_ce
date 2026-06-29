import type { NodeHandler } from './types';
import { fromItems } from '../items';

export const materializeHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services) throw new Error('Materialize node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const name = String(config.datasetName ?? '').trim();
  if (!name) throw new Error('Materialize node: datasetName is required');
  const { columns, rows } = fromItems(input);
  await ctx.services.materializeDataset(name, columns, rows, ctx.workflowId ?? null);
  return input;
};
