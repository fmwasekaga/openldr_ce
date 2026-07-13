// Live cross-dialect report parity harness (Task 3, mssql-slice2b).
//
// Proves the 9 built-in `SEED_QUERIES` (packages/reporting/src/seed/report-seeds.ts) produce
// SEMANTICALLY EQUIVALENT results on SQL Server vs Postgres: identical rows/numbers after
// normalizing numeric formatting (round floats to 3dp) and tie order (sort rows by all columns).
// Trivial formatting differences (`100` vs `100.0`) are OK; real data differences are not.
//
// Preconditions: a reachable Postgres 16 + SQL Server 2022, each with an `openldr_target` DB.
//   docker run -d --name openldr-parity-pg -e POSTGRES_PASSWORD=openldr -e POSTGRES_DB=openldr_target \
//     -p 5544:5432 postgres:16
//   docker run -d --name openldr-parity-mssql -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD='Openldr_Local_2026!' \
//     -p 11433:1433 mcr.microsoft.com/mssql/server:2022-latest
//   MSYS_NO_PATHCONV=1 docker exec openldr-parity-mssql /opt/mssql-tools18/bin/sqlcmd \
//     -S localhost -U sa -P 'Openldr_Local_2026!' -C -Q "CREATE DATABASE openldr_target;"
//
// Run: node_modules/.bin/tsx scripts/mssql-reports-parity.ts   (or `pnpm reports:parity`)
//
// Connection config is read from env with the above defaults; override via TARGET_DATABASE_URL /
// MSSQL_HOST / MSSQL_PORT / MSSQL_DATABASE / MSSQL_USER / MSSQL_PASSWORD if needed.
//
// The harness migrates the flat schema into BOTH engines, wipes+reseeds an IDENTICAL fixed FHIR
// fixture into both via createFlatWriter, then for each of the 9 SEED_QUERIES substitutes a fixed
// param bag into both the `postgres` and `mssql` SQL variants and runs them directly against each
// engine, normalizes + sorts both result sets, and deep-compares them. Exits non-zero on any
// mismatch, printing the first differing row.
import { Kysely, sql } from 'kysely';
import { createMigrator, externalMigrations, createFlatWriter, createRelationalWriter, type ExternalSchema } from '@openldr/db';
import { createDbStore } from '@openldr/adapter-db-store';
import { createMssqlStore } from '@openldr/adapter-mssql-store';
import { prepareSelect } from '@openldr/dashboards';
import { SEED_QUERIES, type SqlDialect } from '../packages/reporting/src/seed/report-seeds';
import { TABLES, PROV, patients, specimens, serviceRequests, diagnosticReports, observations, PARAM_BAG, normalizeRows, firstDiff } from './lib/reports-parity-fixture';

const PG_URL = process.env.TARGET_DATABASE_URL ?? 'postgresql://postgres:openldr@localhost:5544/openldr_target';
const MSSQL_CFG = {
  host: process.env.MSSQL_HOST ?? 'localhost',
  port: Number(process.env.MSSQL_PORT ?? 11433),
  database: process.env.MSSQL_DATABASE ?? 'openldr_target',
  user: process.env.MSSQL_USER ?? 'sa',
  password: process.env.MSSQL_PASSWORD ?? 'Openldr_Local_2026!',
  encrypt: false,
  trustServerCertificate: true,
};

async function migrateAndClean(db: Kysely<ExternalSchema>, engine: 'postgres' | 'mssql'): Promise<void> {
  const migrator = createMigrator(db as unknown as Kysely<unknown>, externalMigrations(engine));
  const res = await migrator.migrateToLatest();
  if (res.error) throw res.error;
  for (const t of TABLES) {
    await sql.raw(`delete from ${t}`).execute(db as unknown as Kysely<unknown>);
  }
}

async function seedFixture(db: Kysely<ExternalSchema>, engine: 'postgres' | 'mssql'): Promise<void> {
  const writer = createFlatWriter(db, engine);
  const items = [...patients, ...specimens, ...serviceRequests, ...diagnosticReports, ...observations].map((resource) => ({ resource, provenance: PROV }));
  const results = await writer.writeMany(items);
  const skipped = results.filter((r) => r === 'skipped').length;
  if (skipped > 0) throw new Error(`${engine}: ${skipped} fixture item(s) were skipped by the flat writer`);

  const relWriter = createRelationalWriter(db, engine);
  await relWriter.writeMany(items);
  // relWriter intentionally skips resource types it doesn't project (specimens/diagnostic_reports);
  // don't assert its skip count — only the flat writer's completeness is asserted above.
}

async function runQuery(db: Kysely<ExternalSchema>, sqlText: string): Promise<Record<string, unknown>[]> {
  const r = await sql.raw<Record<string, unknown>>(sqlText).execute(db as unknown as Kysely<unknown>);
  return r.rows;
}

async function main(): Promise<void> {
  const pgStore = createDbStore({ url: PG_URL });
  const pgDb = pgStore.db as unknown as Kysely<ExternalSchema>;
  const mssqlStore = createMssqlStore(MSSQL_CFG);
  const mssqlDb = mssqlStore.db as unknown as Kysely<ExternalSchema>;

  let failures = 0;
  try {
    console.log('[setup] migrating + cleaning postgres...');
    await migrateAndClean(pgDb, 'postgres');
    console.log('[setup] migrating + cleaning mssql...');
    await migrateAndClean(mssqlDb, 'mssql');

    console.log('[setup] seeding fixture into postgres...');
    await seedFixture(pgDb, 'postgres');
    console.log('[setup] seeding fixture into mssql...');
    await seedFixture(mssqlDb, 'mssql');

    console.log(`\n[parity] running ${SEED_QUERIES.length} report queries on both engines...\n`);
    for (const q of SEED_QUERIES) {
      const dialects: SqlDialect[] = ['postgres', 'mssql'];
      const [pgSql, msSql] = dialects.map((d) => prepareSelect(q.sql[d], q.params, PARAM_BAG).replace(/;\s*$/, ''));
      const [pgRowsRaw, msRowsRaw] = await Promise.all([runQuery(pgDb, pgSql), runQuery(mssqlDb, msSql)]);
      const pgRows = normalizeRows(pgRowsRaw);
      const msRows = normalizeRows(msRowsRaw);
      const diff = firstDiff(pgRows, msRows);
      if (diff) {
        failures++;
        console.log(`✗ ${q.id}  (postgres=${pgRowsRaw.length} rows, mssql=${msRowsRaw.length} rows)`);
        console.log(`    ${diff.reason}`);
        console.log(`    postgres: ${JSON.stringify(diff.a)}`);
        console.log(`    mssql:    ${JSON.stringify(diff.b)}`);
      } else {
        console.log(`✓ ${q.id}  (${pgRows.length} rows)`);
      }
    }
  } finally {
    await pgStore.close();
    await mssqlStore.close();
  }

  console.log(failures === 0 ? '\n✅ ALL 9 report queries are cross-dialect parity-equivalent' : `\n❌ ${failures} report quer${failures === 1 ? 'y' : 'ies'} mismatched`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
