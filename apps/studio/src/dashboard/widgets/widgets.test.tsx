import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { renderWidget } from './index';
import type { ReportResult, WidgetConfig } from '../../api';

// Recharts ResponsiveContainer needs a non-zero size and ResizeObserver in jsdom.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 300 });
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

const result: ReportResult = { columns: [{ key: 'label', label: 'L', kind: 'string' }, { key: 'value', label: 'V', kind: 'number' }], rows: [{ label: 'A', value: 5 }, { label: 'B', value: 3 }], chart: { type: 'bar', x: 'label', y: 'value' }, meta: { generatedAt: 'now', rowCount: 2 } };
const cfg = (type: string): WidgetConfig => ({ id: 'w', type, title: 'T', refreshIntervalSec: 0, visual: {}, query: { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] } });

describe('renderWidget', () => {
  for (const t of ['kpi', 'line-chart', 'bar-chart', 'area-chart', 'row-chart', 'pie-chart', 'scatter-plot', 'funnel', 'progress-bar', 'gauge', 'table', 'traffic-light']) {
    it(`renders ${t} without crashing`, () => {
      const { container } = render(<div style={{ width: 400, height: 300 }}>{renderWidget(cfg(t), result)}</div>);
      expect(container).toBeTruthy();
    });
  }
  it('kpi shows the value', () => {
    const single: ReportResult = { ...result, rows: [{ label: 'X', value: 42 }], chart: { type: 'stat', value: '42', label: 'X' } };
    const { getByText } = render(renderWidget(cfg('kpi'), single));
    expect(getByText('42')).toBeTruthy();
  });
});
