import { describe, it, expect } from 'vitest';
import { deriveSystemCode, resolveSeedPublisherId } from './seed-publishers';

describe('resolveSeedPublisherId', () => {
  it('maps loinc → pub-loinc and unknown → pub-system', () => {
    expect(resolveSeedPublisherId('http://loinc.org')).toBe('pub-loinc');
    expect(resolveSeedPublisherId('http://snomed.info/sct')).toBe('pub-snomed-ct');
    expect(resolveSeedPublisherId('http://hl7.org/fhir/administrative-gender')).toBe('pub-hl7-fhir');
    expect(resolveSeedPublisherId('http://hl7.org/fhir/sid/icd-10')).toBe('pub-who-icd-10'); // longer prefix beats hl7
    expect(resolveSeedPublisherId('http://id.who.int/icd/release/11/mms')).toBe('pub-who-icd-11');
    expect(resolveSeedPublisherId('http://unitsofmeasure.org')).toBe('pub-ucum');
    expect(resolveSeedPublisherId('http://www.nlm.nih.gov/research/umls/rxnorm')).toBe('pub-rxnorm');
    expect(resolveSeedPublisherId('http://example.org/x')).toBe('pub-system'); // no match → System
  });
});

describe('deriveSystemCode', () => {
  it('uses the SNOMED CT display code for the canonical SCT URL', () => {
    expect(deriveSystemCode('http://snomed.info/sct')).toBe('SNOMED-CT');
  });
});
