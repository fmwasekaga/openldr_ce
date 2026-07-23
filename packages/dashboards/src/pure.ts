// Browser-safe subset of @openldr/dashboards: the SQL recognizer plus the pure model registry
// and query types it depends on. None of these pull in `kysely` or the `@openldr/db` barrel (which
// re-exports the `pg` driver) at runtime: types come in via `import type` (erased), and the one
// runtime value the registry needs (EXTERNAL_TABLE_COLUMNS) is imported from the browser-safe
// `@openldr/db/schema/external` subpath, never the barrel. This is unlike the package root ('.'),
// which also exports compile.ts/store.ts/sql-runner.ts — those pull in kysely + DB driver deps and
// must stay server-only. Mirrors the @openldr/report-designer/pure precedent.
export { recognizeSql, type RecognizeResult, type RecognizeCode } from './recognize-sql';
export * from './models/registry';
export * from './types';
