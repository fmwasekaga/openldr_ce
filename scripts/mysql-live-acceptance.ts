// Live acceptance for the MySQL/MariaDB target-store layer (S0).
//
// Exercises the REAL code paths against a live MySQL 8.4 or MariaDB 11.4 with an
// `openldr_target` database:
//   1. createMysqlStore — adapter connects + healthCheck
//   2. externalMigrations('mysql') — dialect-aware flat-schema migrations apply
//   3. createFlatWriter(db, 'mysql') — flatten FHIR + batched ON DUPLICATE KEY UPDATE upsert,
//      2x write idempotency (no duplicate rows)
//   4. Unicode round-trip (utf8mb4) + null handling for missing optional fields
//
// Only the WRITE path is validated here — report queries need MySQL SQL variants that land in a
// later slice, so reporting is intentionally NOT exercised (unlike the MSSQL harness's step 4).
//
// Preconditions: a reachable MySQL/MariaDB server with the target database created.
//   docker run -d --name openldr-mysql-test -e MYSQL_ROOT_PASSWORD='Openldr_Local_2026!' \
//     -p 13306:3306 mysql:8.4
//   docker exec openldr-mysql-test mysql -uroot -p'Openldr_Local_2026!' \
//     -e "create database if not exists openldr_target"
//
// Run: node_modules/.bin/tsx scripts/mysql-live-acceptance.ts
//
// Env overrides:
//   MYSQL_HOST (localhost) MYSQL_PORT (3306) MYSQL_DATABASE (openldr_target)
//   MYSQL_USER (root) MYSQL_PASSWORD (Openldr_Local_2026!) MYSQL_SSL (false)
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { createMysqlStore } from '@openldr/adapter-mysql-store';
import { createMigrator, externalMigrations, createFlatWriter, type ExternalSchema } from '@openldr/db';

const cfg = {
  host: process.env.MYSQL_HOST ?? 'localhost',
  port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.MYSQL_DATABASE ?? 'openldr_target',
  user: process.env.MYSQL_USER ?? 'root',
  password: process.env.MYSQL_PASSWORD ?? 'Openldr_Local_2026!',
  ssl: process.env.MYSQL_SSL === 'true',
};

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n[${m}]`);

// ── Synthetic FHIR resources ──
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
  const store = createMysqlStore(cfg);
  const db = store.db as unknown as Kysely<ExternalSchema>;
  const prov = { sourceSystem: 'mysql-acceptance', batchId: 'accept-1' };

  try {
    step('1. adapter connect + healthCheck');
    const health = await store.healthCheck();
    console.log('  health =', JSON.stringify(health));
    if (health.status !== 'up') throw new Error(`expected health up, got ${health.status}`);
    ok('MySQL/MariaDB adapter reports up');

    step('2. external migrations (mysql dialect)');
    const migrator = createMigrator(db as unknown as Kysely<unknown>, externalMigrations('mysql'));
    const res = await migrator.migrateToLatest();
    if (res.error) throw res.error;
    for (const r of res.results ?? []) console.log(`  ${r.status}  ${r.migrationName}`);
    ok(`${(res.results ?? []).length} migration(s) applied`);

    const tables = await db.introspection.getTables();
    const names = tables.map((t) => t.name).sort();
    console.log('  tables:', names.join(', '));
    for (const required of ['patients', 'service_requests', 'specimens', 'observations', 'diagnostic_reports', 'organizations', 'locations']) {
      if (!names.includes(required)) throw new Error(`missing table ${required}`);
    }
    ok('all 7 flat tables present');

    step('3. flat writer — batched ON DUPLICATE KEY UPDATE upsert (bulk load)');
    const writer = createFlatWriter(db, 'mysql');
    const items = [...patients, ...serviceRequests].map((resource) => ({ resource, provenance: prov }));
    const results = await writer.writeMany(items);
    console.log('  writeMany results:', JSON.stringify(results));
    ok(`${results.length} resources written`);

    // Idempotency: re-write the same batch → upsert updates, no duplicate rows.
    await writer.writeMany(items);
    const patientCount = await db.selectFrom('patients').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const reqCount = await db.selectFrom('service_requests').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    console.log(`  row counts after 2x write: patients=${patientCount.n} service_requests=${reqCount.n}`);
    if (Number(patientCount.n) !== patients.length) throw new Error(`upsert not idempotent: patients=${patientCount.n}`);
    if (Number(reqCount.n) !== serviceRequests.length) throw new Error(`upsert not idempotent: service_requests=${reqCount.n}`);
    ok('ON DUPLICATE KEY UPDATE upsert is idempotent (no duplicate rows)');

    step('4. Unicode round-trip (utf8mb4 longtext)');
    const uName = 'Здравствуй-世界-🧪';
    await writer.writeMany([{
      resource: { resourceType: 'Patient', id: 'u1', name: [{ family: uName, given: ['Zoë'] }], gender: 'female', birthDate: '1980-05-05' },
      provenance: prov,
    }]);
    const uRow = await db.selectFrom('patients').select(['family_name', 'given_name']).where('id', '=', 'u1').executeTakeFirstOrThrow();
    if (uRow.family_name !== uName) throw new Error(`unicode family_name mismatch: got ${JSON.stringify(uRow.family_name)}`);
    if (uRow.given_name !== 'Zoë') throw new Error(`unicode given_name mismatch: got ${JSON.stringify(uRow.given_name)}`);
    ok('Unicode names (Cyrillic/CJK/emoji) round-trip intact via utf8mb4');

    step('5. Null handling (missing optional fields)');
    await writer.writeMany([{
      resource: { resourceType: 'Patient', id: 'n1', gender: 'unknown' },
      provenance: prov,
    }]);
    const nRow = await db.selectFrom('patients').select(['family_name', 'birth_date']).where('id', '=', 'n1').executeTakeFirstOrThrow();
    if (nRow.family_name !== null) throw new Error(`expected null family_name, got ${JSON.stringify(nRow.family_name)}`);
    if (nRow.birth_date !== null) throw new Error(`expected null birth_date, got ${JSON.stringify(nRow.birth_date)}`);
    ok('Missing optional fields persist as SQL NULL (not empty string)');

    step('6. Scale + idempotency (N=500, batched upsert)');
    const BULK = 500;
    const bulkProv = { sourceSystem: 'mysql-accept-bulk', batchId: 'accept-bulk' };
    const bulkItems = Array.from({ length: BULK }, (_, i) => ({
      resource: { resourceType: 'ServiceRequest', id: `b${i}`, status: 'active', intent: 'order', code: { text: 'Bulk test' }, subject: { reference: 'Patient/u1' }, authoredOn: '2026-03-01T09:00:00Z' },
      provenance: bulkProv,
    }));
    await writer.writeMany(bulkItems);
    await writer.writeMany(bulkItems); // second write must upsert-update, not duplicate
    const bulkCount = await db.selectFrom('service_requests').select((eb) => eb.fn.countAll<number>().as('n')).where('source_system', '=', 'mysql-accept-bulk').executeTakeFirstOrThrow();
    if (Number(bulkCount.n) !== BULK) throw new Error(`expected ${BULK} bulk rows after 2x write, got ${bulkCount.n}`);
    ok(`${BULK} rows batched + idempotent across two writes`);
  } catch (e) {
    failures++;
    console.error('\n[FAIL]', e instanceof Error ? e.stack : e);
  } finally {
    // Clean up the synthetic rows so the script is repeatable.
    try {
      await sql`delete from service_requests where source_system in ('mysql-acceptance', 'mysql-accept-bulk')`.execute(db);
      await sql`delete from patients where source_system = 'mysql-acceptance'`.execute(db);
    } catch { /* ignore cleanup errors */ }
    await store.close();
  }

  console.log(failures === 0 ? '\n✅ MySQL live acceptance PASSED' : '\n❌ MySQL live acceptance FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

void main();
