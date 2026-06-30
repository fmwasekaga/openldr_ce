import type { NodeHandler } from './types';

export const persistStoreHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.persistStore) throw new Error('Persist Store node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const source = String(config.source ?? '').trim() || undefined;
  const result = await ctx.services.persistStore({ items: input, source });
  ctx.nodeMeta[node.id] = result.meta;
  return result.items;
};
