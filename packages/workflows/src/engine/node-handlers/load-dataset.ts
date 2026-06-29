import type { NodeHandler } from './types';
import { rowsToItems } from '../items';

export const loadDatasetHandler: NodeHandler = async (node, ctx) => {
  if (!ctx.services) throw new Error('Load Dataset node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const name = String(config.datasetName ?? '').trim();
  if (!name) throw new Error('Load Dataset node: datasetName is required');
  const { rows } = await ctx.services.loadDataset(name);
  return rowsToItems(rows);
};
