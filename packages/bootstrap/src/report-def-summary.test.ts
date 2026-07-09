import { describe, it, expect } from 'vitest';
import { reportDefToSummary } from './index';

describe('reportDefToSummary', () => {
  it('derives filter params from the design and marks the source', () => {
    const def = { id: 'r1', name: 'AMR', description: 'd', category: 'amr', designId: 'd1',
      primaryQueryId: 'q1', summaryMetrics: [{ id: 'm', label: 'M', type: 'count' }],
      paramOptions: { facility: 'q-fac' }, status: 'published' } as any;
    const design = { id: 'd1', name: 'AMR', paper: 'A4', orientation: 'portrait', pages: [], parameters: [
      { key: 'dateRange', label: 'Date range', type: 'daterange' },
      { key: 'facility', label: 'Facility', type: 'select' },
      { key: 'note', label: 'Note', type: 'text', required: true },
    ] } as any;
    const s = reportDefToSummary(def, design);
    expect(s.source).toBe('design');
    expect(s.category).toBe('amr');
    expect(s.summaryMetrics).toEqual([{ id: 'm', label: 'M', type: 'count' }]);
    expect(s.parameters).toEqual([
      { id: 'dateRange', label: 'Date range', type: 'daterange', required: false },
      { id: 'facility', label: 'Facility', type: 'select', required: false, optionsKey: 'facility' },
      { id: 'note', label: 'Note', type: 'text', required: true },
    ]);
  });
});
