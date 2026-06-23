import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';

export const sqlHandler: NodeHandler = async (node, ctx, upstream) => {
  if (!ctx.services) throw new Error('SQL node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const sql = resolveTemplate(String(config.sql ?? ''), ctx, upstream);
  if (!sql.trim()) throw new Error('SQL node: query is required');
  return ctx.services.runSql(sql);
};
