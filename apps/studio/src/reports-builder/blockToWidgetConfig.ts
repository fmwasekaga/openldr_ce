import type { WidgetConfig, ReportResult } from '../api';
import type { Block } from '@openldr/report-builder/pure';

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
  // Chart blocks are rendered by ReportChart (see CanvasBlock); this maps kpi/table only.
  if (block.kind === 'kpi') {
    return { ...base, type: 'kpi', title: block.label ?? '', visual: { yAxisKey: y } };
  }
  return { ...base, type: 'table', visual: {} };
}
