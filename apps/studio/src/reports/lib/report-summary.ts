import type { ReportMetricMeta } from '../../api';

export interface ComputedMetric {
  id: string;
  label: string;
  value: string;
}

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

function numbersOf(rows: Record<string, unknown>[], column: string): number[] {
  return rows.map((r) => Number(r[column])).filter((n) => Number.isFinite(n));
}

function computeOne(m: ReportMetricMeta, rows: Record<string, unknown>[]): string {
  if (m.type === 'count') return String(rows.length);
  if (m.type === 'pct') {
    if (rows.length === 0 || !m.column) return '0%';
    const hits = rows.filter((r) => String(r[m.column!]) === String(m.match ?? '')).length;
    return `${fmt((hits / rows.length) * 100)}%`;
  }
  if (!m.column) return '0';
  const nums = numbersOf(rows, m.column);
  if (nums.length === 0) return '0';
  if (m.type === 'sum') return fmt(nums.reduce((a, b) => a + b, 0));
  return fmt(nums.reduce((a, b) => a + b, 0) / nums.length); // avg
}

export function computeSummaryMetrics(
  metrics: ReportMetricMeta[],
  rows: Record<string, unknown>[],
): ComputedMetric[] {
  return metrics.map((m) => ({ id: m.id, label: m.label, value: computeOne(m, rows) }));
}
