import type { HealthResult } from './health';

export interface TargetMetadata {
  dataElements: { id: string; name: string }[];
  orgUnits: { id: string; name: string }[];
  categoryOptionCombos: { id: string; name: string }[];
  programs?: { id: string; name: string }[];
  programStages?: { id: string; name: string; program: string }[];
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

/** Inputs the host hands a sink target per push. The sink (wasm plugin) owns the
 *  mapping, so `mapping` is opaque here (keeps the port connector-generic). */
export interface TargetPushArgs {
  rows: Record<string, unknown>[];
  mapping: unknown;
  orgUnitMap: Record<string, string>;
  period: string;
  dryRun: boolean;
}

/** Sink output: the mapped payload preview (always) + the import result (live only). */
export interface TargetPushResult {
  payload: unknown;
  skipped: { row: number; reason: string }[];
  result?: PushResult;
}

// Generic external-reporting-target seam (DHIS2 now; GLASS/FHIR targets reuse it).
export interface ReportingTargetPort {
  healthCheck(): Promise<HealthResult>;
  pullMetadata(): Promise<TargetMetadata>;
  pushAggregate(args: TargetPushArgs): Promise<TargetPushResult>;
  pushEvents(args: TargetPushArgs): Promise<TargetPushResult>;
}
