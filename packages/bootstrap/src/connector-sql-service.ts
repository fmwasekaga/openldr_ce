import type { SqlResult } from '@openldr/workflows';
import { planPagination, type SqlDialect } from '@openldr/dashboards';
import { createConnectorDb, type ConnectorDb } from './connector-db';

function dialectFor(type: string): SqlDialect | null {
  if (type === 'postgres') return 'postgres';
  if (type === 'microsoft-sql') return 'mssql';
  // mysql has its own SqlDialect; planPagination's mysql arm internally reuses the
  // postgres LIMIT/OFFSET wrapper (same syntax), so behavior is unchanged.
  if (type === 'mysql') return 'mysql';
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
      let rows: Record<string, unknown>[];
      if (rowCap !== undefined && dialect) {
        const plan = planPagination(userSql.replace(/;\s*$/, ''), dialect, { limit: rowCap, offset });
        const res = await conn.query(plan.sql);
        // MSSQL applies its offset in JS (SET ROWCOUNT fetched offset+limit rows); Postgres already
        // offset in SQL, so sliceOffset is 0.
        rows = plan.sliceOffset ? res.rows.slice(plan.sliceOffset) : res.rows;
      } else {
        rows = (await conn.query(userSql)).rows;
      }
      const columns = rows[0] ? Object.keys(rows[0]).map((k) => ({ key: k, label: k })) : [];
      return { columns, rows };
    } finally {
      await conn.close();
    }
  };
}
