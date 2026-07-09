import type { NewCustomQuery, ReportRecord, CustomQueryStore, ReportStore, ConnectorStore } from '@openldr/db';
import type { ReportDesign, ReportDesignStore } from '@openldr/report-designer';

// S4 seed data: the query + design + report-record triples that replace the hardcoded catalog
// reports (`packages/reporting/src/reports/*.ts`) with data-driven ones. Empty for now — Tasks
// 4.2-4.8 append one triple per migrated report (amr-resistance, amr-facility-summary,
// amr-glass-ris, amr-first-isolate-summary, test-volume, turnaround-time, patient-demographics).

/** Name used to dedup the default target-warehouse connector — matches
 *  `packages/bootstrap/src/seed.ts`'s `DEFAULT_CONNECTOR_NAME`. Every `SEED_QUERIES` entry is
 *  authored with `connectorId: ''` (it isn't known until seed time — the connector is a
 *  server-generated `randomUUID()`, deduped by this name) and `seedDataDrivenReports` stamps the
 *  resolved id on before `create`. */
export const DEFAULT_CONNECTOR_NAME = 'Target Warehouse (Postgres)';

/** Custom queries (bound to a connector) that back the seeded report designs. `connectorId: ''`
 *  is a placeholder — `seedDataDrivenReports` resolves the real default-connector id and stamps
 *  it on before insert (see `DEFAULT_CONNECTOR_NAME`). */
export const SEED_QUERIES: NewCustomQuery[] = [];

/** Report-designer page designs, one table bound to a `SEED_QUERIES` entry (via `simpleTableDesign`). */
export const SEED_DESIGNS: ReportDesign[] = [];

/** `reports` records linking a `SEED_DESIGNS` design to its `SEED_QUERIES` primary query. */
export const SEED_REPORT_DEFS: ReportRecord[] = [];

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
