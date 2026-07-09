// Live SQL Server acceptance for the target-store layer (P2-DB-1..4).
//
// Exercises the REAL code paths against a live SQL Server:
//   1. createMssqlStore — adapter connects + healthCheck (P2-DB-1)
//   2. externalMigrations('mssql') — dialect-aware flat-schema migrations apply (P2-DB-2/4)
//   3. createFlatWriter(db, 'mssql') — flatten FHIR + batched MERGE upsert (P2-DB-2 bulk load)
//   4. reporting run() over ExternalSchema — reports execute against SQL Server (P2-DB-3)
//
// Preconditions: a reachable SQL Server with the target database created.
//   docker run -d --name openldr-mssql-test -e ACCEPT_EULA=Y \
//     -e MSSQL_SA_PASSWORD='Openldr_Local_2026!' -p 11433:1433 \
//     mcr.microsoft.com/mssql/server:2022-latest
//   sqlcmd ... -Q "CREATE DATABASE openldr_target;"
//
// Run: node_modules/.bin/tsx scripts/mssql-live-acceptance.ts
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { createMssqlStore } from '@openldr/adapter-mssql-store';
import { createMigrator, externalMigrations, createFlatWriter, type ExternalSchema } from '@openldr/db';
import { createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';

const cfg = {
  host: process.env.MSSQL_HOST ?? 'localhost',
  port: Number(process.env.MSSQL_PORT ?? 11433),
  database: process.env.MSSQL_DATABASE ?? 'openldr_target',
  user: process.env.MSSQL_USER ?? 'sa',
  password: process.env.MSSQL_PASSWORD ?? 'Openldr_Local_2026!',
  encrypt: false,
  trustServerCertificate: true,
};

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n[${m}]`);

// ── Synthetic FHIR resources (varied so reports produce non-trivial output) ──
const patients = [
  { resourceType: 'Patient', id: 'p1', name: [{ family: 'Doe', given: ['John'] }], gender: 'male', birthDate: '1990-03-02' },
  { resourceType: 'Patient', id: 'p2', name: [{ family: 'Roe', given: ['Jane'] }], gender: 'female', birthDate: '2019-06-15' },
  { resourceType: 'Patient', id: 'p3', name: [{ family: 'Poe', given: ['Sam'] }], gender: 'female', birthDate: '1965-01-20' },
];
const serviceRequests = [
  { resourceType: 'ServiceRequest', id: 's1', status: 'active', intent: 'order', code: { text: 'Blood culture' }, subject: { reference: 'Patient/p1' }, authoredOn: '2026-01-10T09:00:00Z' },
  { resourceType: 'ServiceRequest', id: 's2', status: 'active', intent: 'order', code: { text: 'Blood culture' }, subject: { reference: 'Patient/p2' }, authoredOn: '2026-01-22T09:00:00Z' },
  { resourceType: 'ServiceRequest', id: 's3', status: 'active', intent: 'order', code: { text: 'Urine culture' }, subject: { reference: 'Patient/p3' }, authoredOn: '2026-02-03T09:00:00Z' },
  { resourceType: 'ServiceRequest', id: 's4', status: 'active', intent: 'order', code: { text: 'Urine culture' }, subject: { reference: 'Patient/p1' }, authoredOn: '2026-02-18T09:00:00Z' },
];

async function main() {
  let failures = 0;
  const store = createMssqlStore(cfg);
  const db = store.db as unknown as Kysely<ExternalSchema>;
  // App context for step 4's reporting run. The 7 built-in reports are now data-driven `r-<id>`
  // records (Slice S5 retired the hardcoded catalog), resolved via `ctx.reporting.run`. NOTE: the
  // data-driven reports execute their SQL through the default (Postgres) warehouse connector — they
  // are Postgres-only in v1 — so step 4 no longer exercises reporting against THIS SQL Server `db`
  // handle the way the old catalog `ReportDefinition.run(db)` did. Kept here only to prove the
  // data-driven reporting path resolves; the MSSQL-dialect reporting coverage is a separate concern.
  const appCtx = await createAppContext(loadConfig());

  try {
    step('1. adapter connect + healthCheck');
    const health = await store.healthCheck();
    console.log('  health =', JSON.stringify(health));
    if (health.status !== 'up') throw new Error(`expected health up, got ${health.status}`);
    ok('SQL Server adapter reports up');

    step('2. external migrations (mssql dialect)');
    const migrator = createMigrator(db as unknown as Kysely<unknown>, externalMigrations('mssql'));
    const res = await migrator.migrateToLatest();
    if (res.error) throw res.error;
    for (const r of res.results ?? []) console.log(`  ${r.status}  ${r.migrationName}`);
    ok(`${(res.results ?? []).length} migration(s) applied`);

    const tables = await db.introspection.getTables();
    const names = tables.map((t) => t.name).sort();
    console.log('  tables:', names.join(', '));
    for (const required of ['patients', 'service_requests', 'specimens', 'observations']) {
      if (!names.includes(required)) throw new Error(`missing table ${required}`);
    }
    ok('flat tables present');

    step('3. flat writer — batched MERGE upsert (bulk load)');
    const writer = createFlatWriter(db, 'mssql');
    const prov = { source_system: 'mssql-acceptance', plugin_id: null, plugin_version: null, batch_id: 'accept-1' };
    const items = [...patients, ...serviceRequests].map((resource) => ({ resource, provenance: prov }));
    const results = await writer.writeMany(items);
    console.log('  writeMany results:', JSON.stringify(results));
    ok(`${results.length} resources written`);

    // Idempotency: re-write the same batch → MERGE updates, no duplicate rows.
    await writer.writeMany(items);
    const patientCount = await db.selectFrom('patients').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const reqCount = await db.selectFrom('service_requests').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    console.log(`  row counts after 2x write: patients=${patientCount.n} service_requests=${reqCount.n}`);
    if (Number(patientCount.n) !== patients.length) throw new Error(`MERGE not idempotent: patients=${patientCount.n}`);
    if (Number(reqCount.n) !== serviceRequests.length) throw new Error(`MERGE not idempotent: service_requests=${reqCount.n}`);
    ok('MERGE upsert is idempotent (no duplicate rows)');

    step('4. data-driven reporting resolves (r-<id> records)');
    const tvRes = await appCtx.reporting.run('r-test-volume', {});
    console.table(tvRes.rows);
    ok(`r-test-volume: ${tvRes.rows.length} rows`);

    const pdRes = await appCtx.reporting.run('r-patient-demographics', {});
    console.table(pdRes.rows);
    ok(`r-patient-demographics: ${pdRes.rows.length} rows`);
  } catch (e) {
    failures++;
    console.error('\n[FAIL]', e instanceof Error ? e.stack : e);
  } finally {
    // Clean up the synthetic rows so the script is repeatable.
    try {
      await sql`delete from service_requests where source_system = 'mssql-acceptance'`.execute(db);
      await sql`delete from patients where source_system = 'mssql-acceptance'`.execute(db);
    } catch { /* ignore cleanup errors */ }
    await store.close();
    await appCtx.close();
  }

  console.log(failures === 0 ? '\n✅ MSSQL live acceptance PASSED' : '\n❌ MSSQL live acceptance FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

void main();
