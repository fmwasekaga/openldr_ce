import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { ReportChart } from './ReportChart';
import type { ChartData } from '@openldr/report-builder/pure';

// Recharts' ResponsiveContainer needs a non-zero measured size to render its
// children in jsdom. jsdom reports 0 for layout, so we stub the size sources
// (offset*, getBoundingClientRect) and fire the ResizeObserver callback with a
// fixed size on observe(). Without this the surface renders empty (0 bar layers).
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 300 });
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 600, height: 300, top: 0, left: 0, bottom: 300, right: 600, x: 0, y: 0, toJSON() {} }),
  });
  globalThis.ResizeObserver = class ResizeObserver {
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe() { this.cb([{ contentRect: { width: 600, height: 300 } } as ResizeObserverEntry], this); }
    unobserve() {}
    disconnect() {}
  };
});

const two: ChartData = { title: '', categories: ['Jan', 'Feb'], series: [{ name: 'A', values: [5, 3] }, { name: 'B', values: [2, 4] }] };
const one: ChartData = { title: '', categories: ['Jan', 'Feb'], series: [{ name: 'value', values: [5, 3] }] };

describe('ReportChart', () => {
  it('renders one bar layer per series (2-series)', () => {
    const { container } = render(<div style={{ width: 300, height: 200 }}><ReportChart chartType="bar" data={two} /></div>);
    expect(container.querySelectorAll('.recharts-bar').length).toBe(2);
  });

  it('renders a single bar layer for one series', () => {
    const { container } = render(<div style={{ width: 300, height: 200 }}><ReportChart chartType="bar" data={one} /></div>);
    expect(container.querySelectorAll('.recharts-bar').length).toBe(1);
  });
});
