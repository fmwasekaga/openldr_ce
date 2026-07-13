// Live cross-dialect report parity harness (mysql-target-s2 Task 9).
//
// Proves the 9 built-in SEED_QUERIES produce SEMANTICALLY EQUIVALENT results on MySQL/MariaDB vs
// Postgres: identical rows/numbers after normalizing numeric formatting (round floats to 3dp) and
// tie order (sort rows by all columns). Trivial formatting differences are OK; real data
// differences are not.
//
// Preconditions: a reachable Postgres 16 (reference) + a MySQL 8.4 or MariaDB 11.4, each with an
// `openldr_target` DB.
//   docker run -d --name openldr-parity-pg -e POSTGRES_PASSWORD=openldr -e POSTGRES_DB=openldr_target -p 5544:5432 postgres:16
//   docker run -d --name openldr-parity-mysql -e MYSQL_ROOT_PASSWORD='Openldr_Local_2026' -e MYSQL_DATABASE=openldr_target -p 13306:3306 mysql:8.4 --character-set-server=utf8mb4
//
// Run: node_modules/.bin/tsx scripts/mysql-reports-parity.ts   (or `pnpm reports:parity:mysql`)
//
// Config from env with the below defaults; override via TARGET_DATABASE_URL / MYSQL_HOST / MYSQL_PORT
// / MYSQL_DATABASE / MYSQL_USER / MYSQL_PASSWORD / MYSQL_SSL.
import { Kysely, sql } from 'kysely';
import { createMigrator, externalMigrations, createFlatWriter, createRelationalWriter, type ExternalSchema } from '@openldr/db';
import { createDbStore } from '@openldr/adapter-db-store';
import { createMysqlStore } from '@openldr/adapter-mysql-store';
import { prepareSelect } from '@openldr/dashboards';
import { SEED_QUERIES } from '../packages/reporting/src/seed/report-seeds';
import { TABLES, PROV, patients, specimens, serviceRequests, diagnosticReports, observations, PARAM_BAG, normalizeRows, firstDiff } from './lib/reports-parity-fixture';

const PG_URL = process.env.TARGET_DATABASE_URL ?? 'postgresql://postgres:openldr@localhost:5544/openldr_target';
const MYSQL_CFG = {
  host: process.env.MYSQL_HOST ?? 'localhost',
  port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.MYSQL_DATABASE ?? 'openldr_target',
  user: process.env.MYSQL_USER ?? 'root',
  password: process.env.MYSQL_PASSWORD ?? 'Openldr_Local_2026',
  ssl: process.env.MYSQL_SSL === 'true',
};

async function migrateAndClean(db: Kysely<ExternalSchema>, engine: 'postgres' | 'mysql'): Promise<void> {
  const migrator = createMigrator(db as unknown as Kysely<unknown>, externalMigrations(engine));
  const res = await migrator.migrateToLatest();
  if (res.error) throw res.error;
  for (const t of TABLES) await sql.raw(`delete from ${t}`).execute(db as unknown as Kysely<unknown>);
}
async function seedFixture(db: Kysely<ExternalSchema>, engine: 'postgres' | 'mysql'): Promise<void> {
  const writer = createFlatWriter(db, engine);
  const items = [...patients, ...specimens, ...serviceRequests, ...diagnosticReports, ...observations].map((resource) => ({ resource, provenance: PROV }));
  const results = await writer.writeMany(items);
  const skipped = results.filter((r) => r === 'skipped').length;
  if (skipped > 0) throw new Error(`${engine}: ${skipped} fixture item(s) skipped by the flat writer`);

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
  const myStore = createMysqlStore(MYSQL_CFG);
  const myDb = myStore.db as unknown as Kysely<ExternalSchema>;
  let failures = 0;
  try {
    console.log('[setup] migrating + cleaning postgres...');
    await migrateAndClean(pgDb, 'postgres');
    console.log('[setup] migrating + cleaning mysql...');
    await migrateAndClean(myDb, 'mysql');
    console.log('[setup] seeding fixture into postgres...');
    await seedFixture(pgDb, 'postgres');
    console.log('[setup] seeding fixture into mysql...');
    await seedFixture(myDb, 'mysql');
    console.log(`\n[parity] running ${SEED_QUERIES.length} report queries on postgres vs mysql...\n`);
    for (const q of SEED_QUERIES) {
      const pgSql = prepareSelect(q.sql.postgres, q.params, PARAM_BAG).replace(/;\s*$/, '');
      const mySql = prepareSelect(q.sql.mysql, q.params, PARAM_BAG).replace(/;\s*$/, '');
      const [pgRowsRaw, myRowsRaw] = await Promise.all([runQuery(pgDb, pgSql), runQuery(myDb, mySql)]);
      const a = normalizeRows(pgRowsRaw); const b = normalizeRows(myRowsRaw);
      const diff = firstDiff(a, b);
      if (diff) {
        failures++;
        console.log(`✗ ${q.id}  (postgres=${pgRowsRaw.length} rows, mysql=${myRowsRaw.length} rows)`);
        console.log(`    ${diff.reason}`);
        console.log(`    postgres: ${JSON.stringify(diff.a)}`);
        console.log(`    mysql:    ${JSON.stringify(diff.b)}`);
      } else {
        console.log(`✓ ${q.id}  (${a.length} rows)`);
      }
    }
  } finally {
    await pgStore.close();
    await myStore.close();
  }
  console.log(failures === 0 ? '\n✅ ALL 9 report queries are pg-vs-mysql parity-equivalent' : `\n❌ ${failures} report quer${failures === 1 ? 'y' : 'ies'} mismatched`);
  process.exit(failures === 0 ? 0 : 1);
}
void main();
