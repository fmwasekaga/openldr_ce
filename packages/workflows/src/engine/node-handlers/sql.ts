import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';
import { rowsToItems } from '../items';

export const sqlHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services) throw new Error('SQL node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const sql = resolveTemplate(String(config.sql ?? ''), ctx, input);
  if (!sql.trim()) throw new Error('SQL node: query is required');
  const result = await ctx.services.runSql(sql);
  return rowsToItems(result.rows);
};
