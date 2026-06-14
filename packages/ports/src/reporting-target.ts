import type { HealthResult } from './health';

export interface TargetMetadata {
  dataElements: { id: string; name: string }[];
  orgUnits: { id: string; name: string }[];
  categoryOptionCombos: { id: string; name: string }[];
}

export interface PushResult {
  status: 'success' | 'warning' | 'error';
  imported: number;
  updated: number;
  ignored: number;
  deleted: number;
  conflicts: { object: string; value: string }[];
  raw: unknown;
}

// Generic external-reporting-target seam (DHIS2 now; GLASS/FHIR targets reuse it).
export interface ReportingTargetPort {
  healthCheck(): Promise<HealthResult>;
  pullMetadata(): Promise<TargetMetadata>;
  pushAggregate(payload: unknown): Promise<PushResult>;
}
