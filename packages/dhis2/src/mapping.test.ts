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
  it('defaults missing params to {} so the report params schema (z.object) does not throw on undefined', () => {
    // A report source legitimately omits `params`; `reporting.run`'s `def.params.parse(...)` is a
    // z.object which throws "Required" on `undefined` (but accepts `{}`). Normalising here keeps the
    // DHIS2 push dry-run/push from failing with the redacted "operation connectors.push failed".
    expect(dispatchReportSource(mapping.source)).toEqual({ reportId: 'amr-resistance', params: {} });
  });
  it('preserves explicitly-supplied params', () => {
    expect(dispatchReportSource({ kind: 'report', reportId: 'amr-resistance', params: { region: 'north' } }))
      .toEqual({ reportId: 'amr-resistance', params: { region: 'north' } });
  });
  it('throws on an unsupported source kind', () => {
    expect(() => dispatchReportSource({ kind: 'query' } as never)).toThrow(/unsupported/i);
  });
});
