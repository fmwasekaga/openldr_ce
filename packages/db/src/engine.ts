/** Which SQL engine the EXTERNAL/target warehouse uses. Internal DB is always Postgres. */
export type TargetEngine = 'postgres' | 'mssql' | 'mysql';
