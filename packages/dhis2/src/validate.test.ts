import { describe, it, expect } from 'vitest';
import { validateMapping } from './validate';
import type { AggregateMapping } from './types';
import type { TargetMetadata } from '@openldr/ports';

const metadata: TargetMetadata = {
  dataElements: [{ id: 'DE_TESTED', name: 'Tested' }],
  orgUnits: [{ id: 'OU_AAA', name: 'Facility A' }],
  categoryOptionCombos: [{ id: 'COC_DEFAULT', name: 'default' }],
};
const base: AggregateMapping = {
  id: 'm', name: 'm', source: { kind: 'report', reportId: 'amr-resistance' }, orgUnitColumn: 'facility',
  columns: [{ column: 'tested', dataElement: 'DE_TESTED' }],
};

describe('validateMapping', () => {
  it('passes when all dataElements/cocs exist', () => {
    expect(validateMapping(base, metadata)).toEqual([]);
  });
  it('flags an unknown dataElement', () => {
    const m = { ...base, columns: [{ column: 'x', dataElement: 'DE_MISSING' }] };
    expect(validateMapping(m, metadata).some((p) => p.includes('DE_MISSING'))).toBe(true);
  });
  it('flags an unknown categoryOptionCombo', () => {
    const m = { ...base, columns: [{ column: 'tested', dataElement: 'DE_TESTED', categoryOptionCombo: 'COC_X' }] };
    expect(validateMapping(m, metadata).some((p) => p.includes('COC_X'))).toBe(true);
  });
});
