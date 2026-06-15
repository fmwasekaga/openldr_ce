import { describe, it, expect } from 'vitest';
import { resolveSeedPublisherId } from './seed-publishers';

describe('resolveSeedPublisherId', () => {
  it('maps loinc → pub-loinc and unknown → pub-system', () => {
    expect(resolveSeedPublisherId('http://loinc.org')).toBe('pub-loinc');
    expect(resolveSeedPublisherId('http://snomed.info/sct')).toBe('pub-snomed-ct');
    expect(resolveSeedPublisherId('http://hl7.org/fhir/administrative-gender')).toBe('pub-hl7-fhir');
    expect(resolveSeedPublisherId('http://hl7.org/fhir/sid/icd-10')).toBe('pub-who-icd-10'); // longer prefix beats hl7
    expect(resolveSeedPublisherId('http://id.who.int/icd/release/11/mms')).toBe('pub-who-icd-11');
    expect(resolveSeedPublisherId('http://example.org/x')).toBe('pub-system'); // no match → System
  });
});
