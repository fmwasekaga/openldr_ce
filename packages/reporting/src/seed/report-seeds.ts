import type { NewCustomQuery, ReportRecord, CustomQueryStore, ReportStore } from '@openldr/db';
import type { ReportDesign, ReportDesignStore } from '@openldr/report-designer';

// S4 seed data: the query + design + report-record triples that replace the hardcoded catalog
// reports (`packages/reporting/src/reports/*.ts`) with data-driven ones. Empty for now — Tasks
// 4.2-4.8 append one triple per migrated report (amr-resistance, amr-facility-summary,
// amr-glass-ris, amr-first-isolate-summary, test-volume, turnaround-time, patient-demographics).

/** Custom queries (bound to a connector) that back the seeded report designs. */
export const SEED_QUERIES: NewCustomQuery[] = [];

/** Report-designer page designs, one table bound to a `SEED_QUERIES` entry (via `simpleTableDesign`). */
export const SEED_DESIGNS: ReportDesign[] = [];

/** `reports` records linking a `SEED_DESIGNS` design to its `SEED_QUERIES` primary query. */
export const SEED_REPORT_DEFS: ReportRecord[] = [];

export interface SeedDataDrivenReportsDeps {
  customQueries: Pick<CustomQueryStore, 'get' | 'create'>;
  designs: Pick<ReportDesignStore, 'get' | 'create'>;
  reportDefs: Pick<ReportStore, 'get' | 'create'>;
}

export interface SeedDataDrivenReportsResult {
  queriesSeeded: number;
  designsSeeded: number;
  reportDefsSeeded: number;
}

/** Idempotently inserts `SEED_QUERIES`, `SEED_DESIGNS`, and `SEED_REPORT_DEFS` (skipping any id
 *  already present), mirroring `seedReportDesigns`'s `get`-then-`create` pattern. Safe to call
 *  repeatedly — a no-op while the arrays are empty. `CustomQueryStore.get` resolves `null` (not
 *  `undefined`) for a miss; both are falsy so the same guard covers all three stores. */
export async function seedDataDrivenReports(deps: SeedDataDrivenReportsDeps): Promise<SeedDataDrivenReportsResult> {
  let queriesSeeded = 0;
  for (const q of SEED_QUERIES) {
    if (!(await deps.customQueries.get(q.id))) {
      await deps.customQueries.create(q);
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
