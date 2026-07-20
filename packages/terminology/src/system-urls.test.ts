import { describe, it, expect } from 'vitest';
import { canonicalSystemUrl } from './system-urls';
import { LOINC_SYSTEM } from './loaders/loinc';

describe('canonicalSystemUrl', () => {
  it('returns the loader LOINC_SYSTEM constant for loinc (same value, single source of truth)', () => {
    expect(canonicalSystemUrl('loinc')).toBe('http://loinc.org');
    expect(canonicalSystemUrl('loinc')).toBe(LOINC_SYSTEM);
  });
  it('has snomed/rxnorm canonical urls (generic, gated off elsewhere)', () => {
    expect(canonicalSystemUrl('snomed')).toBe('http://snomed.info/sct');
    expect(canonicalSystemUrl('rxnorm')).toBe('http://www.nlm.nih.gov/research/umls/rxnorm');
  });
  it('returns null for an unknown system type', () => {
    expect(canonicalSystemUrl('nope')).toBeNull();
    expect(canonicalSystemUrl('')).toBeNull();
  });
});
