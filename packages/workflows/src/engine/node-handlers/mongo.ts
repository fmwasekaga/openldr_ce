import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';
import { rowsToItems } from '../items';

/** Run a MongoDB operation (find/aggregate/insertMany). `query` is JSON (filter object, pipeline array,
 *  or documents array); a string is template-resolved then parsed. */
export const mongoHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.runConnectorMongo) throw new Error('MongoDB node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const connectorId = (config.connectorId as string) ?? '';
  if (!connectorId) throw new Error('MongoDB node: a connector is required');
  const operation = (config.operation as string) || 'find';
  const collection = (config.collection as string) ?? '';
  if (!collection) throw new Error('MongoDB node: a collection is required');
  const raw = config.query;
  let query: unknown;
  if (typeof raw === 'string') {
    const resolved = resolveTemplate(raw, ctx, input);
    try { query = resolved.trim() ? JSON.parse(resolved) : {}; }
    catch (err) { throw new Error(`MongoDB node: invalid query JSON: ${err instanceof Error ? err.message : String(err)}`); }
  } else {
    query = raw ?? {};
  }
  const { rows, meta } = await ctx.services.runConnectorMongo({ connectorId, operation, collection, query });
  if (rows.length === 0 && meta) return [{ json: meta }];
  return rowsToItems(rows);
};
