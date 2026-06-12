import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { InternalSchema } from './schema/internal';

export interface InternalDb {
  db: Kysely<InternalSchema>;
  close(): Promise<void>;
}

export function createInternalDb(url: string, deps: { pool?: pg.Pool } = {}): InternalDb {
  const pool = deps.pool ?? new pg.Pool({ connectionString: url });
  const db = new Kysely<InternalSchema>({ dialect: new PostgresDialect({ pool }) });
  return { db, close: () => db.destroy() };
}
