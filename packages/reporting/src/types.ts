import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ZodType } from 'zod';

export type ChartHint =
  | { type: 'bar'; x: string; y: string; series?: string }
  | { type: 'line'; x: string; y: string; series?: string }
  | { type: 'pie'; label: string; value: string }
  | { type: 'stat'; value: string; label: string };

export interface ReportColumn {
  key: string;
  label: string;
  kind: 'string' | 'number' | 'percent' | 'date';
}

export interface ReportResultData {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  chart: ChartHint;
}

export interface ReportResult extends ReportResultData {
  meta: { generatedAt: string; rowCount: number };
}

export interface ReportSummary {
  id: string;
  name: string;
  description: string;
}

export interface ReportDefinition<P = unknown> {
  id: string;
  name: string;
  description: string;
  params: ZodType<P>;
  run(db: Kysely<ExternalSchema>, params: P): Promise<ReportResultData>;
}
