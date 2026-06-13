import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReportView } from './ReportView';
import type { ReportResult } from '../api';

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

const bar: ReportResult = {
  columns: [{ key: 'antibiotic', label: 'Antibiotic', kind: 'string' }, { key: 'percentR', label: '%R', kind: 'percent' }],
  rows: [{ antibiotic: 'AMP', percentR: 72 }],
  chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
  meta: { generatedAt: '2026-01-01T00:00:00Z', rowCount: 1 },
};

describe('ReportView', () => {
  it('renders the table with a percent cell', () => {
    render(<ReportView result={bar} />);
    expect(screen.getByText('Antibiotic')).toBeInTheDocument();
    expect(screen.getByText('AMP')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
  });
  it('renders the empty state', () => {
    render(<ReportView result={{ ...bar, rows: [], meta: { generatedAt: 'x', rowCount: 0 } }} />);
    expect(screen.getByText(/No data/)).toBeInTheDocument();
  });
  it('renders a stat chart', () => {
    render(<ReportView result={{ ...bar, rows: [], chart: { type: 'stat', value: '26', label: 'Avg hours' }, meta: { generatedAt: 'x', rowCount: 0 } }} />);
    expect(screen.getByText('26')).toBeInTheDocument();
    expect(screen.getByText('Avg hours')).toBeInTheDocument();
  });
});
