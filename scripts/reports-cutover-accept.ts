// Behavior-preservation proof for the R3c report cutovers (restructure R3c, Task 4).
//
// Slice R3c cut three reports over to read the v2 relational tables:
//   - q-facilities        thin `patients`                     -> v2 `v2_patients`
//   - q-test-volume       thin `service_requests`             -> v2 `v2_lab_requests`
//   - q-turnaround-time   thin `specimens`+`diagnostic_reports` -> v2 `v2_specimens`+`v2_diagnostic_reports`
//
// This harness PROVES each cutover preserves output: it runs the OLD thin-reading Postgres SQL vs the
// NEW v2-reading Postgres SQL over the SAME fixed FHIR fixture on real Postgres, and asserts the two
// produce identical rows for every param bag. No hand-computed expected values — the two queries must
// AGREE, since both project the same FHIR fixture (thin via createFlatWriter, v2 via
// createRelationalWriter).
//
// The THIN reference SQLs below are copied VERBATIM from git commit cc2a1c1e (the R3c branch base,
// BEFORE the T3 rewrite that swapped each query onto the v2 tables). At cc2a1c1e these three read
// `from patients` / `from service_requests` / `from specimens`+`from diagnostic_reports`.
//
// Preconditions: a reachable dev Postgres external target on :5433 with an `openldr_target` DB.
//   docker compose up -d postgres
//
// Run: node_modules/.bin/tsx scripts/reports-cutover-accept.ts   (or `pnpm reports:accept`)
import { Kysely, sql } from 'kysely';
import { createMigrator, externalMigrations, createFlatWriter, createRelationalWriter, type ExternalSchema } from '@openldr/db';
import { createDbStore } from '@openldr/adapter-db-store';
import { prepareSelect } from '@openldr/dashboards';
import { SEED_QUERIES } from '../packages/reporting/src/seed/report-seeds';
import { TABLES, PROV, patients, specimens, serviceRequests, diagnosticReports, observations, normalizeRows, firstDiff } from './lib/reports-parity-fixture';

const PG_URL = process.env.TARGET_DATABASE_URL ?? 'postgresql://openldr:openldr@localhost:5433/openldr_target';

// ── PRE-cutover thin-reading Postgres SQL — copied VERBATIM from
// `git show cc2a1c1e:packages/reporting/src/seed/report-seeds.ts` (the `postgres` variant of each
// report before the R3c T3 rewrite). ──

// q-facilities: reads `from patients`.
const THIN_FACILITIES_PG_SQL = `select distinct managing_organization as facility
from patients
where managing_organization is not null
order by 1`;

// q-test-volume: reads `from service_requests`, bands on authored_on/code_text.
const THIN_TEST_VOLUME_PG_SQL = `select
  to_char(date_trunc('month', sr.authored_on::timestamptz), 'YYYY-MM') as month,
  coalesce(sr.code_text, '(unknown)') as test,
  count(*)::int as count
from service_requests sr
where sr.authored_on >= {{param.from}}
  and sr.authored_on <= ({{param.to}} || 'T23:59:59.999Z')
group by 1, 2
order by 1, 2`;

// q-turnaround-time: reads `from specimens` + `from diagnostic_reports`, joins on subject_ref.
const THIN_TURNAROUND_TIME_PG_SQL = `with received as (
  select subject_ref, min(received_time) as received_time
  from specimens
  where subject_ref is not null and received_time is not null
  group by subject_ref
),
paired as (
  select
    coalesce(dr.code_text, '(unknown)') as test,
    round(extract(epoch from (dr.issued::timestamptz - r.received_time::timestamptz)) / 3600.0)::int as hours
  from diagnostic_reports dr
  join received r on r.subject_ref = dr.subject_ref
  where dr.issued is not null
    and dr.issued >= r.received_time
    and dr.issued >= {{param.from}}
    and dr.issued <= ({{param.to}} || 'T23:59:59.999Z')
    and ({{param.facility}} = '' or dr.subject_ref in (
      select 'Patient/' || p.id from patients p where p.managing_organization = {{param.facility}}
    ))
)
select
  test,
  count(*)::int as count,
  round(avg(hours)::numeric, 1)::float8 as "avgHours",
  min(hours)::int as "minHours",
  max(hours)::int as "maxHours"
from paired
group by test
order by "avgHours" desc, test asc`;

interface Case {
  id: string;
  thinPgSql: string;
  // Every param bag MUST carry every {{param.x}} token the SQL references — substituteParams throws
  // `unbound parameter` on any token whose key is absent from the bag (regardless of a param's own
  // `required` flag). q-facilities has no params; q-test-volume needs from/to; q-turnaround-time
  // needs from/to/facility.
  paramBags: Record<string, string>[];
}

const CASES: Case[] = [
  { id: 'q-facilities', thinPgSql: THIN_FACILITIES_PG_SQL, paramBags: [{}] },
  { id: 'q-test-volume', thinPgSql: THIN_TEST_VOLUME_PG_SQL, paramBags: [{ from: '2026-01-01', to: '2026-12-31' }] },
  {
    id: 'q-turnaround-time',
    thinPgSql: THIN_TURNAROUND_TIME_PG_SQL,
    paramBags: [
      { from: '2026-01-01', to: '2026-12-31', facility: '' },
      { from: '2026-01-01', to: '2026-12-31', facility: 'Facility A' },
    ],
  },
];

// Sanity: the thin SQLs must actually read the thin tables (else the wrong commit was copied).
if (!/from\s+patients\b/.test(THIN_FACILITIES_PG_SQL)) throw new Error('thin q-facilities SQL does not read `from patients` — wrong commit copied');
if (!/from\s+service_requests\b/.test(THIN_TEST_VOLUME_PG_SQL)) throw new Error('thin q-test-volume SQL does not read `from service_requests` — wrong commit copied');
if (!/from\s+specimens\b/.test(THIN_TURNAROUND_TIME_PG_SQL) || !/from\s+diagnostic_reports\b/.test(THIN_TURNAROUND_TIME_PG_SQL)) {
  throw new Error('thin q-turnaround-time SQL does not read `from specimens`/`diagnostic_reports` — wrong commit copied');
}

async function migrateAndClean(db: Kysely<ExternalSchema>): Promise<void> {
  const migrator = createMigrator(db as unknown as Kysely<unknown>, externalMigrations('postgres'));
  const res = await migrator.migrateToLatest();
  if (res.error) throw res.error;
  for (const t of TABLES) await sql.raw(`delete from ${t}`).execute(db as unknown as Kysely<unknown>);
}

async function seedFixture(db: Kysely<ExternalSchema>): Promise<void> {
  const items = [...patients, ...specimens, ...serviceRequests, ...diagnosticReports, ...observations].map((resource) => ({ resource, provenance: PROV }));
  // Thin schema (createFlatWriter) feeds the OLD SQLs' `patients`/`service_requests`/`specimens`/
  // `diagnostic_reports`; v2 schema (createRelationalWriter) feeds the NEW SQLs' `v2_patients`/
  // `v2_lab_requests`/`v2_specimens`/`v2_diagnostic_reports`. Both project the identical fixture.
  const flat = createFlatWriter(db, 'postgres');
  const results = await flat.writeMany(items);
  const skipped = results.filter((r) => r === 'skipped').length;
  if (skipped > 0) throw new Error(`${skipped} fixture item(s) skipped by the flat writer`);

  const rel = createRelationalWriter(db, 'postgres');
  await rel.writeMany(items);
  // rel intentionally skips resource types it doesn't project; don't assert its skip count.
}

async function runQuery(db: Kysely<ExternalSchema>, sqlText: string): Promise<Record<string, unknown>[]> {
  const r = await sql.raw<Record<string, unknown>>(sqlText).execute(db as unknown as Kysely<unknown>);
  return r.rows;
}

async function main(): Promise<void> {
  const pgStore = createDbStore({ url: PG_URL });
  const pgDb = pgStore.db as unknown as Kysely<ExternalSchema>;
  let failures = 0;
  try {
    console.log(`[setup] postgres target: ${PG_URL}`);
    console.log('[setup] migrating external schema to latest (thin + v2 tables)...');
    await migrateAndClean(pgDb);
    console.log('[setup] seeding fixture into BOTH schemas (flat + relational)...');
    await seedFixture(pgDb);

    for (const c of CASES) {
      const seed = SEED_QUERIES.find((q) => q.id === c.id);
      if (!seed) throw new Error(`SEED_QUERIES is missing ${c.id}`);
      const v2Sql = seed.sql.postgres;
      console.log(`\n[parity] ${c.id}: thin (pre-cutover) vs v2 (post-cutover) SQL, ${c.paramBags.length} param bag(s)...`);
      for (const bag of c.paramBags) {
        const thinSql = prepareSelect(c.thinPgSql, seed.params, bag).replace(/;\s*$/, '');
        const v2Text = prepareSelect(v2Sql, seed.params, bag).replace(/;\s*$/, '');
        const [thinRaw, v2Raw] = await Promise.all([runQuery(pgDb, thinSql), runQuery(pgDb, v2Text)]);
        const a = normalizeRows(thinRaw);
        const b = normalizeRows(v2Raw);
        const diff = firstDiff(a, b);
        if (diff) {
          failures++;
          console.log(`FAIL: ${c.id} ${JSON.stringify(bag)}  (thin=${thinRaw.length} rows, v2=${v2Raw.length} rows)`);
          console.log(`    ${diff.reason}`);
          console.log(`    thin: ${JSON.stringify(diff.a)}`);
          console.log(`    v2:   ${JSON.stringify(diff.b)}`);
        } else {
          console.log(`PASS: ${c.id} ${JSON.stringify(bag)}  (${a.length} rows identical)`);
        }
      }
    }
  } finally {
    // Leave the dev DB clean.
    for (const t of TABLES) await sql.raw(`delete from ${t}`).execute(pgDb as unknown as Kysely<unknown>);
    await pgStore.close();
  }
  if (failures === 0) {
    console.log('\n✅ non-AMR reports cutover parity PASSED');
    process.exit(0);
  } else {
    console.log(`\n❌ ${failures} param case(s) diverged — cutover is NOT behavior-preserving`);
    process.exit(1);
  }
}

void main();
