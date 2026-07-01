import { describe, it, expect } from 'vitest';
import { computeSummaryMetrics } from './report-summary';
import type { ReportMetricMeta } from '../../api';

const rows = [
  { antibiotic: 'AMP', percentR: 40, tested: 10 },
  { antibiotic: 'CIP', percentR: 60, tested: 30 },
];

describe('computeSummaryMetrics', () => {
  it('count returns the row count', () => {
    const m: ReportMetricMeta = { id: 'c', label: 'N', type: 'count' };
    expect(computeSummaryMetrics([m], rows)[0].value).toBe('2');
  });
  it('sum adds the column', () => {
    const m: ReportMetricMeta = { id: 's', label: 'Tested', type: 'sum', column: 'tested' };
    expect(computeSummaryMetrics([m], rows)[0].value).toBe('40');
  });
  it('avg averages the column', () => {
    const m: ReportMetricMeta = { id: 'a', label: 'Avg', type: 'avg', column: 'percentR' };
    expect(computeSummaryMetrics([m], rows)[0].value).toBe('50');
  });
  it('pct computes a matching percentage', () => {
    const m: ReportMetricMeta = { id: 'p', label: 'Pct', type: 'pct', column: 'antibiotic', match: 'AMP' };
    expect(computeSummaryMetrics([m], rows)[0].value).toBe('50%');
  });
  it('handles empty rows', () => {
    const m: ReportMetricMeta = { id: 'a', label: 'Avg', type: 'avg', column: 'percentR' };
    expect(computeSummaryMetrics([m], [])[0].value).toBe('0');
  });
});
