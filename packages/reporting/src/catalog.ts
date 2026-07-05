import type { ReportDefinition, ReportSummary } from './types';
import { amrResistance } from './reports/amr-resistance';
import { amrFacilitySummary } from './reports/amr-facility-summary';
import { testVolume } from './reports/test-volume';
import { patientDemographics } from './reports/patient-demographics';
import { turnaroundTime } from './reports/turnaround-time';
import { amrAntibiogram } from './reports/amr-antibiogram';
import { amrFirstIsolateSummary } from './reports/amr-first-isolate-summary';
import { amrGlassRis } from './reports/amr-glass-ris';

const REPORTS: ReportDefinition[] = [amrResistance, amrFacilitySummary, testVolume, patientDemographics, turnaroundTime, amrAntibiogram, amrFirstIsolateSummary, amrGlassRis] as ReportDefinition[];

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
