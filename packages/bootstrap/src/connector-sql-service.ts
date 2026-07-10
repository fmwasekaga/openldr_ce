import type { SqlResult } from '@openldr/workflows';
import { paginateSql, type SqlDialect } from '@openldr/dashboards';
import { createConnectorDb, type ConnectorDb } from './connector-db';

function dialectFor(type: string): SqlDialect | null {
  if (type === 'postgres') return 'postgres';
  if (type === 'microsoft-sql') return 'mssql';
  return null;
}

export interface ConnectorSqlDeps {
  connectors: {
    get(id: string): Promise<{ type: string | null; enabled: boolean } | null>;
    getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>>;
  };
  secretsKey: string | undefined;
  /** Injectable for tests; defaults to the real createConnectorDb. */
  createDb?: (type: string, config: Record<string, string>) => ConnectorDb;
}

/** Build the runConnectorSql implementation: resolve a host connector, decrypt its config,
 *  open an ephemeral connection, run the raw SQL, and always close. */
export function createConnectorSqlRunner(deps: ConnectorSqlDeps) {
  const make = deps.createDb ?? createConnectorDb;
  return async ({ connectorId, sql: userSql, rowCap, offset }: { connectorId: string; sql: string; rowCap?: number; offset?: number }): Promise<SqlResult> => {
    const c = await deps.connectors.get(connectorId);
    if (!c || !c.enabled) throw new Error(`connector ${connectorId} not found or disabled`);
    if (!c.type) throw new Error(`connector ${connectorId} is not a database connector`);
    const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
    const conn = make(c.type, config);
    try {
      const dialect = dialectFor(c.type);
      const finalSql = (rowCap !== undefined && dialect)
        ? paginateSql(userSql.replace(/;\s*$/, ''), dialect, { limit: rowCap, offset })
        : userSql;
      const { rows } = await conn.query(finalSql);
      const columns = rows[0] ? Object.keys(rows[0]).map((k) => ({ key: k, label: k })) : [];
      return { columns, rows };
    } finally {
      await conn.close();
    }
  };
}
