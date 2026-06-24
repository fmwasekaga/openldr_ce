import { describe, it, expect } from 'vitest';
import { dispatchReportSource } from './mapping';
import type { AggregateMapping } from './types';

const mapping: AggregateMapping = {
  id: 'amr-to-dhis2',
  name: 'AMR to DHIS2',
  source: { kind: 'report', reportId: 'amr-resistance' },
  orgUnitColumn: 'facility',
  columns: [
    { column: 'tested', dataElement: 'DE_TESTED' },
    { column: 'r', dataElement: 'DE_RESISTANT', categoryOptionCombo: 'COC_DEFAULT' },
  ],
};

describe('dispatchReportSource', () => {
  it('returns the report descriptor for a report source', () => {
    expect(dispatchReportSource(mapping.source)).toEqual({ reportId: 'amr-resistance', params: undefined });
  });
  it('throws on an unsupported source kind', () => {
    expect(() => dispatchReportSource({ kind: 'query' } as never)).toThrow(/unsupported/i);
  });
});
