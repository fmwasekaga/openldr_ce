import { describe, it, expect } from 'vitest';
import { ReportDefSchema } from './report-def';

describe('ReportDefSchema', () => {
  it('parses a minimal report def and defaults status to draft', () => {
    const parsed = ReportDefSchema.parse({
      id: 'r-amr-resistance', name: 'AMR Resistance Rate', description: 'x',
      category: 'amr', designId: 'd1', primaryQueryId: 'q1',
    });
    expect(parsed.status).toBe('draft');
    expect(parsed.summaryMetrics).toBeUndefined();
    expect(parsed.paramOptions).toBeUndefined();
  });

  it('keeps summaryMetrics, chart, paramOptions and published status', () => {
    const parsed = ReportDefSchema.parse({
      id: 'r1', name: 'n', description: '', category: 'operational',
      designId: 'd1', primaryQueryId: 'q1', status: 'published',
      summaryMetrics: [{ id: 'm', label: 'M', type: 'count' }],
      chart: { type: 'bar', x: 'a', y: 'b' },
      paramOptions: { facility: 'q-facilities' },
    });
    expect(parsed.status).toBe('published');
    expect(parsed.paramOptions).toEqual({ facility: 'q-facilities' });
    expect(parsed.chart).toEqual({ type: 'bar', x: 'a', y: 'b' });
  });

  it('rejects an unknown category', () => {
    expect(() => ReportDefSchema.parse({
      id: 'r1', name: 'n', description: '', category: 'nope', designId: 'd', primaryQueryId: 'q',
    })).toThrow();
  });
});
