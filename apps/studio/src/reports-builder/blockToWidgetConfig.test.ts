import { describe, it, expect } from 'vitest';
import { blockToWidgetConfig } from './blockToWidgetConfig';

const result = {
  columns: [{ key: 'label', label: 'Organism', kind: 'string' }, { key: 'value', label: 'Count', kind: 'number' }],
  rows: [{ label: 'E. coli', value: 5 }],
  chart: { type: 'bar', x: 'label', y: 'value' },
  meta: { generatedAt: 'n', rowCount: 1 },
} as any;

describe('blockToWidgetConfig', () => {
  it('maps a kpi block to a kpi widget using the numeric column', () => {
    const cfg = blockToWidgetConfig({ kind: 'kpi', query: {} as any, label: 'Total' } as any, result);
    expect(cfg.type).toBe('kpi');
    expect(cfg.visual.yAxisKey).toBe('value');
    expect(cfg.title).toBe('Total');
  });
  it('maps a table block to a table widget', () => {
    expect(blockToWidgetConfig({ kind: 'table', source: 'primary', columns: [] } as any, result).type).toBe('table');
  });
});
