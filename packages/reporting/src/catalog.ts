import type { ReportDefinition, ReportSummary } from './types';
import { amrAntibiogram } from './reports/amr-antibiogram';

// The other 7 hardcoded reports (amr-resistance, amr-facility-summary, test-volume,
// patient-demographics, turnaround-time, amr-first-isolate-summary, amr-glass-ris) were retired in
// Slice S5 of docs/superpowers/plans/2026-07-09-reports-template-linking.md — they are now
// data-driven `r-<id>` report records (query + report-designer template), resolved via
// `ctx.reportDefs`/`ctx.reporting` in packages/bootstrap/src/index.ts. `amr-antibiogram` stays here
// until Slice S6 migrates it too (fixed antibiotic panel).
const REPORTS: ReportDefinition[] = [amrAntibiogram] as ReportDefinition[];

export function reportCatalog(): ReportDefinition[] {
  return REPORTS;
}

export function getReport(id: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.id === id);
}

export function reportSummaries(): ReportSummary[] {
  return REPORTS.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    category: r.category,
    parameters: r.parameters,
    summaryMetrics: r.summaryMetrics,
    source: 'catalog',
  }));
}
