// Measure ingest throughput: generate an N-row WHONET sample, ingest it through the CLI,
// report wall-clock + resources/s.
//
// HONEST CAVEAT: this is synthetic local volume measured end-to-end through the CLI (process
// startup included as a constant), NOT a production-scale or distributed load test. It exists to
// (a) make the batched flat-writer's win observable and (b) give a repeatable baseline-vs-batched
// number on both Postgres and SQL Server (P2-NFR-3).
//
// Usage: node scripts/load-measure.mjs [--rows N]   (default N=100)
// Preconditions (the caller sets these up — the script does NOT reset the DB):
//   - DB migrated and in the desired starting state (reset before a clean run for fresh inserts).
//   - Plugin built + installed (pnpm build:plugins && pnpm openldr plugin install ...).
//   - Env selects the engine: TARGET_STORE_ADAPTER=pg (default) or =mssql + MSSQL_* set.
import { execSync } from 'node:child_process';

const rowsArg = process.argv.indexOf('--rows');
const ROWS = rowsArg >= 0 ? Math.max(1, parseInt(process.argv[rowsArg + 1], 10) || 100) : 100;

// WHONET emits ~6 FHIR resources per isolate (patient, specimen, organism obs, 3 AST obs).
const RESOURCES_PER_ISOLATE = 6;
const approxResources = ROWS * RESOURCES_PER_ISOLATE;

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

run(`node scripts/make-whonet-sample.mjs --rows ${ROWS}`);

const t0 = process.hrtime.bigint();
run('pnpm -s openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite');
const t1 = process.hrtime.bigint();

const ms = Number(t1 - t0) / 1e6;
const engine = process.env.TARGET_STORE_ADAPTER ?? 'pg';
process.stdout.write(
  `\n[load:measure] engine=${engine} isolates=${ROWS} (~${approxResources} resources) ` +
    `wall=${ms.toFixed(0)}ms => ${(approxResources / (ms / 1000)).toFixed(1)} resources/s\n`,
);
