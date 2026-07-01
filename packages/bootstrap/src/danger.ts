import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '@openldr/db';

/** Kysely's own bookkeeping — never truncate these or migration tracking breaks. */
export const RESERVED_TABLES = ['kysely_migration', 'kysely_migration_lock'] as const;

/** Build a single CASCADE TRUNCATE over `tables` (identifiers quoted). Null when empty. */
export function buildTruncateSql(tables: string[]): string | null {
  if (tables.length === 0) return null;
  const list = tables.map((t) => `"${t.replace(/"/g, '""')}"`).join(', ');
  return `TRUNCATE ${list} RESTART IDENTITY CASCADE`;
}

/** Every user/public table in the internal DB except the reserved migration tables. */
export async function listInternalDataTables(db: Kysely<InternalSchema>): Promise<string[]> {
  const rows = await sql<{ tablename: string }>`
    select tablename from pg_tables where schemaname = 'public'
  `.execute(db);
  return rows.rows.map((r) => r.tablename).filter((t) => !RESERVED_TABLES.includes(t as never));
}

/** Truncate the given tables in one CASCADE statement. No-op when the list is empty. */
export async function truncateTables(db: Kysely<InternalSchema>, tables: string[]): Promise<void> {
  const stmt = buildTruncateSql(tables);
  if (!stmt) return;
  await sql.raw(stmt).execute(db);
}

/** Factory reset: wipe ALL internal-DB data (except kysely bookkeeping). Reseed is done by
 *  the caller via seedDatabase(). Does NOT touch the external target store or Keycloak. */
export async function wipeInternalDatabase(db: Kysely<InternalSchema>): Promise<string[]> {
  const tables = await listInternalDataTables(db);
  await truncateTables(db, tables);
  return tables;
}

/** Clear the audit log + workflow run history only. */
export async function clearAuditAndRunHistory(db: Kysely<InternalSchema>): Promise<void> {
  await truncateTables(db, ['audit_events', 'workflow_runs']);
}
