import { describe, it, expect } from 'vitest';
import { EXT_OPENLDR_SPECIMEN_ORIGIN, readSpecimenOrigin } from './specimen-origin';

describe('readSpecimenOrigin', () => {
  const ext = (code: string) => ({ resourceType: 'Specimen', id: 's', extension: [{ url: EXT_OPENLDR_SPECIMEN_ORIGIN, valueCode: code }] });
  it('reads a valid origin code', () => {
    expect(readSpecimenOrigin(ext('inpatient'))).toBe('inpatient');
    expect(readSpecimenOrigin(ext('outpatient'))).toBe('outpatient');
    expect(readSpecimenOrigin(ext('unknown'))).toBe('unknown');
  });
  it('returns null when the extension is absent', () => {
    expect(readSpecimenOrigin({ resourceType: 'Specimen', id: 's' })).toBeNull();
  });
  it('returns null for an unrecognized code', () => {
    expect(readSpecimenOrigin(ext('bogus'))).toBeNull();
  });
});
