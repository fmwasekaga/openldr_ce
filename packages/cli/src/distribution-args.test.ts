import { describe, it, expect } from 'vitest';
import { validateDistributionImportArgs, isActiveJobConflict } from './distribution-args';

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

describe('isActiveJobConflict', () => {
  it('treats the hasActive guard error (message "already active") as a conflict', () => {
    expect(isActiveJobConflict(new Error('A terminology ingest job is already active for system "snomed"'))).toBe(true);
  });
  it('treats a Postgres unique_violation (code 23505) as a conflict', () => {
    expect(isActiveJobConflict(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }))).toBe(true);
  });
  it('does NOT treat a transient/unrelated error as a conflict', () => {
    expect(isActiveJobConflict(new Error('connection terminated unexpectedly'))).toBe(false);
    expect(isActiveJobConflict(Object.assign(new Error('too many connections'), { code: '53300' }))).toBe(false);
    expect(isActiveJobConflict('some non-error value')).toBe(false);
    expect(isActiveJobConflict(null)).toBe(false);
  });
});
