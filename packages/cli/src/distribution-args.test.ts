import { describe, it, expect } from 'vitest';
import { validateDistributionImportArgs } from './distribution-args';

describe('validateDistributionImportArgs', () => {
  it('rejects an unsupported system', () => {
    expect(validateDistributionImportArgs('icd10', { file: 'x.zip', acceptLicense: true })).toMatch(/unsupported system/);
  });
  it('requires --file', () => {
    expect(validateDistributionImportArgs('loinc', { acceptLicense: true })).toMatch(/--file/);
  });
  it('requires --accept-license', () => {
    expect(validateDistributionImportArgs('snomed', { file: 'x.zip' })).toMatch(/license/);
  });
  it('passes for a valid loinc/snomed/rxnorm invocation', () => {
    for (const s of ['loinc', 'snomed', 'rxnorm']) {
      expect(validateDistributionImportArgs(s, { file: 'x.zip', acceptLicense: true })).toBeNull();
    }
  });
});
