// Behavior-preservation proof for the q-patient-demographics v2 cutover (restructure R3b, Task 4).
//
// Slice R3b cut q-patient-demographics over to read v2_patients (in-place). This harness PROVES the
// cutover preserves output: it runs the OLD thin-reading Postgres SQL (from `patients` / `birth_date`
// / gender male|female) vs the NEW v2-reading Postgres SQL (from `v2_patients` / `date_of_birth` /
// sex M|F) over the SAME fixed FHIR fixture on real Postgres, and asserts the two produce identical
// rows for every param bag. No hand-computed expected values — the two queries must AGREE, since both
// project the same FHIR fixture (thin via createFlatWriter, v2 via createRelationalWriter).
//
// The THIN reference SQL below is copied VERBATIM from git commit 8045b961 (the commit BEFORE
// dc62d1f6 "cut q-patient-demographics over to v2") — i.e. the last pre-cutover version, which reads
// `from patients p, params pr` and bands on `p.birth_date`.
//
// Preconditions: a reachable dev Postgres external target on :5433 with an `openldr_target` DB.
//   docker compose up -d postgres
//
// Run: node_modules/.bin/tsx scripts/demographics-cutover-accept.ts   (or `pnpm demographics:accept`)
import { Kysely, sql } from 'kysely';
import { createMigrator, externalMigrations, createFlatWriter, createRelationalWriter, type ExternalSchema } from '@openldr/db';
import { createDbStore } from '@openldr/adapter-db-store';
import { prepareSelect } from '@openldr/dashboards';
import { SEED_QUERIES } from '../packages/reporting/src/seed/report-seeds';
import { TABLES, PROV, patients, specimens, serviceRequests, diagnosticReports, observations, normalizeRows, firstDiff } from './lib/reports-parity-fixture';

const PG_URL = process.env.TARGET_DATABASE_URL ?? 'postgresql://openldr:openldr@localhost:5433/openldr_target';

// ── PRE-cutover thin-reading Postgres SQL — copied VERBATIM from
// `git show 8045b961:packages/reporting/src/seed/report-seeds.ts` (the `postgres` variant of
// q-patient-demographics before dc62d1f6). Reads `from patients p, params pr`, bands on
// `p.birth_date`, aggregates `gender` = 'male'/'female'. ──
const THIN_DEMOGRAPHICS_PG_SQL = `with params as (
  select coalesce(nullif({{param.asOf}}, ''), '2026-01-01T00:00:00Z')::date as ref_date
),
banded as (
  select
    case
      when p.birth_date is null then 'unknown'
      when p.birth_date::date > pr.ref_date then 'unknown'
      when extract(year from age(pr.ref_date, p.birth_date::date)) <= 4 then '0-4'
      when extract(year from age(pr.ref_date, p.birth_date::date)) <= 14 then '5-14'
      when extract(year from age(pr.ref_date, p.birth_date::date)) <= 24 then '15-24'
      when extract(year from age(pr.ref_date, p.birth_date::date)) <= 49 then '25-49'
      else '50+'
    end as band,
    p.gender
  from patients p, params pr
  where ({{param.facility}} = '' or p.managing_organization = {{param.facility}})
)
select
  band,
  count(*)::int as total,
  sum(case when gender = 'male' then 1 else 0 end)::int as male,
  sum(case when gender = 'female' then 1 else 0 end)::int as female,
  sum(case when gender is null or gender not in ('male', 'female') then 1 else 0 end)::int as other
from banded
group by band
order by array_position(array['0-4','5-14','15-24','25-49','50+','unknown']::text[], band)`;

async function migrateAndClean(db: Kysely<ExternalSchema>): Promise<void> {
  const migrator = createMigrator(db as unknown as Kysely<unknown>, externalMigrations('postgres'));
  const res = await migrator.migrateToLatest();
  if (res.error) throw res.error;
  for (const t of TABLES) await sql.raw(`delete from ${t}`).execute(db as unknown as Kysely<unknown>);
}

async function seedFixture(db: Kysely<ExternalSchema>): Promise<void> {
  const items = [...patients, ...specimens, ...serviceRequests, ...diagnosticReports, ...observations].map((resource) => ({ resource, provenance: PROV }));
  // Thin schema (createFlatWriter) feeds the OLD SQL's `patients`; v2 schema (createRelationalWriter)
  // feeds the NEW SQL's `v2_patients`. Both project the identical fixture.
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
  const demo = SEED_QUERIES.find((q) => q.id === 'q-patient-demographics');
  if (!demo) throw new Error('SEED_QUERIES is missing q-patient-demographics');
  const V2_DEMOGRAPHICS_PG_SQL = demo.sql.postgres;

  // Sanity: the two SQLs must actually be the thin-vs-v2 pair we intend to compare.
  if (!/from\s+patients\s+p/.test(THIN_DEMOGRAPHICS_PG_SQL)) throw new Error('thin reference SQL does not read `from patients` — wrong commit copied');
  if (!/from\s+v2_patients\s+p/.test(V2_DEMOGRAPHICS_PG_SQL)) throw new Error('v2 SQL does not read `from v2_patients` — cutover not applied?');

  // Both params are optional; the SQL always emits {{param.asOf}} + {{param.facility}} tokens, and
  // substituteParams throws `unbound parameter` on a token whose value is absent. So every bag must
  // carry BOTH keys — default asOf to '' (matches the seed SQL's coalesce(nullif(asOf,''), default)).
  const cases: Record<string, string>[] = [
    { facility: '' },
    { facility: 'Facility A' },
    { facility: 'Facility B' },
    { facility: '', asOf: '2020-01-01' },
    { facility: 'Nonexistent' },
  ].map((bag) => ({ asOf: '', ...bag }));

  const pgStore = createDbStore({ url: PG_URL });
  const pgDb = pgStore.db as unknown as Kysely<ExternalSchema>;
  let failures = 0;
  try {
    console.log(`[setup] postgres target: ${PG_URL}`);
    console.log('[setup] migrating external schema to latest (thin + v2 tables)...');
    await migrateAndClean(pgDb);
    console.log('[setup] seeding fixture into BOTH schemas (flat + relational)...');
    await seedFixture(pgDb);
    console.log(`\n[parity] thin (pre-cutover) vs v2 (post-cutover) demographics SQL, ${cases.length} param bags...\n`);
    for (const bag of cases) {
      const thinSql = prepareSelect(THIN_DEMOGRAPHICS_PG_SQL, demo.params, bag).replace(/;\s*$/, '');
      const v2Sql = prepareSelect(V2_DEMOGRAPHICS_PG_SQL, demo.params, bag).replace(/;\s*$/, '');
      const [thinRaw, v2Raw] = await Promise.all([runQuery(pgDb, thinSql), runQuery(pgDb, v2Sql)]);
      const a = normalizeRows(thinRaw);
      const b = normalizeRows(v2Raw);
      const diff = firstDiff(a, b);
      const label = `facility=${JSON.stringify(bag.facility)} asOf=${JSON.stringify(bag.asOf)}`;
      if (diff) {
        failures++;
        console.log(`FAIL: ${label}  (thin=${thinRaw.length} rows, v2=${v2Raw.length} rows)`);
        console.log(`    ${diff.reason}`);
        console.log(`    thin: ${JSON.stringify(diff.a)}`);
        console.log(`    v2:   ${JSON.stringify(diff.b)}`);
      } else {
        console.log(`PASS: ${label}  (${a.length} rows identical)`);
      }
    }
  } finally {
    // Leave the dev DB clean.
    for (const t of TABLES) await sql.raw(`delete from ${t}`).execute(pgDb as unknown as Kysely<unknown>);
    await pgStore.close();
  }
  if (failures === 0) {
    console.log('\n✅ demographics cutover parity PASSED');
    process.exit(0);
  } else {
    console.log(`\n❌ ${failures} param case(s) diverged — cutover is NOT behavior-preserving`);
    process.exit(1);
  }
}

void main();
