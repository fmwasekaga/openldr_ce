import { describe, it, expect } from 'vitest';
import { buildDataValueSet, dispatchReportSource } from './mapping';
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
const orgMap = new Map([['fac-1', 'OU_AAA']]);

describe('buildDataValueSet', () => {
  it('maps rows to dataValues, resolving orgUnit + period', () => {
    const rows = [{ facility: 'fac-1', tested: 4, r: 2 }];
    const { payload, skipped } = buildDataValueSet(rows, mapping, orgMap, '2026Q1');
    expect(skipped).toEqual([]);
    expect(payload.dataValues).toEqual([
      { dataElement: 'DE_TESTED', orgUnit: 'OU_AAA', period: '2026Q1', value: '4' },
      { dataElement: 'DE_RESISTANT', categoryOptionCombo: 'COC_DEFAULT', orgUnit: 'OU_AAA', period: '2026Q1', value: '2' },
    ]);
  });
  it('skips rows whose facility has no orgUnit mapping', () => {
    const rows = [{ facility: 'unmapped', tested: 1, r: 0 }];
    const { payload, skipped } = buildDataValueSet(rows, mapping, orgMap, '2026Q1');
    expect(payload.dataValues).toEqual([]);
    expect(skipped[0].reason).toMatch(/orgUnit/i);
  });
  it('skips null/empty values but keeps others', () => {
    const rows = [{ facility: 'fac-1', tested: 4, r: null }];
    const { payload } = buildDataValueSet(rows, mapping, orgMap, '2026Q1');
    expect(payload.dataValues.map((d) => d.dataElement)).toEqual(['DE_TESTED']);
  });
  it('uses periodColumn when present', () => {
    const m = { ...mapping, periodColumn: 'month' };
    const rows = [{ facility: 'fac-1', tested: 1, r: 0, month: '202601' }];
    const { payload } = buildDataValueSet(rows, m, orgMap, 'IGNORED');
    expect(payload.dataValues[0].period).toBe('202601');
  });
});

describe('dispatchReportSource', () => {
  it('returns the report descriptor for a report source', () => {
    expect(dispatchReportSource(mapping.source)).toEqual({ reportId: 'amr-resistance', params: undefined });
  });
  it('throws on an unsupported source kind', () => {
    expect(() => dispatchReportSource({ kind: 'query' } as never)).toThrow(/unsupported/i);
  });
});
