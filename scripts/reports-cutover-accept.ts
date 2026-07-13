// Behavior-preservation proof for the R3c + R3d report cutovers (restructure R3c Task 4 + R3d Task 5).
//
// Slice R3c cut three reports over to read the v2 relational tables:
//   - q-facilities        thin `patients`                     -> v2 `v2_patients`
//   - q-test-volume       thin `service_requests`             -> v2 `v2_lab_requests`
//   - q-turnaround-time   thin `specimens`+`diagnostic_reports` -> v2 `v2_specimens`+`v2_diagnostic_reports`
//
// Slice R3d cut the five AMR reports over (thin `observations`/`specimens`/`patients` -> v2
// `v2_lab_results`/`v2_specimens`/`v2_patients`):
//   - q-amr-resistance, q-amr-facility-summary, q-amr-glass-ris, q-amr-first-isolate-summary,
//     q-amr-antibiogram
//
// This harness PROVES each cutover preserves output: it runs the OLD thin-reading Postgres SQL vs the
// NEW v2-reading Postgres SQL over the SAME fixed FHIR fixture on real Postgres, and asserts the two
// produce identical rows for every param bag. No hand-computed expected values — the two queries must
// AGREE, since both project the same FHIR fixture (thin via createFlatWriter, v2 via
// createRelationalWriter).
//
// The non-AMR THIN reference SQLs are copied VERBATIM from git commit cc2a1c1e (the R3c branch base,
// BEFORE the T3 rewrite that swapped each query onto the v2 tables). At cc2a1c1e these three read
// `from patients` / `from service_requests` / `from specimens`+`from diagnostic_reports`. The 5 AMR
// THIN reference SQLs are copied VERBATIM from git commit 7fa6b317 (origin/main, the R3d branch base,
// BEFORE the R3d rewrite); at 7fa6b317 those read `from observations`(+`patients`/`specimens`).
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

// ── PRE-R3d thin-reading Postgres SQL for the 5 AMR reports — copied VERBATIM from
// `git show 7fa6b317:packages/reporting/src/seed/report-seeds.ts` (the `postgres` variant of each
// AMR report BEFORE the R3d rewrite that swapped them onto the v2 relational tables). At 7fa6b317
// these all read `from observations` (facility-summary also joins `patients`; glass-ris /
// first-isolate / antibiogram also read `from specimens`). ──

// q-amr-resistance: reads `from observations`, optional facility subquery over `patients`.
const THIN_AMR_RESISTANCE_PG_SQL = `select
  coalesce(o.code_text, '(unknown)') as antibiotic,
  count(*)::int as tested,
  sum(case when o.interpretation_code = 'R' then 1 else 0 end)::int as r,
  sum(case when o.interpretation_code = 'I' then 1 else 0 end)::int as i,
  sum(case when o.interpretation_code = 'S' then 1 else 0 end)::int as s,
  round(100.0 * sum(case when o.interpretation_code = 'R' then 1 else 0 end) / nullif(count(*), 0), 1)::float8 as "percentR"
from observations o
where o.interpretation_code in ('S', 'I', 'R')
  and o.effective_date_time >= {{param.from}}
  and o.effective_date_time <= ({{param.to}} || 'T23:59:59.999Z')
  and ({{param.facility}} = '' or o.subject_ref in (
    select 'Patient/' || p.id from patients p where p.managing_organization = {{param.facility}}
  ))
group by coalesce(o.code_text, '(unknown)')
order by "percentR" desc`;

// q-amr-facility-summary: reads `from observations`, joins `patients` on subject_ref.
const THIN_AMR_FACILITY_SUMMARY_PG_SQL = `select
  p.managing_organization as facility,
  count(*)::int as tested,
  sum(case when o.interpretation_code = 'R' then 1 else 0 end)::int as resistant
from observations o
join patients p on o.subject_ref = 'Patient/' || p.id
where o.interpretation_code in ('S', 'I', 'R')
  and o.subject_ref is not null and o.subject_ref <> ''
  and p.managing_organization is not null
  and o.effective_date_time >= {{param.from}}
  and o.effective_date_time <= ({{param.to}} || 'T23:59:59.999Z')
group by p.managing_organization
order by p.managing_organization`;

// q-amr-glass-ris: reads `from observations` + `from specimens` + `from patients` (first-isolate
// dedup, GLASS age banding, gender/origin stratification).
const THIN_AMR_GLASS_RIS_PG_SQL = `with org_obs as (
  select o.id, o.specimen_ref, o.subject_ref, o.value_code, o.value_text, o.effective_date_time
  from observations o
  where o.code_code = '634-6'
    and o.specimen_ref is not null and o.specimen_ref <> ''
    and o.subject_ref is not null and o.subject_ref <> ''
),
isolate_meta as (
  select
    oo.id as obs_id,
    oo.specimen_ref,
    oo.subject_ref,
    coalesce(s.type_code, '(unknown)') as specimen_type,
    case when s.origin in ('inpatient', 'outpatient') then s.origin else 'unknown' end as origin,
    coalesce(oo.value_code, '(unknown)') as pathogen_code,
    coalesce(oo.value_text, oo.value_code, '(unknown)') as pathogen_name,
    coalesce(oo.effective_date_time, s.received_time) as iso_date,
    coalesce(p.gender, 'unknown') as gender,
    p.birth_date
  from org_obs oo
  left join specimens s on oo.specimen_ref = 'Specimen/' || s.id
  left join patients p on oo.subject_ref = 'Patient/' || p.id
  where coalesce(oo.effective_date_time, s.received_time) is null
     or (coalesce(oo.effective_date_time, s.received_time) >= {{param.from}}
         and coalesce(oo.effective_date_time, s.received_time) <= ({{param.to}} || 'T23:59:59.999Z'))
),
age_banded as (
  select im.*,
    extract(year from age(coalesce(im.iso_date, '1970-01-01')::date, im.birth_date::date))::int as age_years
  from isolate_meta im
),
first_isolates as (
  select distinct on (subject_ref, pathogen_code, specimen_type)
    obs_id, specimen_ref, subject_ref, specimen_type, origin, pathogen_code, pathogen_name, iso_date, gender,
    case
      when birth_date is null then 'unknown'
      when age_years < 0 then 'unknown'
      when age_years >= 65 then '65+'
      when age_years = 0 then '0'
      when age_years between 1 and 4 then '1-4'
      when age_years between 5 and 14 then '5-14'
      when age_years between 15 and 24 then '15-24'
      when age_years between 25 and 34 then '25-34'
      when age_years between 35 and 44 then '35-44'
      when age_years between 45 and 54 then '45-54'
      when age_years between 55 and 64 then '55-64'
      else 'unknown'
    end as age_band
  from age_banded
  order by subject_ref, pathogen_code, specimen_type, (iso_date is null), iso_date asc, obs_id asc
),
ast_obs as (
  select o.specimen_ref, o.code_text as antibiotic, o.interpretation_code as ris
  from observations o
  where o.interpretation_code in ('S', 'I', 'R')
    and o.code_text is not null
    and o.specimen_ref is not null and o.specimen_ref <> ''
),
results as (
  select fi.*, a.antibiotic, a.ris
  from first_isolates fi
  join ast_obs a on a.specimen_ref = fi.specimen_ref
)
select
  coalesce(nullif({{param.country}}, ''), 'XXX') as "Iso3Country",
  coalesce(nullif({{param.year}}, ''), '0')::int as "Year",
  specimen_type as "Specimen",
  pathogen_code as "PathogenCode",
  antibiotic as "AntibioticCode",
  gender as "Gender",
  age_band as "AgeGroup",
  origin as "Origin",
  sum(case when ris = 'R' then 1 else 0 end)::int as "Resistant",
  sum(case when ris = 'I' then 1 else 0 end)::int as "Intermediate",
  sum(case when ris = 'S' then 1 else 0 end)::int as "Susceptible",
  count(*)::int as "Total"
from results
group by specimen_type, pathogen_code, antibiotic, gender, age_band, origin
order by "Specimen", "PathogenCode", "AntibioticCode", "Gender", "AgeGroup", "Origin"`;

// q-amr-first-isolate-summary: reads `from observations` + `from specimens` + `from patients`
// (same first-isolate CTE chain as glass-ris; aggregation by specimenType x pathogen x antibiotic).
const THIN_AMR_FIRST_ISOLATE_PG_SQL = `with org_obs as (
  select o.id, o.specimen_ref, o.subject_ref, o.value_code, o.value_text, o.effective_date_time
  from observations o
  where o.code_code = '634-6'
    and o.specimen_ref is not null and o.specimen_ref <> ''
    and o.subject_ref is not null and o.subject_ref <> ''
),
isolate_meta as (
  select
    oo.id as obs_id,
    oo.specimen_ref,
    oo.subject_ref,
    coalesce(s.type_code, '(unknown)') as specimen_type,
    case when s.origin in ('inpatient', 'outpatient') then s.origin else 'unknown' end as origin,
    coalesce(oo.value_code, '(unknown)') as pathogen_code,
    coalesce(oo.value_text, oo.value_code, '(unknown)') as pathogen_name,
    coalesce(oo.effective_date_time, s.received_time) as iso_date,
    coalesce(p.gender, 'unknown') as gender,
    p.birth_date
  from org_obs oo
  left join specimens s on oo.specimen_ref = 'Specimen/' || s.id
  left join patients p on oo.subject_ref = 'Patient/' || p.id
  where coalesce(oo.effective_date_time, s.received_time) is null
     or (coalesce(oo.effective_date_time, s.received_time) >= {{param.from}}
         and coalesce(oo.effective_date_time, s.received_time) <= ({{param.to}} || 'T23:59:59.999Z'))
),
age_banded as (
  select im.*,
    extract(year from age(coalesce(im.iso_date, '1970-01-01')::date, im.birth_date::date))::int as age_years
  from isolate_meta im
),
first_isolates as (
  select distinct on (subject_ref, pathogen_code, specimen_type)
    obs_id, specimen_ref, subject_ref, specimen_type, origin, pathogen_code, pathogen_name, iso_date, gender,
    case
      when birth_date is null then 'unknown'
      when age_years < 0 then 'unknown'
      when age_years >= 65 then '65+'
      when age_years = 0 then '0'
      when age_years between 1 and 4 then '1-4'
      when age_years between 5 and 14 then '5-14'
      when age_years between 15 and 24 then '15-24'
      when age_years between 25 and 34 then '25-34'
      when age_years between 35 and 44 then '35-44'
      when age_years between 45 and 54 then '45-54'
      when age_years between 55 and 64 then '55-64'
      else 'unknown'
    end as age_band
  from age_banded
  order by subject_ref, pathogen_code, specimen_type, (iso_date is null), iso_date asc, obs_id asc
),
ast_obs as (
  select o.specimen_ref, o.code_text as antibiotic, o.interpretation_code as ris
  from observations o
  where o.interpretation_code in ('S', 'I', 'R')
    and o.code_text is not null
    and o.specimen_ref is not null and o.specimen_ref <> ''
),
results as (
  select fi.*, a.antibiotic, a.ris
  from first_isolates fi
  join ast_obs a on a.specimen_ref = fi.specimen_ref
)
select
  specimen_type as "specimenType",
  pathogen_code as "pathogen",
  antibiotic,
  count(*)::int as tested,
  sum(case when ris = 'R' then 1 else 0 end)::int as r,
  sum(case when ris = 'I' then 1 else 0 end)::int as i,
  sum(case when ris = 'S' then 1 else 0 end)::int as s,
  round(100.0 * sum(case when ris = 'R' then 1 else 0 end) / nullif(count(*), 0), 1)::float8 as "percentR"
from results
group by specimen_type, pathogen_code, antibiotic
order by specimen_type, pathogen_code, antibiotic`;

// q-amr-antibiogram: the base-commit postgres SQL is a template literal whose antibiotic columns
// are interpolated via `${ANTIBIOGRAM_PANEL.map((a) => antibiogramCellSql(a, 'postgres')).join(...)}`.
// `antibiogramCellSql` is NOT exported from report-seeds.ts, so (per the task's fallback path) we do
// NOT modify that module just to export an internal. Instead we reconstruct the fully-expanded thin
// SQL as: the thin CTE prefix (copied verbatim from 7fa6b317 — reads `from observations`/`from
// specimens`) + the v2 report's ALREADY-EXPANDED select tail. The tail (`select pathogen_code as
// pathogen, <panel cells> from results group by ... order by ...`) is byte-identical between thin and
// v2 at the source level — it only references the `results` CTE's unchanged `pathogen_code`/
// `antibiotic`/`ris` aliases — so slicing it off the v2 SQL yields exactly the panel expansion the
// thin report produced, with only the (reverted) CTE block differing.
const THIN_AMR_ANTIBIOGRAM_PREFIX = `with org_obs as (
  select o.id, o.specimen_ref, o.subject_ref, o.value_code, o.value_text, o.effective_date_time
  from observations o
  where o.code_code = '634-6'
    and o.specimen_ref is not null and o.specimen_ref <> ''
    and o.subject_ref is not null and o.subject_ref <> ''
),
isolate_meta as (
  select
    oo.id as obs_id,
    oo.specimen_ref,
    oo.subject_ref,
    coalesce(s.type_code, '(unknown)') as specimen_type,
    coalesce(oo.value_code, '(unknown)') as pathogen_code,
    coalesce(oo.effective_date_time, s.received_time) as iso_date
  from org_obs oo
  left join specimens s on oo.specimen_ref = 'Specimen/' || s.id
  where coalesce(oo.effective_date_time, s.received_time) is null
     or (coalesce(oo.effective_date_time, s.received_time) >= {{param.from}}
         and coalesce(oo.effective_date_time, s.received_time) <= ({{param.to}} || 'T23:59:59.999Z'))
),
first_isolates as (
  select distinct on (subject_ref, pathogen_code, specimen_type)
    obs_id, specimen_ref, pathogen_code
  from isolate_meta
  order by subject_ref, pathogen_code, specimen_type, (iso_date is null), iso_date asc, obs_id asc
),
ast_obs as (
  select o.specimen_ref, o.code_text as antibiotic, o.interpretation_code as ris
  from observations o
  where o.interpretation_code in ('S', 'I', 'R')
    and o.code_text is not null
    and o.specimen_ref is not null and o.specimen_ref <> ''
),
results as (
  select fi.pathogen_code, a.antibiotic, a.ris
  from first_isolates fi
  join ast_obs a on a.specimen_ref = fi.specimen_ref
)`;
// Splice: reuse the v2 antibiogram's fully-expanded select tail (byte-identical panel expansion).
const ANTIBIOGRAM_TAIL_MARKER = '\nselect\n  pathogen_code as pathogen,';
const V2_ANTIBIOGRAM_SQL = SEED_QUERIES.find((q) => q.id === 'q-amr-antibiogram')?.sql.postgres ?? '';
const antibiogramTailIdx = V2_ANTIBIOGRAM_SQL.indexOf(ANTIBIOGRAM_TAIL_MARKER);
if (antibiogramTailIdx < 0) throw new Error('could not locate the antibiogram select tail in the v2 SQL — cannot build the thin reference');
const THIN_AMR_ANTIBIOGRAM_PG_SQL = THIN_AMR_ANTIBIOGRAM_PREFIX + V2_ANTIBIOGRAM_SQL.slice(antibiogramTailIdx);

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
  // ── R3d AMR cutovers ──
  {
    id: 'q-amr-resistance',
    thinPgSql: THIN_AMR_RESISTANCE_PG_SQL,
    paramBags: [
      { from: '2026-01-01', to: '2026-12-31', facility: '' },
      // 'Facility A' has AST-result observations (pt-01/pt-07/pt-08) -> a non-trivial filtered result.
      { from: '2026-01-01', to: '2026-12-31', facility: 'Facility A' },
    ],
  },
  { id: 'q-amr-facility-summary', thinPgSql: THIN_AMR_FACILITY_SUMMARY_PG_SQL, paramBags: [{ from: '2026-01-01', to: '2026-12-31' }] },
  {
    id: 'q-amr-glass-ris',
    thinPgSql: THIN_AMR_GLASS_RIS_PG_SQL,
    paramBags: [
      { from: '2026-01-01', to: '2026-12-31', country: '', year: '' },
      { from: '2026-01-01', to: '2026-12-31', country: 'ZMB', year: '2026' },
    ],
  },
  { id: 'q-amr-first-isolate-summary', thinPgSql: THIN_AMR_FIRST_ISOLATE_PG_SQL, paramBags: [{ from: '2026-01-01', to: '2026-12-31' }] },
  { id: 'q-amr-antibiogram', thinPgSql: THIN_AMR_ANTIBIOGRAM_PG_SQL, paramBags: [{ from: '2026-01-01', to: '2026-12-31' }] },
];

// Sanity: the thin SQLs must actually read the thin tables (else the wrong commit was copied).
if (!/from\s+patients\b/.test(THIN_FACILITIES_PG_SQL)) throw new Error('thin q-facilities SQL does not read `from patients` — wrong commit copied');
if (!/from\s+service_requests\b/.test(THIN_TEST_VOLUME_PG_SQL)) throw new Error('thin q-test-volume SQL does not read `from service_requests` — wrong commit copied');
if (!/from\s+specimens\b/.test(THIN_TURNAROUND_TIME_PG_SQL) || !/from\s+diagnostic_reports\b/.test(THIN_TURNAROUND_TIME_PG_SQL)) {
  throw new Error('thin q-turnaround-time SQL does not read `from specimens`/`diagnostic_reports` — wrong commit copied');
}
// AMR thin references — all 5 read `from observations`; facility-summary also joins `patients`;
// glass-ris / first-isolate / antibiogram also read `from specimens`.
if (!/from\s+observations\b/.test(THIN_AMR_RESISTANCE_PG_SQL)) throw new Error('thin q-amr-resistance SQL does not read `from observations` — wrong commit copied');
if (!/from\s+observations\b/.test(THIN_AMR_FACILITY_SUMMARY_PG_SQL) || !/join\s+patients\b/.test(THIN_AMR_FACILITY_SUMMARY_PG_SQL)) {
  throw new Error('thin q-amr-facility-summary SQL does not read `from observations`/`join patients` — wrong commit copied');
}
if (!/from\s+observations\b/.test(THIN_AMR_GLASS_RIS_PG_SQL) || !/join\s+specimens\b/.test(THIN_AMR_GLASS_RIS_PG_SQL)) {
  throw new Error('thin q-amr-glass-ris SQL does not read `from observations`/`join specimens` — wrong commit copied');
}
if (!/from\s+observations\b/.test(THIN_AMR_FIRST_ISOLATE_PG_SQL) || !/join\s+specimens\b/.test(THIN_AMR_FIRST_ISOLATE_PG_SQL)) {
  throw new Error('thin q-amr-first-isolate-summary SQL does not read `from observations`/`join specimens` — wrong commit copied');
}
if (!/from\s+observations\b/.test(THIN_AMR_ANTIBIOGRAM_PG_SQL) || !/join\s+specimens\b/.test(THIN_AMR_ANTIBIOGRAM_PG_SQL)) {
  throw new Error('thin q-amr-antibiogram SQL does not read `from observations`/`join specimens` — wrong commit copied');
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
    console.log('\n✅ non-AMR + AMR reports cutover parity PASSED');
    process.exit(0);
  } else {
    console.log(`\n❌ ${failures} param case(s) diverged — cutover is NOT behavior-preserving`);
    process.exit(1);
  }
}

void main();
