import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';
import { rowsToItems } from '../items';

/** Run a SELECT query against a host database connector (postgres / microsoft-sql / mysql).
 *  The connector's type drives the dialect server-side, so this handler is dialect-agnostic. The
 *  server-side runner (`createConnectorSqlRunner`) enforces SELECT-only validation and a default row
 *  cap, so this node cannot run DML/DDL or unbounded scans with the connector's stored credentials. */
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
