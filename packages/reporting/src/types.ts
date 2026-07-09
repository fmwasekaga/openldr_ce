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
  decimals?: number;
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
  source?: 'catalog' | 'builder' | 'design';
  /** For source==='design': the linked report-designer template id, for a studio deep-link. */
  designId?: string;
}
