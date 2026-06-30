import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';
import { rowsToItems } from '../items';

/** Run a raw SQL query against a host database connector (postgres / microsoft-sql).
 *  The connector's type drives the dialect server-side, so this handler is dialect-agnostic. */
export const connectorSqlHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.runConnectorSql) throw new Error('Database node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const connectorId = (config.connectorId as string) ?? '';
  if (!connectorId) throw new Error('Database node: a connector is required');
  const sql = resolveTemplate(String(config.sql ?? ''), ctx, input);
  if (!sql.trim()) throw new Error('Database node: SQL query is required');
  const result = await ctx.services.runConnectorSql({ connectorId, sql });
  return rowsToItems(result.rows);
};
