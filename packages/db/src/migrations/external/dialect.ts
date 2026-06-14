import { sql, type RawBuilder } from 'kysely';
import type { TargetEngine } from '../../engine';

// Logical-type -> dialect-type maps. Returned as strings used via sql.raw(...) in DDL so
// both Postgres and SQL Server emit valid column types from ONE schema definition.
export function textType(engine: TargetEngine): string {
  return engine === 'mssql' ? 'nvarchar(max)' : 'text';
}
// MSSQL primary keys cannot be nvarchar(max); 450 is the max safe keyable length. FHIR ids fit easily.
export function keyType(engine: TargetEngine): string {
  return engine === 'mssql' ? 'varchar(450)' : 'text';
}
export function floatType(engine: TargetEngine): string {
  return engine === 'mssql' ? 'float' : 'double precision';
}
export function timestampType(engine: TargetEngine): string {
  return engine === 'mssql' ? 'datetime2' : 'timestamptz';
}
export function nowExpr(engine: TargetEngine): RawBuilder<unknown> {
  return engine === 'mssql' ? sql`SYSUTCDATETIME()` : sql`now()`;
}
