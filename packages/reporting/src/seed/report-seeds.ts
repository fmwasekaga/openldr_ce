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
