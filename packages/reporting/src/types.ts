import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ZodType } from 'zod';

export type ChartHint =
  | { type: 'bar'; x: string; y: string; series?: string }
  | { type: 'line'; x: string; y: string; series?: string }
  | { type: 'pie'; label: string; value: string }
  | { type: 'stat'; value: string; label: string };

export type ReportCategory = 'amr' | 'operational' | 'quality' | 'regulatory';

export interface ReportParamMeta {
  id: string;
  label: string;
  type: 'daterange' | 'select' | 'text';
  required: boolean;
  /** Key into the report's options() result, for type 'select'. */
  optionsKey?: string;
}

export interface ReportMetricMeta {
  id: string;
  label: string;
  type: 'count' | 'sum' | 'avg' | 'pct';
  /** Column the metric is computed over (sum/avg/pct). */
  column?: string;
  /** For pct: the value to match against `column`. */
  match?: string;
}

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
  category: ReportCategory;
  parameters: ReportParamMeta[];
  summaryMetrics?: ReportMetricMeta[];
  source?: 'catalog' | 'builder';
}

export interface ReportDefinition<P = unknown> {
  id: string;
  name: string;
  description: string;
  params: ZodType<P>;
  run(db: Kysely<ExternalSchema>, params: P): Promise<ReportResultData>;
  category: ReportCategory;
  parameters: ReportParamMeta[];
  summaryMetrics?: ReportMetricMeta[];
  /** Resolves dynamic select options keyed by ReportParamMeta.optionsKey. */
  options?(db: Kysely<ExternalSchema>): Promise<Record<string, string[]>>;
}
