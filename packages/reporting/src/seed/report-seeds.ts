import type { NewCustomQuery, ReportRecord, CustomQueryStore, ReportStore, ConnectorStore } from '@openldr/db';
import type { ReportDesign, ReportDesignStore } from '@openldr/report-designer';
import { simpleTableDesign } from './simple-design';

// S4 seed data: the query + design + report-record triples that replace the hardcoded catalog
// reports (`packages/reporting/src/reports/*.ts`) with data-driven ones. Task 4.2 (worked example)
// appends `amr-resistance`'s triple below; Tasks 4.3-4.8 append one each for the remaining six.

/** Name used to dedup the default target-warehouse connector — matches
 *  `packages/bootstrap/src/seed.ts`'s `DEFAULT_CONNECTOR_NAME`. Every `SEED_QUERIES` entry is
 *  authored with `connectorId: ''` (it isn't known until seed time — the connector is a
 *  server-generated `randomUUID()`, deduped by this name) and `seedDataDrivenReports` stamps the
 *  resolved id on before `create`. */
export const DEFAULT_CONNECTOR_NAME = 'Target Warehouse (Postgres)';

/** Custom queries (bound to a connector) that back the seeded report designs. `connectorId: ''`
 *  is a placeholder — `seedDataDrivenReports` resolves the real default-connector id and stamps
 *  it on before insert (see `DEFAULT_CONNECTOR_NAME`). */
export const SEED_QUERIES: NewCustomQuery[] = [
  {
    id: 'q-facilities',
    name: 'Facilities (options)',
    connectorId: '',
    params: [],
    sql: `select distinct managing_organization as facility
from patients
where managing_organization is not null
order by 1`,
  },
  {
    id: 'q-amr-resistance',
    name: 'AMR resistance rate',
    connectorId: '',
    // NOTE on param shape: `ctx.reporting.run(id, rawParams)` forwards `rawParams` (the flat
    // `{from,to,facility}` filter bag the Reports page/route builds) straight through to
    // `runStoredQuery` → `substituteParams(sql, query.params, values)` with NO reshaping. So
    // these `CustomQueryParam`s must read `values.from`/`values.to`/`values.facility` directly
    // (two plain `text` params, NOT one `daterange` param — a `daterange` param reads
    // `values[p.id]` as a nested `{from,to}` object, which only the Query-workbench's
    // `RunParamsSheet` builds; the Reports page never does). Verified empirically against
    // `packages/dashboards/src/custom-query-run.ts`'s `substituteParams`.
    params: [
      { id: 'from', label: 'From', type: 'text', required: true },
      { id: 'to', label: 'To', type: 'text', required: true },
      { id: 'facility', label: 'Facility', type: 'text', required: false },
    ],
    // Mirrors packages/reporting/src/reports/amr-resistance.ts + helpers.ts (pivotResistance +
    // endOfDay) exactly:
    //  - group observations with interpretation_code in (S,I,R) by antibiotic (code_text,
    //    coalesced to '(unknown)' as the JS pivot does via `?? '(unknown)'`)
    //  - tested/r/i/s via CASE conditional aggregates (replaces the JS pivot)
    //  - percentR = round(100 * r / tested, 1), matching `Math.round((r/tested)*1000)/10`
    //  - row order: `percentR` DESCENDING, matching pivotResistance's `b.percentR - a.percentR`
    //    (the catalog has no secondary tiebreaker, so tie order is nondeterministic there)
    //  - date range: `effective_date_time >= from` and `<= to || 'T23:59:59.999Z'` (== endOfDay)
    //  - facility: optional equality on patients.managing_organization, mapped to
    //    subject_ref = 'Patient/'||id (catalog's `subjectRefs` mapping). The `{{param.facility}}`
    //    token is a plain string substitution — an UNSET token throws "unbound parameter" even
    //    when the param is declared `required:false` (see custom-query-run.ts). So this filter
    //    is only truly optional if every caller always supplies `facility` (empty string for
    //    "no filter"); the seeded design's `facility` param should default to `''` for this
    //    reason. Confirmed live in the Task 4.2 parity check.
    sql: `select
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
order by "percentR" desc`,
  },
  {
    id: 'q-test-volume',
    name: 'Test volume by month',
    connectorId: '',
    // Mirrors packages/reporting/src/reports/test-volume.ts exactly: group service_requests by
    // month(authored_on) x test (code_text, coalesced to '(unknown)'), COUNT(*). The catalog also
    // declares a `facility` select parameter but never actually applies it in `run()` (only
    // p.from/p.to are read) — reproduced faithfully by exposing `facility` on the seeded DESIGN's
    // filter bar (so the UI matches) without referencing `{{param.facility}}` in this SQL at all.
    //  - month bucket: to_char(date_trunc('month', authored_on), 'YYYY-MM'), matching monthKey()'s
    //    `${getFullYear()}-${pad(getMonth()+1)}` (dev DB session TimeZone is UTC and authored_on is
    //    a date-only string, so there's no local-vs-UTC boundary ambiguity here).
    //  - date range: `from`/`to` are REQUIRED here (the catalog treats them as optional, but
    //    substituteParams throws "unbound parameter" for any {{param.x}} token missing from the
    //    values bag regardless of a param's own `required` flag — same reasoning as
    //    q-amr-resistance; simpler to just require the range than guard every date comparison).
    //    endOfDay: `<= (to || 'T23:59:59.999Z')`.
    //  - row order: month ASC, then test ASC — matches the catalog's explicit
    //    `.sort((a,b) => month asc, then test.localeCompare(test))`.
    params: [
      { id: 'from', label: 'From', type: 'text', required: true },
      { id: 'to', label: 'To', type: 'text', required: true },
    ],
    sql: `select
  to_char(date_trunc('month', sr.authored_on::timestamptz), 'YYYY-MM') as month,
  coalesce(sr.code_text, '(unknown)') as test,
  count(*)::int as count
from service_requests sr
where sr.authored_on >= {{param.from}}
  and sr.authored_on <= ({{param.to}} || 'T23:59:59.999Z')
group by 1, 2
order by 1, 2`,
  },
  {
    id: 'q-turnaround-time',
    name: 'Specimen turnaround time',
    connectorId: '',
    // Mirrors packages/reporting/src/reports/turnaround-time.ts: pair each diagnostic_report with
    // its patient's EARLIEST specimen receipt (no direct report->specimen FK in the flat schema) —
    // the `received` CTE is intentionally NOT date/facility filtered, matching the catalog, which
    // builds its `earliest` map from ALL specimens up front and only filters the REPORTS side by
    // date/facility while iterating. `hours` = round((issued - received) / 1h), matching
    // hoursBetween's `Math.round((b-a)/3_600_000)`; rows with no specimen match or issued <
    // received are excluded (mirrors `b < a -> null`). Grouped by test (code_text, coalesced
    // '(unknown)'): count, avgHours = round(avg(already-rounded whole-hour values), 1) (mirrors
    // `Math.round((sum/n)*10)/10` — the catalog rounds EACH report's hours to a whole number
    // first, THEN averages those rounded values, THEN rounds the average to 1 decimal — the CTE's
    // `hours` column is that first whole-number rounding), minHours/maxHours = min/max of the same
    // whole-hour values.
    //  - facility filter (optional): same '' = no-filter guard as q-amr-resistance, applied to
    //    diagnostic_reports.subject_ref via patients.managing_organization.
    //  - date range: from/to REQUIRED (see q-test-volume's note on why); endOfDay applied to `to`.
    //  - row order: avgHours DESCENDING, matching `rows.sort((a,b) => b.avgHours - a.avgHours)`.
    //    The catalog has no secondary tiebreaker (nondeterministic tie order there); `test asc` is
    //    added here only as an explicit, documented tiebreaker for determinism — the parity check
    //    normalizes ties the same way before comparing, not to mask a primary-order divergence.
    //  - KNOWN GAP (fidelity, not fixable in SQL): the catalog's chart is
    //    `{type:'stat', value:String(overallAvg), label:'Overall avg hours'}`, a value computed
    //    FRESH from that run's rows (a count-weighted average across all test groups). A
    //    data-driven report's `chart` is a static field on the `reports` record
    //    (packages/bootstrap/src/index.ts `runDataDriven` uses `def.chart` as-is, never
    //    recomputed), so this can't be reproduced as a live number — seeded with a placeholder.
    //    Not a blocker in practice: the Reports page (apps/studio/src/reports/*) doesn't render
    //    `chart` at all today (only `summaryMetrics`, which DOES recompute per-run generically).
    params: [
      { id: 'from', label: 'From', type: 'text', required: true },
      { id: 'to', label: 'To', type: 'text', required: true },
      { id: 'facility', label: 'Facility', type: 'text', required: false },
    ],
    sql: `with received as (
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
order by "avgHours" desc, test asc`,
  },
  {
    id: 'q-patient-demographics',
    name: 'Patient demographics by age band',
    connectorId: '',
    // Mirrors packages/reporting/src/reports/patient-demographics.ts + helpers.ts's ageBand():
    // calendar-exact age (Postgres `age()` performs the same year/month/day-borrow subtraction as
    // the JS algorithm) banded into the same fixed buckets, grouped by band x gender (male/female/
    // other, where 'other' folds NULL and any non-male/female value — matches the JS else-branch).
    //  - `asOf` (optional, a single reference date — NOT a range): catalog defaults to
    //    '2026-01-01T00:00:00Z' when unset/empty. Same '' = "use default" guard as facility below.
    //  - facility filter (optional): same '' = no-filter guard as q-amr-resistance; direct equality
    //    on patients.managing_organization (no subject_ref indirection — this query reads
    //    `patients` directly, unlike the AMR/TAT queries).
    //  - row order: the FIXED band order ['0-4','5-14','15-24','25-49','50+','unknown'], NOT a
    //    count-based sort — matches the catalog's `ORDER.filter(b => counts.has(b)).map(...)`.
    params: [
      { id: 'facility', label: 'Facility', type: 'text', required: false },
      { id: 'asOf', label: 'As of', type: 'text', required: false },
    ],
    sql: `with params as (
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
order by array_position(array['0-4','5-14','15-24','25-49','50+','unknown']::text[], band)`,
  },
  {
    id: 'q-amr-facility-summary',
    name: 'AMR resistance by facility',
    connectorId: '',
    // Mirrors packages/reporting/src/reports/amr-facility-summary.ts exactly: WIDE format, one row
    // per facility (patients.managing_organization), tested = all AST results (interpretation_code
    // in S/I/R) whose patient resolves to a facility, resistant = the R subset. Observations whose
    // patient has no facility (or no matching patient row at all) are dropped by the join, mirroring
    // the catalog's `if (!facility) continue`.
    //  - date range: `from`/`to` REQUIRED here (catalog treats them as optional — same reasoning as
    //    q-test-volume/q-turnaround-time: substituteParams throws "unbound parameter" for any
    //    {{param.x}} token missing from values regardless of the param's own `required` flag, so
    //    it's simpler to just require the range). endOfDay applied to `to`.
    //  - patient join: reconstructs `'Patient/' || p.id` and compares directly against
    //    o.subject_ref (matches the catalog's literal `.replace(/^Patient\//, '')` — a plain
    //    equality join is the safe SQL mirror rather than a generic prefix-strip).
    //  - row order: facility ASC — matches the catalog's explicit `.sort((a,b) =>
    //    a.facility.localeCompare(b.facility))`.
    params: [
      { id: 'from', label: 'From', type: 'text', required: true },
      { id: 'to', label: 'To', type: 'text', required: true },
    ],
    sql: `select
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
order by p.managing_organization`,
  },
  {
    id: 'q-amr-glass-ris',
    name: 'AMR GLASS RIS (stratified)',
    connectorId: '',
    // Mirrors packages/reporting/src/reports/amr-glass-ris.ts + the shared AMR helpers
    // (packages/reporting/src/amr/{query,isolates,glass}.ts) exactly. An "isolate" is ONE row per
    // organism-identification observation (`code_code = '634-6'`); its antibiotic results are ALL
    // susceptibility observations (`interpretation_code in S/I/R`) sharing its `specimen_ref`
    // (joined by specimen only — NOT date/patient-scoped, matching `buildIsolates`'s `astBySpec`
    // map, which is built from the FULL unfiltered ast set — see fetchAmrData: only `org` rows are
    // window-filtered, `ast` never is).
    //  - DEDUP KEY (first-isolate): `(subject_ref, pathogen_code /* value_code, else '(unknown)' */,
    //    specimen_type /* specimens.type_code, else '(unknown)' */)` — one row per key, keeping the
    //    EARLIEST `iso_date` (= coalesce(effective_date_time, specimen.received_time); a NULL date
    //    is a valid key value and is always kept ("dateless retained") per `firstIsolate`'s
    //    null-sorts-last comparator — reproduced here as `distinct on (...) order by ...,
    //    (iso_date is null), iso_date asc, obs_id asc`. TIEBREAK: the catalog's underlying sort is
    //    stable but `fetchAmrData`'s org query has no ORDER BY, so a same-date tie's winner depends
    //    on Postgres's unspecified default row-return order — genuinely nondeterministic there. This
    //    SQL adds `obs_id asc` as an explicit, DETERMINISTIC tiebreaker (documented, not hidden) so
    //    the data-driven path is reproducible; the live parity fixture below was built with NO
    //    same-date ties so this tiebreaker never actually decides a winner in the checked cases.
    //  - window filter applies ONLY to the isolate-identifying (org) observation's date, exactly as
    //    fetchAmrData does; the antibiotic-result (ast) join is never date-filtered.
    //  - age band: GLASS bands (ageBandGlass) computed from the patient's birth_date relative to the
    //    isolate's OWN date (or '1970-01-01' if dateless) via Postgres `age()`, which performs the
    //    same calendar year/month/day-borrow subtraction as the JS algorithm (same technique already
    //    used/validated by q-patient-demographics's age banding).
    //  - country/year: the catalog defaults `country` to `'XXX'` and `year` to `0` when unset (zod
    //    `.default(...)`). Both `{{param.country}}`/`{{param.year}}` tokens are ALWAYS bound
    //    (substituteParams throws on any unbound token) — same '' = "use default" guard as
    //    q-patient-demographics's `asOf`: `coalesce(nullif({{param.X}}, ''), '<default>')`. The
    //    seeded design defaults both params' `value` to `''` so an untouched filter still resolves.
    //  - final grouping: specimenType x pathogen x antibiotic x gender x ageBand x origin, matching
    //    `toGlassRis`'s grouping key `[specimenType, pathogenCode, antibiotic, gender, ageBand,
    //    origin]`.
    //  - row order: Specimen, PathogenCode, AntibioticCode, Gender, AgeGroup, Origin all ASC —
    //    matches `toGlassRis`'s explicit chained `.localeCompare` sort.
    params: [
      { id: 'from', label: 'From', type: 'text', required: true },
      { id: 'to', label: 'To', type: 'text', required: true },
      { id: 'country', label: 'Country code', type: 'text', required: false },
      { id: 'year', label: 'Year', type: 'text', required: false },
    ],
    sql: `with org_obs as (
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
order by "Specimen", "PathogenCode", "AntibioticCode", "Gender", "AgeGroup", "Origin"`,
  },
  {
    id: 'q-amr-first-isolate-summary',
    name: 'AMR first-isolate resistance summary',
    connectorId: '',
    // Mirrors packages/reporting/src/reports/amr-first-isolate-summary.ts + the shared AMR helpers
    // (packages/reporting/src/amr/{query,isolates,aggregate}.ts) exactly. Same first-isolate CTE
    // shape as q-amr-glass-ris (see its comment for the full dedup-key/tiebreak/window-scoping
    // rationale — identical here), but the final aggregation groups only by specimenType x pathogen
    // x antibiotic (no gender/age/origin stratification), matching `aggregateRIS`'s grouping key.
    //  - aggregateRIS grouping: specimenType x pathogen x antibiotic -> tested/r/i/s/percentR (CASE
    //    conditional aggregates, `percentR` rounding matches q-amr-resistance's pattern exactly).
    //  - row order: specimenType ASC, pathogen ASC, antibiotic ASC — matches aggregateRIS's explicit
    //    `.sort((a,b) => specimenType.localeCompare || pathogen.localeCompare || antibiotic.localeCompare)`.
    params: [
      { id: 'from', label: 'From', type: 'text', required: true },
      { id: 'to', label: 'To', type: 'text', required: true },
    ],
    sql: `with org_obs as (
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
order by specimen_type, pathogen_code, antibiotic`,
  },
];

/** Report-designer page designs, one table bound to a `SEED_QUERIES` entry (via `simpleTableDesign`). */
export const SEED_DESIGNS: ReportDesign[] = [
  simpleTableDesign({
    id: 'rt-amr-resistance',
    name: 'AMR Resistance Rate',
    queryId: 'q-amr-resistance',
    columns: [
      { key: 'antibiotic', label: 'Antibiotic' },
      { key: 'tested', label: 'Tested' },
      { key: 'r', label: 'R' },
      { key: 'i', label: 'I' },
      { key: 's', label: 'S' },
      { key: 'percentR', label: '%R' },
    ],
    parameters: [
      { key: 'dateRange', label: 'Date range', type: 'daterange', required: true },
      { key: 'facility', label: 'Facility', type: 'select', required: false, value: '' },
    ],
  }),
  simpleTableDesign({
    id: 'rt-test-volume',
    name: 'Test Volume Over Time',
    queryId: 'q-test-volume',
    columns: [
      { key: 'month', label: 'Month' },
      { key: 'test', label: 'Test' },
      { key: 'count', label: 'Count' },
    ],
    parameters: [
      { key: 'dateRange', label: 'Date range', type: 'daterange', required: true },
      // Unused by the query itself (see q-test-volume's comment) — kept only so the filter bar
      // matches the catalog, which also declares (but never applies) a facility select.
      { key: 'facility', label: 'Facility', type: 'select', required: false, value: '' },
    ],
  }),
  simpleTableDesign({
    id: 'rt-turnaround-time',
    name: 'Specimen Turnaround Time',
    queryId: 'q-turnaround-time',
    columns: [
      { key: 'test', label: 'Test' },
      { key: 'count', label: 'Reports' },
      { key: 'avgHours', label: 'Avg hours' },
      { key: 'minHours', label: 'Min' },
      { key: 'maxHours', label: 'Max' },
    ],
    parameters: [
      { key: 'dateRange', label: 'Date range', type: 'daterange', required: true },
      { key: 'facility', label: 'Facility', type: 'select', required: false, value: '' },
    ],
  }),
  simpleTableDesign({
    id: 'rt-patient-demographics',
    name: 'Patient Demographics',
    queryId: 'q-patient-demographics',
    columns: [
      { key: 'band', label: 'Age band' },
      { key: 'total', label: 'Total' },
      { key: 'male', label: 'Male' },
      { key: 'female', label: 'Female' },
      { key: 'other', label: 'Other/unknown' },
    ],
    parameters: [
      { key: 'facility', label: 'Facility', type: 'select', required: false, value: '' },
      { key: 'asOf', label: 'As of (YYYY-MM-DD)', type: 'text', required: false, value: '' },
    ],
  }),
  simpleTableDesign({
    id: 'rt-amr-facility-summary',
    name: 'AMR Resistance by Facility',
    queryId: 'q-amr-facility-summary',
    columns: [
      { key: 'facility', label: 'Facility' },
      { key: 'tested', label: 'Tested' },
      { key: 'resistant', label: 'Resistant' },
    ],
    parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange', required: true }],
  }),
  simpleTableDesign({
    id: 'rt-amr-glass-ris',
    name: 'AMR GLASS RIS (stratified)',
    queryId: 'q-amr-glass-ris',
    paper: 'Letter',
    orientation: 'landscape',
    // boundColumns mirror amr-glass-ris.ts's `columns` array 1:1 (keys + labels + order). The query
    // additionally SELECTs Iso3Country/Year, but the catalog table never projected them, so they are
    // intentionally NOT bound into the displayed table.
    columns: [
      { key: 'Specimen', label: 'Specimen' },
      { key: 'PathogenCode', label: 'Pathogen' },
      { key: 'AntibioticCode', label: 'Antibiotic' },
      { key: 'Gender', label: 'Gender' },
      { key: 'AgeGroup', label: 'Age' },
      { key: 'Origin', label: 'Origin' },
      { key: 'Resistant', label: 'R' },
      { key: 'Intermediate', label: 'I' },
      { key: 'Susceptible', label: 'S' },
      { key: 'Total', label: 'Total' },
    ],
    parameters: [
      { key: 'dateRange', label: 'Date range', type: 'daterange', required: true },
      { key: 'country', label: 'Country code', type: 'text', required: false, value: '' },
      { key: 'year', label: 'Year', type: 'text', required: false, value: '' },
    ],
  }),
  simpleTableDesign({
    id: 'rt-amr-first-isolate-summary',
    name: 'AMR First-Isolate Resistance Summary',
    queryId: 'q-amr-first-isolate-summary',
    columns: [
      { key: 'specimenType', label: 'Specimen' },
      { key: 'pathogen', label: 'Pathogen' },
      { key: 'antibiotic', label: 'Antibiotic' },
      { key: 'tested', label: 'Tested' },
      { key: 'r', label: 'R' },
      { key: 'i', label: 'I' },
      { key: 's', label: 'S' },
      { key: 'percentR', label: '%R' },
    ],
    parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange', required: true }],
  }),
];

/** `reports` records linking a `SEED_DESIGNS` design to its `SEED_QUERIES` primary query. */
export const SEED_REPORT_DEFS: ReportRecord[] = [
  {
    id: 'r-amr-resistance',
    name: 'AMR Resistance Rate',
    description: 'Resistant/Intermediate/Susceptible counts and %R by antibiotic.',
    category: 'amr',
    designId: 'rt-amr-resistance',
    primaryQueryId: 'q-amr-resistance',
    summaryMetrics: [
      { id: 'antibiotics', label: 'Antibiotics', type: 'count' },
      { id: 'avgR', label: 'Avg %R', type: 'avg', column: 'percentR' },
    ],
    chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
    paramOptions: { facility: 'q-facilities' },
    status: 'published',
  },
  {
    id: 'r-test-volume',
    name: 'Test Volume Over Time',
    description: 'Count of service requests by test and month.',
    category: 'operational',
    designId: 'rt-test-volume',
    primaryQueryId: 'q-test-volume',
    summaryMetrics: [{ id: 'total', label: 'Total tests', type: 'sum', column: 'count' }],
    chart: { type: 'line', x: 'month', y: 'count', series: 'test' },
    paramOptions: { facility: 'q-facilities' },
    status: 'published',
  },
  {
    id: 'r-turnaround-time',
    name: 'Specimen Turnaround Time',
    description: 'Average hours from specimen received to report issued, by test.',
    category: 'operational',
    designId: 'rt-turnaround-time',
    primaryQueryId: 'q-turnaround-time',
    summaryMetrics: [
      { id: 'avgHours', label: 'Avg hours', type: 'avg', column: 'avgHours' },
      { id: 'reports', label: 'Reports', type: 'sum', column: 'count' },
    ],
    // Placeholder — see the "KNOWN GAP" note on q-turnaround-time: the catalog's stat value is a
    // count-weighted average recomputed per-run, but a report record's `chart` is static.
    // Currently inert (the Reports page doesn't render `chart`).
    chart: { type: 'stat', value: '0', label: 'Overall avg hours' },
    paramOptions: { facility: 'q-facilities' },
    status: 'published',
  },
  {
    id: 'r-patient-demographics',
    name: 'Patient Demographics',
    description: 'Patient counts by age band and gender.',
    category: 'quality',
    designId: 'rt-patient-demographics',
    primaryQueryId: 'q-patient-demographics',
    summaryMetrics: [{ id: 'patients', label: 'Patients', type: 'sum', column: 'total' }],
    chart: { type: 'pie', label: 'band', value: 'total' },
    paramOptions: { facility: 'q-facilities' },
    status: 'published',
  },
  {
    id: 'r-amr-facility-summary',
    name: 'AMR Resistance by Facility',
    description: 'Tested vs resistant AST-result counts per facility (wide format for DHIS2 aggregate push).',
    category: 'amr',
    designId: 'rt-amr-facility-summary',
    primaryQueryId: 'q-amr-facility-summary',
    summaryMetrics: [
      { id: 'facilities', label: 'Facilities', type: 'count' },
      { id: 'tested', label: 'Tested', type: 'sum', column: 'tested' },
    ],
    chart: { type: 'bar', x: 'facility', y: 'resistant' },
    paramOptions: null,
    status: 'published',
  },
  {
    id: 'r-amr-glass-ris',
    name: 'AMR GLASS RIS (stratified)',
    description: 'First-isolate R/I/S counts stratified by specimen, pathogen, antibiotic, gender, age group, origin (GLASS submission shape).',
    category: 'regulatory',
    designId: 'rt-amr-glass-ris',
    primaryQueryId: 'q-amr-glass-ris',
    summaryMetrics: [{ id: 'isolates', label: 'Total isolates', type: 'sum', column: 'Total' }],
    // Placeholder — same "KNOWN GAP" as r-turnaround-time: the catalog's stat value
    // (`String(rows.length)`) is recomputed fresh per-run, but a report record's `chart` is static.
    // Currently inert (the Reports page doesn't render `chart`).
    chart: { type: 'stat', value: '0', label: 'strata' },
    paramOptions: null,
    status: 'published',
  },
  {
    id: 'r-amr-first-isolate-summary',
    name: 'AMR First-Isolate Resistance Summary',
    description: 'R/I/S counts and %R by specimen type, pathogen, and antibiotic (first isolate per patient).',
    category: 'amr',
    designId: 'rt-amr-first-isolate-summary',
    primaryQueryId: 'q-amr-first-isolate-summary',
    summaryMetrics: [{ id: 'avgR', label: 'Avg %R', type: 'avg', column: 'percentR' }],
    chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
    paramOptions: null,
    status: 'published',
  },
];

export interface SeedDataDrivenReportsDeps {
  customQueries: Pick<CustomQueryStore, 'get' | 'create'>;
  designs: Pick<ReportDesignStore, 'get' | 'create'>;
  reportDefs: Pick<ReportStore, 'get' | 'create'>;
  /** Used to resolve `DEFAULT_CONNECTOR_NAME` → its server-generated id, stamped onto every
   *  `SEED_QUERIES` entry before insert. If no such connector exists yet (e.g. `TARGET_DATABASE_URL`
   *  / `SECRETS_ENCRYPTION_KEY` unset — see `seedDefaultConnector`), data-driven seeding is
   *  skipped entirely: a query bound to a nonexistent connector could never run. */
  connectors: Pick<ConnectorStore, 'list'>;
}

export interface SeedDataDrivenReportsResult {
  queriesSeeded: number;
  designsSeeded: number;
  reportDefsSeeded: number;
}

const EMPTY_RESULT: SeedDataDrivenReportsResult = { queriesSeeded: 0, designsSeeded: 0, reportDefsSeeded: 0 };

/** Idempotently inserts `SEED_QUERIES`, `SEED_DESIGNS`, and `SEED_REPORT_DEFS` (skipping any id
 *  already present), mirroring `seedReportDesigns`'s `get`-then-`create` pattern. Safe to call
 *  repeatedly — a no-op while the arrays are empty. `CustomQueryStore.get` resolves `null` (not
 *  `undefined`) for a miss; both are falsy so the same guard covers all three stores.
 *
 *  Resolves the default warehouse connector by `DEFAULT_CONNECTOR_NAME` first and stamps its id
 *  onto every seed query — `SEED_QUERIES` entries are authored with `connectorId: ''` since the
 *  connector's id is a `randomUUID()` minted at seed time (`seedDefaultConnector`), never a
 *  fixed value a seed file could hardcode. If that connector doesn't exist yet, the whole
 *  data-driven seed is skipped (queries would be bound to a nonexistent connector and could
 *  never run) — mirrors how `seedDefaultConnector` itself skips gracefully when unconfigured. */
export async function seedDataDrivenReports(deps: SeedDataDrivenReportsDeps): Promise<SeedDataDrivenReportsResult> {
  const connectors = await deps.connectors.list();
  const connector = connectors.find((c) => c.name === DEFAULT_CONNECTOR_NAME);
  if (!connector) {
    console.log(`[seed] default connector "${DEFAULT_CONNECTOR_NAME}" not found — skipping data-driven report seed`);
    return EMPTY_RESULT;
  }

  let queriesSeeded = 0;
  for (const q of SEED_QUERIES) {
    if (!(await deps.customQueries.get(q.id))) {
      await deps.customQueries.create({ ...q, connectorId: connector.id });
      queriesSeeded += 1;
    }
  }

  let designsSeeded = 0;
  for (const d of SEED_DESIGNS) {
    if (!(await deps.designs.get(d.id))) {
      await deps.designs.create(d);
      designsSeeded += 1;
    }
  }

  let reportDefsSeeded = 0;
  for (const r of SEED_REPORT_DEFS) {
    if (!(await deps.reportDefs.get(r.id))) {
      await deps.reportDefs.create(r);
      reportDefsSeeded += 1;
    }
  }

  return { queriesSeeded, designsSeeded, reportDefsSeeded };
}
