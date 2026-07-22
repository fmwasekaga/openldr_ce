// Browser-safe subset of @openldr/dashboards: the SQL recognizer plus the pure model registry
// and query types it depends on. NONE of these transitively import `kysely` or `@openldr/db` at
// runtime (only `import type`, which is erased), unlike the package root ('.'), which also
// exports compile.ts/store.ts/sql-runner.ts — those pull in kysely + DB driver deps and must
// stay server-only. Mirrors the @openldr/report-designer/pure precedent.
export { recognizeSql, type RecognizeResult, type RecognizeCode } from './recognize-sql';
export * from './models/registry';
export * from './types';
