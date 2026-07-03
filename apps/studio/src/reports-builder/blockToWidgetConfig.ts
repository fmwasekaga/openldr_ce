import type { WidgetConfig, ReportResult } from '../api';
import type { Block } from '@openldr/report-builder/pure';

const CHART_TYPE: Record<string, WidgetConfig['type']> = { bar: 'bar-chart', line: 'line-chart', pie: 'pie-chart' };

function axisKeys(result?: ReportResult): { x: string; y: string } {
  const cols = result?.columns ?? [];
  const x = cols.find((c) => c.kind !== 'number')?.key ?? cols[0]?.key ?? 'label';
  const y = cols.find((c) => c.kind === 'number')?.key ?? cols[1]?.key ?? 'value';
  return { x, y };
}

/** Map a report data block (+ its fetched result) to a dashboard WidgetConfig for renderWidget. */
export function blockToWidgetConfig(block: Block, result?: ReportResult): WidgetConfig {
  const { x, y } = axisKeys(result);
  const base = { id: 'preview', title: '', query: { mode: 'sql', sql: '' } as WidgetConfig['query'], refreshIntervalSec: 0 };
  if (block.kind === 'chart') {
    return { ...base, type: CHART_TYPE[block.chartType] ?? 'bar-chart', visual: { xAxisKey: x, yAxisKey: y, ...(block.visual as object) } };
  }
  if (block.kind === 'kpi') {
    return { ...base, type: 'kpi', title: block.label ?? '', visual: { yAxisKey: y } };
  }
  return { ...base, type: 'table', visual: {} };
}
