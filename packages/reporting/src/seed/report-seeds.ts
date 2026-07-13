import type { NewCustomQuery, ReportRecord, CustomQueryStore, ReportStore, ConnectorStore } from '@openldr/db';
import type { ReportDesign, ReportDesignStore } from '@openldr/report-designer';
import { simpleTableDesign } from './simple-design';

// NOTE on why this isn't `import type { SqlDialect } from '@openldr/dashboards'` (as the plan
// sketch suggested): `@openldr/dashboards` already depends on `@openldr/reporting` (for the
// shared `ReportResultData`/`ReportColumn`/`ChartHint` types used by `compile.ts`/`sql-runner.ts`),
// so importing from dashboards here would introduce a package cycle. Re-declared locally instead,
// mirroring the same already-established convention `@openldr/db`'s `custom-query-store.ts` uses
// for `CustomQueryParam`/`CustomQuery` (structurally identical to `@openldr/dashboards`'s source
// of truth, kept in sync by hand). `packages/bootstrap` (the actual caller, which depends on both
// `db` and `dashboards` with no cycle) can and does import the real `SqlDialect` from
// `@openldr/dashboards` directly.
export type SqlDialect = 'postgres' | 'mssql' | 'mysql';

// S4 seed data: the query + design + report-record triples that replace the hardcoded catalog
// reports (`packages/reporting/src/reports/*.ts`) with data-driven ones. Task 4.2 (worked example)
// appends `amr-resistance`'s triple below; Tasks 4.3-4.8 append one each for the remaining six.

/** Name used to dedup the default target-warehouse connector — matches
 *  `packages/bootstrap/src/seed.ts`'s `DEFAULT_CONNECTOR_NAME`. Every `SEED_QUERIES` entry is
 *  authored with `connectorId: ''` (it isn't known until seed time — the connector is a
 *  server-generated `randomUUID()`, deduped by this name) and `seedDataDrivenReports` stamps the
 *  resolved id on before `create`. */
export const DEFAULT_CONNECTOR_NAME = 'Target Warehouse (Postgres)';

/** Task 6.1: `amr-antibiogram`'s catalog columns are the SORTED UNION of whatever antibiotics
 *  happen to appear in the AST result set for the current run (`amr-antibiogram.ts`:
 *  `[...new Set(matrix.flatMap((m) => Object.keys(m.byAntibiotic)))].sort()`) — genuinely
 *  data-dependent, so it cannot be reproduced as a SQL `SELECT` column list (columns are static in
 *  SQL). The data-driven replacement instead uses a FIXED, curated antibiotic panel: one CASE
 *  column per antibiotic in this list, in this order.
 *
 *  Fidelity trade-off: every antibiotic actually present in the dev analytics DB is included here
 *  (`select distinct code_text from observations where interpretation_code in ('S','I','R') order
 *  by 1` → Ampicillin, Ceftriaxone, Ciprofloxacin, Gentamicin — confirmed empty result set
 *  otherwise, see amr-antibiogram-parity.test.ts), so parity holds on every column the catalog
 *  could ever have populated from today's fixture data. A handful of standard WHONET-panel
 *  antibiotics are appended as empty-until-tested columns so the report is useful as new AST data
 *  arrives without requiring another migration. Genuine gap vs the old dynamic catalog: an
 *  antibiotic tested in the future that isn't on this list won't get its own column (it's silently
 *  dropped from the matrix) until this constant is edited — the catalog would have grown a column
 *  automatically. Accepted per the plan (Task 6.1) as the "fixed panel" trade-off; SQL cannot
 *  express a data-dependent column list. */
export const ANTIBIOGRAM_PANEL: string[] = [
  'Ampicillin',
  'Amoxicillin/Clavulanate',
  'Cefotaxime',
  'Ceftriaxone',
  'Ciprofloxacin',
  'Gentamicin',
  'Meropenem',
  'Trimethoprim/Sulfamethoxazole',
];

/** Builds one CASE-column SQL fragment for `antibiotic`, matching `amr-antibiogram.ts`'s cell
 *  format EXACTLY: `${cell.percentR}% (${cell.tested})` when the pathogen was tested against this
 *  antibiotic (`aggregate.ts`'s `pct()` = `Math.round((r/tested)*1000)/10`, i.e. rounded to 1
 *  decimal place, reproduced here via `round(..., 1)`), or `''` when it was never tested (mirrors
 *  `cell ? ... : ''`). The postgres `::float8::text` cast (same technique already used for
 *  `percentR` columns elsewhere in this file) renders like JS `Number#toString` — no trailing
 *  `.0` for whole percentages — so e.g. `100` (not `100.0`) matches the catalog's cell text
 *  byte-for-byte. The mssql variant (Task 2 port) uses `cast(... as float)` +
 *  `cast(... as nvarchar(max))` per the porting rules; SQL Server's float->nvarchar text
 *  formatting is NOT guaranteed byte-identical to Postgres's `::text` cast (may render trailing
 *  zeros/scientific notation differently for edge-case values) — flagged for the cross-dialect
 *  parity harness to verify against a live MSSQL warehouse. */
function antibiogramCellSql(antibiotic: string, dialect: SqlDialect): string {
  const lit = antibiotic.replace(/'/g, "''");
  if (dialect === 'mssql') {
    const ident = antibiotic.replace(/"/g, '""');
    return `case when sum(case when antibiotic = '${lit}' then 1 else 0 end) = 0 then ''
    else cast(cast(round(100.0 * sum(case when antibiotic = '${lit}' and ris = 'R' then 1 else 0 end) / nullif(sum(case when antibiotic = '${lit}' then 1 else 0 end), 0), 1) as float) as nvarchar(max))
      + '% (' + cast(sum(case when antibiotic = '${lit}' then 1 else 0 end) as nvarchar(max)) + ')' end as "${ident}"`;
  }
  if (dialect === 'mysql') {
    // MySQL: `||` is logical OR, not concat — use concat(); `"..."` is a string literal, not an
    // identifier — use backtick aliases; float->char cast mirrors the pg ::float8::text render
    // (flagged for the parity harness, like the mssql float->nvarchar note above).
    const ident = antibiotic.replace(/`/g, '``');
    return `case when sum(case when antibiotic = '${lit}' then 1 else 0 end) = 0 then ''
    else concat(cast(cast(round(100.0 * sum(case when antibiotic = '${lit}' and ris = 'R' then 1 else 0 end) / nullif(sum(case when antibiotic = '${lit}' then 1 else 0 end), 0), 1) as double) as char),
      '% (', cast(sum(case when antibiotic = '${lit}' then 1 else 0 end) as char), ')') end as \`${ident}\``;
  }
  const ident = antibiotic.replace(/"/g, '""');
  return `case when count(*) filter (where antibiotic = '${lit}') = 0 then ''
    else (round(100.0 * count(*) filter (where antibiotic = '${lit}' and ris = 'R') / nullif(count(*) filter (where antibiotic = '${lit}'), 0), 1)::float8)::text
      || '% (' || count(*) filter (where antibiotic = '${lit}')::text || ')' end as "${ident}"`;
}

/** One query's SQL in both supported warehouse dialects — Task 2 (mssql-slice2b): every built-in
 *  report query now carries a Postgres variant (unchanged from before this task — still the one
 *  and only source of truth the `amr-*-parity.test.ts` fixtures were built against) and a T-SQL
 *  variant (first pass; ported per the documented rules table, validated by a later live
 *  cross-dialect parity harness, not guaranteed byte-perfect yet). `seedDataDrivenReports` picks
 *  the variant matching the resolved warehouse connector's dialect. */
type DialectSql = { postgres: string; mssql: string; mysql: string };
type SeedQuery = Omit<NewCustomQuery, 'sql'> & { sql: DialectSql };

/** Custom queries (bound to a connector) that back the seeded report designs. `connectorId: ''`
 *  is a placeholder — `seedDataDrivenReports` resolves the real default-connector id and stamps
 *  it on before insert (see `DEFAULT_CONNECTOR_NAME`). */
export const SEED_QUERIES: SeedQuery[] = [
  {
    id: 'q-facilities',
    name: 'Facilities (options)',
    connectorId: '',
    params: [],
    // R3c cutover: reads `v2_patients` (not the thin `patients` table) — `managing_organization`
    // is unchanged (still the full-organization-ref column) in v2, so this is a bare table-name
    // swap. No postgres-isms at all — the mssql variant is byte-identical (see Task 2's porting
    // notes).
    sql: {
      postgres: `select distinct managing_organization as facility
from v2_patients
where managing_organization is not null
order by 1`,
      mssql: `select distinct managing_organization as facility
from v2_patients
where managing_organization is not null
order by 1`,
      // No postgres-isms at all — byte-identical (see Task 5's mysql porting notes).
      mysql: `select distinct managing_organization as facility
from v2_patients
where managing_organization is not null
order by 1`,
    },
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
    sql: {
      postgres: `select
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
      // Task 2 port: count(*) filter(...) -> sum(case...), ::int -> cast(...as int),
      // ::float8 -> cast(...as float), string || -> +. `{{param.to}}`/`{{param.facility}}` are
      // always quoted string literals at substitution time (see custom-query-run.ts's
      // `sqlString`), so `+` concatenation here is always string+string — no cast needed.
      mssql: `select
  coalesce(o.code_text, '(unknown)') as antibiotic,
  cast(count(*) as int) as tested,
  cast(sum(case when o.interpretation_code = 'R' then 1 else 0 end) as int) as r,
  cast(sum(case when o.interpretation_code = 'I' then 1 else 0 end) as int) as i,
  cast(sum(case when o.interpretation_code = 'S' then 1 else 0 end) as int) as s,
  cast(round(100.0 * sum(case when o.interpretation_code = 'R' then 1 else 0 end) / nullif(count(*), 0), 1) as float) as "percentR"
from observations o
where o.interpretation_code in ('S', 'I', 'R')
  and o.effective_date_time >= {{param.from}}
  and o.effective_date_time <= ({{param.to}} + 'T23:59:59.999Z')
  and ({{param.facility}} = '' or o.subject_ref in (
    select 'Patient/' + p.id from patients p where p.managing_organization = {{param.facility}}
  ))
group by coalesce(o.code_text, '(unknown)')
order by "percentR" desc`,
      // Task 5 mysql port: ::int -> cast(...as signed); ::float8 -> cast(...as double); string
      // || -> concat(); double-quoted alias "percentR" -> backtick `percentR` (MySQL treats
      // "..." as a string literal, so it must be a backtick to be a usable result key/order key).
      mysql: `select
  coalesce(o.code_text, '(unknown)') as antibiotic,
  cast(count(*) as signed) as tested,
  cast(sum(case when o.interpretation_code = 'R' then 1 else 0 end) as signed) as r,
  cast(sum(case when o.interpretation_code = 'I' then 1 else 0 end) as signed) as i,
  cast(sum(case when o.interpretation_code = 'S' then 1 else 0 end) as signed) as s,
  cast(round(100.0 * sum(case when o.interpretation_code = 'R' then 1 else 0 end) / nullif(count(*), 0), 1) as double) as \`percentR\`
from observations o
where o.interpretation_code in ('S', 'I', 'R')
  and o.effective_date_time >= {{param.from}}
  and o.effective_date_time <= concat({{param.to}}, 'T23:59:59.999Z')
  and ({{param.facility}} = '' or o.subject_ref in (
    select concat('Patient/', p.id) from patients p where p.managing_organization = {{param.facility}}
  ))
group by coalesce(o.code_text, '(unknown)')
order by \`percentR\` desc`,
    },
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
    //  - R3c cutover: reads `v2_lab_requests` (not the thin `service_requests` table) —
    //    `authored_at`/`panel_desc` in place of thin `authored_on`/`code_text`; no other behavior
    //    change (still no patient join, no facility filter).
    params: [
      { id: 'from', label: 'From', type: 'text', required: true },
      { id: 'to', label: 'To', type: 'text', required: true },
    ],
    sql: {
      postgres: `select
  to_char(date_trunc('month', sr.authored_at::timestamptz), 'YYYY-MM') as month,
  coalesce(sr.panel_desc, '(unknown)') as test,
  count(*)::int as count
from v2_lab_requests sr
where sr.authored_at >= {{param.from}}
  and sr.authored_at <= ({{param.to}} || 'T23:59:59.999Z')
group by 1, 2
order by 1, 2`,
      // Task 2 port: to_char(date_trunc('month', ...), 'YYYY-MM') -> format(cast(...as
      // datetime2), 'yyyy-MM'); ::int -> cast(...as int); string || -> +. GROUP BY ordinals
      // (`group by 1, 2`) are NOT supported by T-SQL (unlike ORDER BY, which does support them
      // there too) — the grouped expressions are spelled out instead.
      mssql: `select
  format(cast(sr.authored_at as datetime2), 'yyyy-MM') as month,
  coalesce(sr.panel_desc, '(unknown)') as test,
  cast(count(*) as int) as count
from v2_lab_requests sr
where sr.authored_at >= {{param.from}}
  and sr.authored_at <= ({{param.to}} + 'T23:59:59.999Z')
group by format(cast(sr.authored_at as datetime2), 'yyyy-MM'), coalesce(sr.panel_desc, '(unknown)')
order by 1, 2`,
      // Task 5 mysql port: authored_on is an ISO 'YYYY-MM-DD...' string, so substr(...,1,7) IS
      // 'YYYY-MM' (avoids MySQL's fussy T/Z timestamp parsing); ::int -> cast(...as signed);
      // string || -> concat(). ONLY_FULL_GROUP_BY is ON by default in MySQL 8, so the grouped
      // expressions are spelled out (ordinal `group by 1,2` is accepted by MySQL, but spelling
      // out matches the mssql variant and is unambiguous). ORDER BY ordinals are fine.
      mysql: `select
  substr(sr.authored_at, 1, 7) as month,
  coalesce(sr.panel_desc, '(unknown)') as test,
  cast(count(*) as signed) as count
from v2_lab_requests sr
where sr.authored_at >= {{param.from}}
  and sr.authored_at <= concat({{param.to}}, 'T23:59:59.999Z')
group by substr(sr.authored_at, 1, 7), coalesce(sr.panel_desc, '(unknown)')
order by 1, 2`,
    },
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
    //  - R3c cutover: reads `v2_specimens`/`v2_diagnostic_reports`/`v2_patients` (not the thin
    //    `specimens`/`diagnostic_reports`/`patients` tables). v2 stores the bare FHIR id directly
    //    (`patient_id`) rather than a `Patient/`-prefixed reference string (`subject_ref`), so the
    //    `received` CTE keys on `patient_id`, the report<->specimen join compares `patient_id` to
    //    `patient_id`, and the facility subquery compares the bare `dr.patient_id` against bare
    //    `v2_patients.id` (no `'Patient/' ||` prefix needed). `managing_organization` itself is
    //    unchanged.
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
    sql: {
      postgres: `with received as (
  select patient_id, min(received_time) as received_time
  from v2_specimens
  where patient_id is not null and received_time is not null
  group by patient_id
),
paired as (
  select
    coalesce(dr.code_text, '(unknown)') as test,
    round(extract(epoch from (dr.issued::timestamptz - r.received_time::timestamptz)) / 3600.0)::int as hours
  from v2_diagnostic_reports dr
  join received r on r.patient_id = dr.patient_id
  where dr.issued is not null
    and dr.issued >= r.received_time
    and dr.issued >= {{param.from}}
    and dr.issued <= ({{param.to}} || 'T23:59:59.999Z')
    and ({{param.facility}} = '' or dr.patient_id in (
      select p.id from v2_patients p where p.managing_organization = {{param.facility}}
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
      // Task 2 port: extract(epoch from (a::timestamptz - b::timestamptz))/3600.0 ->
      // datediff(second, cast(b as datetime2), cast(a as datetime2))/3600.0 (datediff's arg
      // order is (start, end) = (received, issued), matching issued-minus-received). T-SQL's
      // ROUND requires an explicit `length` argument (unlike Postgres, where it defaults to 0)
      // — `, 0` added for the single-arg `round(hours)` call. AVG() of an integer expression
      // truncates to integer in T-SQL (unlike Postgres, where avg(int) already returns numeric)
      // — `hours` is cast to decimal(18,4) BEFORE avg() to avoid silently truncating the
      // average; flagged for the parity harness as the most likely subtle divergence in this
      // query. string || -> +.
      mssql: `with received as (
  select patient_id, min(received_time) as received_time
  from v2_specimens
  where patient_id is not null and received_time is not null
  group by patient_id
),
paired as (
  select
    coalesce(dr.code_text, '(unknown)') as test,
    cast(round(datediff(second, cast(r.received_time as datetime2), cast(dr.issued as datetime2)) / 3600.0, 0) as int) as hours
  from v2_diagnostic_reports dr
  join received r on r.patient_id = dr.patient_id
  where dr.issued is not null
    and dr.issued >= r.received_time
    and dr.issued >= {{param.from}}
    and dr.issued <= ({{param.to}} + 'T23:59:59.999Z')
    and ({{param.facility}} = '' or dr.patient_id in (
      select p.id from v2_patients p where p.managing_organization = {{param.facility}}
    ))
)
select
  test,
  cast(count(*) as int) as count,
  cast(round(avg(cast(hours as decimal(18,4))), 1) as float) as "avgHours",
  cast(min(hours) as int) as "minHours",
  cast(max(hours) as int) as "maxHours"
from paired
group by test
order by "avgHours" desc, test asc`,
      // Task 5 mysql port: seconds-diff via timestampdiff(second, received, issued) where each
      // ISO string is parsed by str_to_date(substr(x,1,19), '%Y-%m-%dT%H:%i:%s') — a plain cast
      // to datetime does NOT accept the embedded literal 'T', so str_to_date is required; substr
      // (…,1,19) = 'YYYY-MM-DDTHH:MM:SS'. Arg order (start,end)=(received,issued)=issued-minus-
      // received. round(x)::int -> cast(round(x,0) as signed); avg rounded like the mssql variant
      // (cast to decimal before avg to avoid integer truncation, then to double); min/max::int ->
      // cast(...as signed); string || -> concat(); backtick aliases so ORDER BY key resolves.
      // Flagged for the parity harness (same subtle avg/rounding divergence risk as mssql).
      mysql: `with received as (
  select patient_id, min(received_time) as received_time
  from v2_specimens
  where patient_id is not null and received_time is not null
  group by patient_id
),
paired as (
  select
    coalesce(dr.code_text, '(unknown)') as test,
    cast(round(timestampdiff(second, str_to_date(substr(r.received_time, 1, 19), '%Y-%m-%dT%H:%i:%s'), str_to_date(substr(dr.issued, 1, 19), '%Y-%m-%dT%H:%i:%s')) / 3600.0, 0) as signed) as hours
  from v2_diagnostic_reports dr
  join received r on r.patient_id = dr.patient_id
  where dr.issued is not null
    and dr.issued >= r.received_time
    and dr.issued >= {{param.from}}
    and dr.issued <= concat({{param.to}}, 'T23:59:59.999Z')
    and ({{param.facility}} = '' or dr.patient_id in (
      select p.id from v2_patients p where p.managing_organization = {{param.facility}}
    ))
)
select
  test,
  cast(count(*) as signed) as count,
  cast(round(avg(cast(hours as decimal(18,4))), 1) as double) as \`avgHours\`,
  cast(min(hours) as signed) as \`minHours\`,
  cast(max(hours) as signed) as \`maxHours\`
from paired
group by test
order by \`avgHours\` desc, test asc`,
    },
  },
  {
    id: 'q-patient-demographics',
    name: 'Patient demographics by age band',
    connectorId: '',
    // Mirrors packages/reporting/src/reports/patient-demographics.ts + helpers.ts's ageBand():
    // calendar-exact age (Postgres `age()` performs the same year/month/day-borrow subtraction as
    // the JS algorithm) banded into the same fixed buckets, grouped by band x gender (male/female/
    // other, where 'other' folds NULL and any non-male/female value — matches the JS else-branch).
    //  - R3b cutover: reads `v2_patients` (not the thin `patients` table) — `date_of_birth` in
    //    place of thin `birth_date`, and `sex` ('M'/'F'/'O'/'U'/null) in place of thin `gender`
    //    ('male'/'female'/other); the outer aggregates map sex='M'/'F' to male/female and
    //    everything else (including null) to 'other', preserving the same male/female/other shape.
    //  - `asOf` (optional, a single reference date — NOT a range): catalog defaults to
    //    '2026-01-01T00:00:00Z' when unset/empty. Same '' = "use default" guard as facility below.
    //  - facility filter (optional): same '' = no-filter guard as q-amr-resistance; direct equality
    //    on v2_patients.managing_organization (no subject_ref indirection — this query reads
    //    `v2_patients` directly, unlike the AMR/TAT queries).
    //  - row order: the FIXED band order ['0-4','5-14','15-24','25-49','50+','unknown'], NOT a
    //    count-based sort — matches the catalog's `ORDER.filter(b => counts.has(b)).map(...)`.
    params: [
      { id: 'facility', label: 'Facility', type: 'text', required: false },
      { id: 'asOf', label: 'As of', type: 'text', required: false },
    ],
    sql: {
      postgres: `with params as (
  select coalesce(nullif({{param.asOf}}, ''), '2026-01-01T00:00:00Z')::date as ref_date
),
banded as (
  select
    case
      when p.date_of_birth is null then 'unknown'
      when p.date_of_birth::date > pr.ref_date then 'unknown'
      when extract(year from age(pr.ref_date, p.date_of_birth::date)) <= 4 then '0-4'
      when extract(year from age(pr.ref_date, p.date_of_birth::date)) <= 14 then '5-14'
      when extract(year from age(pr.ref_date, p.date_of_birth::date)) <= 24 then '15-24'
      when extract(year from age(pr.ref_date, p.date_of_birth::date)) <= 49 then '25-49'
      else '50+'
    end as band,
    p.sex
  from v2_patients p, params pr
  where ({{param.facility}} = '' or p.managing_organization = {{param.facility}})
)
select
  band,
  count(*)::int as total,
  sum(case when sex = 'M' then 1 else 0 end)::int as male,
  sum(case when sex = 'F' then 1 else 0 end)::int as female,
  sum(case when sex is null or sex not in ('M', 'F') then 1 else 0 end)::int as other
from banded
group by band
order by array_position(array['0-4','5-14','15-24','25-49','50+','unknown']::text[], band)`,
      // Task 2 port — the trickiest of the nine (flagged for extra parity-harness attention):
      //  - X::date -> cast(X as date); SQL Server's CAST(...AS date) does parse ISO-8601
      //    'YYYY-MM-DDTHH:MM:SSZ' strings (ODBC canonical style), matching the `asOf` default.
      //  - extract(year from age(ref, birth)) -> the documented datediff(year,...) - borrow-day
      //    formula, per the porting rules table. The formula is repeated inline for every band
      //    boundary (T-SQL has no cheap equivalent of reusing a CTE-computed `age_years` here
      //    without another CTE layer) — verbose but mechanical; each occurrence is identical.
      //  - array_position(...) ORDER BY -> the fixed CASE-mapping per the rules table.
      //  - `from patients p, params pr` (implicit cross join) -> explicit `cross join` (same
      //    semantics, only a style change).
      mssql: `with params as (
  select cast(coalesce(nullif({{param.asOf}}, ''), '2026-01-01T00:00:00Z') as date) as ref_date
),
banded as (
  select
    case
      when p.date_of_birth is null then 'unknown'
      when cast(p.date_of_birth as date) > pr.ref_date then 'unknown'
      when (datediff(year, cast(p.date_of_birth as date), pr.ref_date) - case when (month(cast(p.date_of_birth as date)) > month(pr.ref_date)) or (month(cast(p.date_of_birth as date)) = month(pr.ref_date) and day(cast(p.date_of_birth as date)) > day(pr.ref_date)) then 1 else 0 end) <= 4 then '0-4'
      when (datediff(year, cast(p.date_of_birth as date), pr.ref_date) - case when (month(cast(p.date_of_birth as date)) > month(pr.ref_date)) or (month(cast(p.date_of_birth as date)) = month(pr.ref_date) and day(cast(p.date_of_birth as date)) > day(pr.ref_date)) then 1 else 0 end) <= 14 then '5-14'
      when (datediff(year, cast(p.date_of_birth as date), pr.ref_date) - case when (month(cast(p.date_of_birth as date)) > month(pr.ref_date)) or (month(cast(p.date_of_birth as date)) = month(pr.ref_date) and day(cast(p.date_of_birth as date)) > day(pr.ref_date)) then 1 else 0 end) <= 24 then '15-24'
      when (datediff(year, cast(p.date_of_birth as date), pr.ref_date) - case when (month(cast(p.date_of_birth as date)) > month(pr.ref_date)) or (month(cast(p.date_of_birth as date)) = month(pr.ref_date) and day(cast(p.date_of_birth as date)) > day(pr.ref_date)) then 1 else 0 end) <= 49 then '25-49'
      else '50+'
    end as band,
    p.sex
  from v2_patients p cross join params pr
  where ({{param.facility}} = '' or p.managing_organization = {{param.facility}})
)
select
  band,
  cast(count(*) as int) as total,
  cast(sum(case when sex = 'M' then 1 else 0 end) as int) as male,
  cast(sum(case when sex = 'F' then 1 else 0 end) as int) as female,
  cast(sum(case when sex is null or sex not in ('M', 'F') then 1 else 0 end) as int) as other
from banded
group by band
order by case band when '0-4' then 1 when '5-14' then 2 when '15-24' then 3 when '25-49' then 4 when '50+' then 5 when 'unknown' then 6 end`,
      // Task 5 mysql port — MySQL SIMPLIFIES the age ladder vs mssql: timestampdiff(YEAR, birth,
      // ref) is calendar-exact (handles month/day borrow) so NO borrow-day CASE is needed. Age
      // computed once as a single expression per band boundary. substr(x,1,10) strips any T..Z
      // before casting to date (raw ISO-with-T casts unreliably in MySQL). ref_date derives from
      // asOf the same way (cast(substr(coalesce(nullif(...),'<default>'),1,10) as date)).
      // X::date -> cast(substr(X,1,10) as date); ::int -> cast(...as signed); implicit cross join
      // -> explicit cross join; array_position ORDER BY -> the fixed CASE-mapping.
      mysql: `with params as (
  select cast(substr(coalesce(nullif({{param.asOf}}, ''), '2026-01-01T00:00:00Z'), 1, 10) as date) as ref_date
),
banded as (
  select
    case
      when p.date_of_birth is null then 'unknown'
      when cast(substr(p.date_of_birth, 1, 10) as date) > pr.ref_date then 'unknown'
      when timestampdiff(year, cast(substr(p.date_of_birth, 1, 10) as date), pr.ref_date) <= 4 then '0-4'
      when timestampdiff(year, cast(substr(p.date_of_birth, 1, 10) as date), pr.ref_date) <= 14 then '5-14'
      when timestampdiff(year, cast(substr(p.date_of_birth, 1, 10) as date), pr.ref_date) <= 24 then '15-24'
      when timestampdiff(year, cast(substr(p.date_of_birth, 1, 10) as date), pr.ref_date) <= 49 then '25-49'
      else '50+'
    end as band,
    p.sex
  from v2_patients p cross join params pr
  where ({{param.facility}} = '' or p.managing_organization = {{param.facility}})
)
select
  band,
  cast(count(*) as signed) as total,
  cast(sum(case when sex = 'M' then 1 else 0 end) as signed) as male,
  cast(sum(case when sex = 'F' then 1 else 0 end) as signed) as female,
  cast(sum(case when sex is null or sex not in ('M', 'F') then 1 else 0 end) as signed) as other
from banded
group by band
order by case band when '0-4' then 1 when '5-14' then 2 when '15-24' then 3 when '25-49' then 4 when '50+' then 5 when 'unknown' then 6 end`,
    },
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
    sql: {
      postgres: `select
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
      // Task 2 port: ::int -> cast(...as int); string || -> +ing (both `'Patient/' + p.id`
      // and the `{{param.to}}` concat — `id` is `varchar(450)` on mssql per the shared external
      // schema (packages/db/src/migrations/external/dialect.ts's keyType), so it concatenates
      // with the nvarchar literal without an extra cast).
      mssql: `select
  p.managing_organization as facility,
  cast(count(*) as int) as tested,
  cast(sum(case when o.interpretation_code = 'R' then 1 else 0 end) as int) as resistant
from observations o
join patients p on o.subject_ref = 'Patient/' + p.id
where o.interpretation_code in ('S', 'I', 'R')
  and o.subject_ref is not null and o.subject_ref <> ''
  and p.managing_organization is not null
  and o.effective_date_time >= {{param.from}}
  and o.effective_date_time <= ({{param.to}} + 'T23:59:59.999Z')
group by p.managing_organization
order by p.managing_organization`,
      // Task 5 mysql port: ::int -> cast(...as signed); join 'Patient/' || p.id -> concat(...);
      // end-of-day string || -> concat(). Otherwise identical structure.
      mysql: `select
  p.managing_organization as facility,
  cast(count(*) as signed) as tested,
  cast(sum(case when o.interpretation_code = 'R' then 1 else 0 end) as signed) as resistant
from observations o
join patients p on o.subject_ref = concat('Patient/', p.id)
where o.interpretation_code in ('S', 'I', 'R')
  and o.subject_ref is not null and o.subject_ref <> ''
  and p.managing_organization is not null
  and o.effective_date_time >= {{param.from}}
  and o.effective_date_time <= concat({{param.to}}, 'T23:59:59.999Z')
group by p.managing_organization
order by p.managing_organization`,
    },
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
    sql: {
      postgres: `with org_obs as (
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
      // Task 2 port — FLAGGED for extra parity-harness attention (the most structurally complex
      // query in the seed set):
      //  - `distinct on (...) order by k1,k2,k3,(iso_date is null),iso_date asc,obs_id asc` has
      //    no T-SQL equivalent; ported to `row_number() over (partition by k1,k2,k3 order by
      //    case when iso_date is null then 1 else 0 end asc, iso_date asc, obs_id asc) = 1`,
      //    which is the standard dedup-first-row idiom and preserves the same tiebreak order
      //    (non-null dates sort first, exactly like Postgres's boolean-ascending `(iso_date is
      //    null)`; `iso_date`/`obs_id` are plain nvarchar/varchar columns on both engines, so the
      //    ORDER BY is a lexicographic string sort on both sides — consistent, not a divergence).
      //  - `age(ref, birth)` extract-year -> the documented datediff(year,...) - borrow-day
      //    formula (ref = coalesce(iso_date, '1970-01-01')::date here, not a fixed reference —
      //    same rule, different operands than q-patient-demographics). When birth_date is NULL,
      //    `datediff(year, cast(NULL as date), ...)` returns NULL and the borrow CASE's
      //    `month(NULL)`/`day(NULL)` comparisons are also NULL (falls to the CASE's ELSE 0),
      //    so age_years ends up NULL — consistent with Postgres's `age(x, null) -> null` and
      //    harmless since the outer CASE checks `birth_date is null` first regardless.
      //  - string || -> +; ::int -> cast(...as int).
      mssql: `with org_obs as (
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
  left join specimens s on oo.specimen_ref = 'Specimen/' + s.id
  left join patients p on oo.subject_ref = 'Patient/' + p.id
  where coalesce(oo.effective_date_time, s.received_time) is null
     or (coalesce(oo.effective_date_time, s.received_time) >= {{param.from}}
         and coalesce(oo.effective_date_time, s.received_time) <= ({{param.to}} + 'T23:59:59.999Z'))
),
age_banded as (
  select im.*,
    cast(
      datediff(year, cast(im.birth_date as date), cast(coalesce(im.iso_date, '1970-01-01') as date))
      - case when (month(cast(im.birth_date as date)) > month(cast(coalesce(im.iso_date, '1970-01-01') as date)))
              or (month(cast(im.birth_date as date)) = month(cast(coalesce(im.iso_date, '1970-01-01') as date))
                  and day(cast(im.birth_date as date)) > day(cast(coalesce(im.iso_date, '1970-01-01') as date)))
             then 1 else 0 end
    as int) as age_years
  from isolate_meta im
),
ranked as (
  select ab.*,
    row_number() over (
      partition by subject_ref, pathogen_code, specimen_type
      order by case when iso_date is null then 1 else 0 end asc, iso_date asc, obs_id asc
    ) as rn
  from age_banded ab
),
first_isolates as (
  select
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
  from ranked
  where rn = 1
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
  cast(coalesce(nullif({{param.year}}, ''), '0') as int) as "Year",
  specimen_type as "Specimen",
  pathogen_code as "PathogenCode",
  antibiotic as "AntibioticCode",
  gender as "Gender",
  age_band as "AgeGroup",
  origin as "Origin",
  cast(sum(case when ris = 'R' then 1 else 0 end) as int) as "Resistant",
  cast(sum(case when ris = 'I' then 1 else 0 end) as int) as "Intermediate",
  cast(sum(case when ris = 'S' then 1 else 0 end) as int) as "Susceptible",
  cast(count(*) as int) as "Total"
from results
group by specimen_type, pathogen_code, antibiotic, gender, age_band, origin
order by "Specimen", "PathogenCode", "AntibioticCode", "Gender", "AgeGroup", "Origin"`,
      // Task 5 mysql port — same CTE-chain shape as the mssql variant (distinct on ->
      // row_number()/rn=1 dedup) but with MySQL's simpler calendar-exact age:
      //  - age = timestampdiff(year, birth, iso_date-or-'1970-01-01'); calendar-exact, NO
      //    borrow-day CASE. substr(x,1,10) strips T..Z before casting to date; NULL birth_date ->
      //    NULL age_years (outer CASE checks `birth_date is null` first, so harmless).
      //  - 'Specimen/' || s.id / 'Patient/' || p.id / end-of-day || -> concat().
      //  - ::int -> cast(...as signed); coalesce(nullif({{param.year}},''),'0')::int ->
      //    cast(coalesce(nullif(...),'0') as signed).
      //  - all double-quoted result aliases -> BACKTICK aliases (MySQL "..." is a string literal);
      //    ORDER BY references those backtick aliases so it sorts by column, not by a literal.
      mysql: `with org_obs as (
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
  left join specimens s on oo.specimen_ref = concat('Specimen/', s.id)
  left join patients p on oo.subject_ref = concat('Patient/', p.id)
  where coalesce(oo.effective_date_time, s.received_time) is null
     or (coalesce(oo.effective_date_time, s.received_time) >= {{param.from}}
         and coalesce(oo.effective_date_time, s.received_time) <= concat({{param.to}}, 'T23:59:59.999Z'))
),
age_banded as (
  select im.*,
    timestampdiff(year, cast(substr(im.birth_date, 1, 10) as date), cast(substr(coalesce(im.iso_date, '1970-01-01'), 1, 10) as date)) as age_years
  from isolate_meta im
),
ranked as (
  select ab.*,
    row_number() over (
      partition by subject_ref, pathogen_code, specimen_type
      order by case when iso_date is null then 1 else 0 end asc, iso_date asc, obs_id asc
    ) as rn
  from age_banded ab
),
first_isolates as (
  select
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
  from ranked
  where rn = 1
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
  coalesce(nullif({{param.country}}, ''), 'XXX') as \`Iso3Country\`,
  cast(coalesce(nullif({{param.year}}, ''), '0') as signed) as \`Year\`,
  specimen_type as \`Specimen\`,
  pathogen_code as \`PathogenCode\`,
  antibiotic as \`AntibioticCode\`,
  gender as \`Gender\`,
  age_band as \`AgeGroup\`,
  origin as \`Origin\`,
  cast(sum(case when ris = 'R' then 1 else 0 end) as signed) as \`Resistant\`,
  cast(sum(case when ris = 'I' then 1 else 0 end) as signed) as \`Intermediate\`,
  cast(sum(case when ris = 'S' then 1 else 0 end) as signed) as \`Susceptible\`,
  cast(count(*) as signed) as \`Total\`
from results
group by specimen_type, pathogen_code, antibiotic, gender, age_band, origin
order by \`Specimen\`, \`PathogenCode\`, \`AntibioticCode\`, \`Gender\`, \`AgeGroup\`, \`Origin\``,
    },
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
    sql: {
      postgres: `with org_obs as (
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
      // Task 2 port: identical CTE chain/rationale as q-amr-glass-ris's mssql variant (distinct
      // on -> row_number()/rn=1, age() -> datediff(year,...) borrow-day formula, ::int ->
      // cast(...as int), string || -> +) — see its comment for the full explanation. Flagged for
      // the same extra parity-harness attention.
      mssql: `with org_obs as (
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
  left join specimens s on oo.specimen_ref = 'Specimen/' + s.id
  left join patients p on oo.subject_ref = 'Patient/' + p.id
  where coalesce(oo.effective_date_time, s.received_time) is null
     or (coalesce(oo.effective_date_time, s.received_time) >= {{param.from}}
         and coalesce(oo.effective_date_time, s.received_time) <= ({{param.to}} + 'T23:59:59.999Z'))
),
age_banded as (
  select im.*,
    cast(
      datediff(year, cast(im.birth_date as date), cast(coalesce(im.iso_date, '1970-01-01') as date))
      - case when (month(cast(im.birth_date as date)) > month(cast(coalesce(im.iso_date, '1970-01-01') as date)))
              or (month(cast(im.birth_date as date)) = month(cast(coalesce(im.iso_date, '1970-01-01') as date))
                  and day(cast(im.birth_date as date)) > day(cast(coalesce(im.iso_date, '1970-01-01') as date)))
             then 1 else 0 end
    as int) as age_years
  from isolate_meta im
),
ranked as (
  select ab.*,
    row_number() over (
      partition by subject_ref, pathogen_code, specimen_type
      order by case when iso_date is null then 1 else 0 end asc, iso_date asc, obs_id asc
    ) as rn
  from age_banded ab
),
first_isolates as (
  select
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
  from ranked
  where rn = 1
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
  cast(count(*) as int) as tested,
  cast(sum(case when ris = 'R' then 1 else 0 end) as int) as r,
  cast(sum(case when ris = 'I' then 1 else 0 end) as int) as i,
  cast(sum(case when ris = 'S' then 1 else 0 end) as int) as s,
  cast(round(100.0 * sum(case when ris = 'R' then 1 else 0 end) / nullif(count(*), 0), 1) as float) as "percentR"
from results
group by specimen_type, pathogen_code, antibiotic
order by specimen_type, pathogen_code, antibiotic`,
      // Task 5 mysql port: same CTE-chain port as q-amr-glass-ris's mysql variant (row_number
      // dedup + timestampdiff calendar-exact age + concat + substr date-strip) — see its comment.
      // Final grouping is specimenType x pathogen x antibiotic only. Backtick the quoted result
      // aliases (`specimenType`, `pathogen`, `percentR`); round(...,1)::float8 -> cast(round(...,1)
      // as double); ::int -> cast(...as signed). ORDER BY uses the raw grouped columns (bare, fine).
      mysql: `with org_obs as (
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
  left join specimens s on oo.specimen_ref = concat('Specimen/', s.id)
  left join patients p on oo.subject_ref = concat('Patient/', p.id)
  where coalesce(oo.effective_date_time, s.received_time) is null
     or (coalesce(oo.effective_date_time, s.received_time) >= {{param.from}}
         and coalesce(oo.effective_date_time, s.received_time) <= concat({{param.to}}, 'T23:59:59.999Z'))
),
age_banded as (
  select im.*,
    timestampdiff(year, cast(substr(im.birth_date, 1, 10) as date), cast(substr(coalesce(im.iso_date, '1970-01-01'), 1, 10) as date)) as age_years
  from isolate_meta im
),
ranked as (
  select ab.*,
    row_number() over (
      partition by subject_ref, pathogen_code, specimen_type
      order by case when iso_date is null then 1 else 0 end asc, iso_date asc, obs_id asc
    ) as rn
  from age_banded ab
),
first_isolates as (
  select
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
  from ranked
  where rn = 1
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
  specimen_type as \`specimenType\`,
  pathogen_code as \`pathogen\`,
  antibiotic,
  cast(count(*) as signed) as tested,
  cast(sum(case when ris = 'R' then 1 else 0 end) as signed) as r,
  cast(sum(case when ris = 'I' then 1 else 0 end) as signed) as i,
  cast(sum(case when ris = 'S' then 1 else 0 end) as signed) as s,
  cast(round(100.0 * sum(case when ris = 'R' then 1 else 0 end) / nullif(count(*), 0), 1) as double) as \`percentR\`
from results
group by specimen_type, pathogen_code, antibiotic
order by specimen_type, pathogen_code, antibiotic`,
    },
  },
  {
    id: 'q-amr-antibiogram',
    name: 'AMR cumulative antibiogram (fixed panel)',
    connectorId: '',
    // Mirrors packages/reporting/src/reports/amr-antibiogram.ts + the shared AMR helpers
    // (fetchAmrData/buildIsolates/firstIsolate/antibiogram) exactly, EXCEPT the antibiotic columns:
    // see ANTIBIOGRAM_PANEL's comment for why a fixed panel replaces the catalog's dynamic union.
    //  - first-isolate CTE (org_obs/isolate_meta/first_isolates): IDENTICAL dedup key
    //    (subject_ref, pathogen_code, specimen_type), tiebreak (earliest iso_date, dateless
    //    retained, obs_id asc as an explicit deterministic tiebreaker), and window-scoping (only
    //    the isolate-identifying observation's date is filtered; the antibiotic-result join is
    //    never date-filtered) as q-amr-glass-ris/q-amr-first-isolate-summary — see their comments
    //    for the full rationale. specimen_type is carried only to participate in the dedup key
    //    (matches firstIsolate's key); the final aggregation collapses across specimen types,
    //    matching `antibiogram()`'s grouping by pathogen alone (not `aggregateRIS`'s
    //    specimen-type-stratified grouping).
    //  - unlike q-amr-glass-ris, no gender/age/origin/country/year columns are needed (antibiogram
    //    doesn't stratify by them), so isolate_meta only carries what antibiogram() actually uses.
    //  - date range: from/to REQUIRED here even though the catalog's own zod schema declares both
    //    optional (`z.object({from: z.string().optional(), to: z.string().optional()})`, and an
    //    empty {} window disables date filtering entirely in `fetchAmrData`'s `inWindow`) — same
    //    reasoning as every other AMR seed query: substituteParams throws "unbound parameter" for
    //    any {{param.x}} token missing from values regardless of the param's own required flag, so
    //    it's simpler to require the range than special-case an unfiltered run. The seeded design
    //    marks `dateRange` required, matching rt-amr-glass-ris/rt-amr-first-isolate-summary.
    //  - cell format: see antibiogramCellSql's comment — one CASE column per ANTIBIOGRAM_PANEL
    //    antibiotic, `${percentR}% (${tested})` or `''`, byte-identical to the catalog's cells for
    //    every antibiotic the panel and the catalog's dynamic union both contain.
    //  - row order: pathogen_code ASC — matches antibiogram()'s explicit
    //    `.sort(([a],[b]) => a.localeCompare(b))`.
    params: [
      { id: 'from', label: 'From', type: 'text', required: true },
      { id: 'to', label: 'To', type: 'text', required: true },
    ],
    sql: {
      postgres: `with org_obs as (
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
)
select
  pathogen_code as pathogen,
  ${ANTIBIOGRAM_PANEL.map((a) => antibiogramCellSql(a, 'postgres')).join(',\n  ')}
from results
group by pathogen_code
order by pathogen_code`,
      // Task 2 port: distinct on -> row_number()/rn=1 (no age/gender columns needed here, so
      // the CTE chain is simpler than glass-ris/first-isolate-summary — same dedup rationale,
      // see q-amr-glass-ris's comment); string || -> +; antibiogramCellSql('mssql') ports each
      // CASE column per the rules table (see its own doc comment for the float->text caveat).
      mssql: `with org_obs as (
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
  left join specimens s on oo.specimen_ref = 'Specimen/' + s.id
  where coalesce(oo.effective_date_time, s.received_time) is null
     or (coalesce(oo.effective_date_time, s.received_time) >= {{param.from}}
         and coalesce(oo.effective_date_time, s.received_time) <= ({{param.to}} + 'T23:59:59.999Z'))
),
ranked as (
  select im.*,
    row_number() over (
      partition by subject_ref, pathogen_code, specimen_type
      order by case when iso_date is null then 1 else 0 end asc, iso_date asc, obs_id asc
    ) as rn
  from isolate_meta im
),
first_isolates as (
  select obs_id, specimen_ref, pathogen_code
  from ranked
  where rn = 1
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
)
select
  pathogen_code as pathogen,
  ${ANTIBIOGRAM_PANEL.map((a) => antibiogramCellSql(a, 'mssql')).join(',\n  ')}
from results
group by pathogen_code
order by pathogen_code`,
      // Task 5 mysql port: simpler CTE chain (no age/gender) — distinct on -> row_number()/rn=1;
      // 'Specimen/' || s.id / end-of-day || -> concat(); the SELECT emits one backtick-aliased CASE
      // column per panel antibiotic via antibiogramCellSql(a, 'mysql'). pathogen_code as pathogen
      // (bare alias, fine); group by / order by pathogen_code unchanged.
      mysql: `with org_obs as (
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
  left join specimens s on oo.specimen_ref = concat('Specimen/', s.id)
  where coalesce(oo.effective_date_time, s.received_time) is null
     or (coalesce(oo.effective_date_time, s.received_time) >= {{param.from}}
         and coalesce(oo.effective_date_time, s.received_time) <= concat({{param.to}}, 'T23:59:59.999Z'))
),
ranked as (
  select im.*,
    row_number() over (
      partition by subject_ref, pathogen_code, specimen_type
      order by case when iso_date is null then 1 else 0 end asc, iso_date asc, obs_id asc
    ) as rn
  from isolate_meta im
),
first_isolates as (
  select obs_id, specimen_ref, pathogen_code
  from ranked
  where rn = 1
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
)
select
  pathogen_code as pathogen,
  ${ANTIBIOGRAM_PANEL.map((a) => antibiogramCellSql(a, 'mysql')).join(',\n  ')}
from results
group by pathogen_code
order by pathogen_code`,
    },
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
  simpleTableDesign({
    id: 'rt-amr-antibiogram',
    name: 'AMR Cumulative Antibiogram',
    queryId: 'q-amr-antibiogram',
    paper: 'Letter',
    orientation: 'landscape',
    columns: [
      { key: 'pathogen', label: 'Pathogen' },
      ...ANTIBIOGRAM_PANEL.map((a) => ({ key: a, label: a })),
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
  {
    id: 'r-amr-antibiogram',
    name: 'AMR Cumulative Antibiogram',
    description: 'First-isolate %R matrix of pathogen x antibiotic (fixed WHONET panel; cell = %R with N tested).',
    category: 'amr',
    designId: 'rt-amr-antibiogram',
    primaryQueryId: 'q-amr-antibiogram',
    // Matches the catalog's summaryMetrics exactly (see amr-antibiogram.ts).
    summaryMetrics: [{ id: 'pathogens', label: 'Pathogens', type: 'count' }],
    // Placeholder — same "KNOWN GAP" as r-turnaround-time/r-amr-glass-ris: the catalog's stat chart
    // (`{type:'stat', value:String(matrix.length), label:'pathogens'}`) is recomputed fresh
    // per-run, but a report record's `chart` is static (summaryMetrics IS recomputed generically
    // and is what the Reports page actually renders — this field is currently inert).
    chart: { type: 'stat', value: '0', label: 'pathogens' },
    // No facility filter — the catalog declares only `dateRange` (see amr-antibiogram.ts).
    paramOptions: null,
    status: 'published',
  },
];

/** Task 2 (mssql-slice2b) reversal of Slice 1's "reports skip on MSSQL": the seed now resolves
 *  EITHER default warehouse connector by name (Postgres or SQL Server — `seedDefaultConnector`
 *  creates exactly one of the two, mutually exclusive on `TARGET_STORE_ADAPTER`) and derives the
 *  SQL dialect from its `type`, so `seedDataDrivenReports` seeds working queries on both engines
 *  instead of only ever finding `DEFAULT_CONNECTOR_NAME` (Postgres) and silently no-op'ing on an
 *  MSSQL install.
 *
 *  Task 6 (mysql-target-s2) extends this the same way for MySQL/MariaDB: now that every
 *  `SEED_QUERIES` entry carries a `sql.mysql` variant (Task 5), the mysql warehouse connector name
 *  (`packages/bootstrap/src/seed.ts`'s `MYSQL_CONNECTOR_NAME`, kept byte-identical here) is
 *  registered too, so a mysql install seeds working queries on all three engines instead of
 *  silently no-op'ing (S1's deliberate "reports skip on mysql" until the mysql SQL variant
 *  existed). */
const WAREHOUSE_NAMES = ['Target Warehouse (Postgres)', 'Target Warehouse (SQL Server)', 'Target Warehouse (MySQL/MariaDB)'];

export interface SeedDataDrivenReportsDeps {
  customQueries: Pick<CustomQueryStore, 'get' | 'create'>;
  designs: Pick<ReportDesignStore, 'get' | 'create'>;
  reportDefs: Pick<ReportStore, 'get' | 'create'>;
  /** Used to resolve the default warehouse connector (by `WAREHOUSE_NAMES`) → its server-generated
   *  id (stamped onto every `SEED_QUERIES` entry before insert) and its `type` (used to pick the
   *  matching `sql.postgres`/`sql.mssql` variant). If no such connector exists yet (e.g.
   *  `TARGET_DATABASE_URL`/`MSSQL_*`/`SECRETS_ENCRYPTION_KEY` unset — see `seedDefaultConnector`),
   *  data-driven seeding is skipped entirely: a query bound to a nonexistent connector could never
   *  run. */
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
  const connector = connectors.find((c) => WAREHOUSE_NAMES.includes(c.name));
  if (!connector) {
    console.log(`[seed] no default warehouse connector found (looked for ${WAREHOUSE_NAMES.join(' / ')}) — skipping data-driven report seed`);
    return EMPTY_RESULT;
  }
  const dialect: SqlDialect =
    connector.type === 'microsoft-sql' ? 'mssql'
    : connector.type === 'mysql' ? 'mysql'
    : 'postgres';

  let queriesSeeded = 0;
  for (const q of SEED_QUERIES) {
    if (!(await deps.customQueries.get(q.id))) {
      await deps.customQueries.create({ ...q, sql: q.sql[dialect], connectorId: connector.id });
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
