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
