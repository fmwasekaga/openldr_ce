import { describe, it, expect } from 'vitest';
import { simpleTableDesign } from './simple-design';

describe('simpleTableDesign', () => {
  it('builds a one-table A4 design bound to a query with a title, date and params', () => {
    const d = simpleTableDesign({
      id: 'rt-amr-resistance', name: 'AMR Resistance Rate', queryId: 'q-amr-resistance',
      columns: [{ key: 'antibiotic', label: 'Antibiotic' }, { key: 'percentR', label: '%R' }],
      parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange' }, { key: 'facility', label: 'Facility', type: 'select' }],
    });
    expect(d.pages[0].elements.some((e) => e.kind === 'table' && e.dataSource?.queryId === 'q-amr-resistance')).toBe(true);
    const table = d.pages[0].elements.find((e) => e.kind === 'table')!;
    expect(table.boundColumns).toEqual([{ key: 'antibiotic', label: 'Antibiotic' }, { key: 'percentR', label: '%R' }]);
    expect(d.parameters).toHaveLength(2);
  });
});
