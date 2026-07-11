import { sql, type RawBuilder } from 'kysely';
import type { TargetEngine } from '../../engine';

// Logical-type -> dialect-type maps. Returned as strings used via sql.raw(...) in DDL so
// Postgres, SQL Server, and MySQL/MariaDB emit valid column types from ONE schema definition.
export function textType(engine: TargetEngine): string {
  if (engine === 'mssql') return 'nvarchar(max)';
  if (engine === 'mysql') return 'longtext'; // utf8mb4 by table default; holds Unicode clinical text
  return 'text';
}
// MSSQL keys cannot be nvarchar(max); MySQL keys cannot be longtext and a utf8mb4 index caps at 3072
// bytes, so 255 chars (255*4=1020 bytes) is safe. FHIR ids fit easily in both.
export function keyType(engine: TargetEngine): string {
  if (engine === 'mssql') return 'varchar(450)';
  if (engine === 'mysql') return 'varchar(255)';
  return 'text';
}
export function floatType(engine: TargetEngine): string {
  if (engine === 'mssql') return 'float';
  if (engine === 'mysql') return 'double';
  return 'double precision';
}
export function timestampType(engine: TargetEngine): string {
  if (engine === 'mssql') return 'datetime2';
  if (engine === 'mysql') return 'datetime';
  return 'timestamptz';
}
export function nowExpr(engine: TargetEngine): RawBuilder<unknown> {
  if (engine === 'mssql') return sql`SYSUTCDATETIME()`;
  if (engine === 'mysql') return sql`CURRENT_TIMESTAMP`;
  return sql`now()`;
}
