import { describe, it, expect } from 'vitest';
import { resolvePublisher, type PublisherPrefixes } from './resolve-publisher';

const PUBS: PublisherPrefixes[] = [
  { id: 'sys', matchPrefixes: [] },
  { id: 'hl7', matchPrefixes: ['http://hl7.org/fhir/', 'http://terminology.hl7.org/'] },
  { id: 'loinc', matchPrefixes: ['http://loinc.org'] },
  { id: 'icd10', matchPrefixes: ['http://hl7.org/fhir/sid/icd-10'] },
];

describe('resolvePublisher', () => {
  it('matches by exact prefix', () => {
    expect(resolvePublisher('http://loinc.org', PUBS)?.id).toBe('loinc');
  });
  it('prefers the longest matching prefix', () => {
    expect(resolvePublisher('http://hl7.org/fhir/sid/icd-10', PUBS)?.id).toBe('icd10');
  });
  it('returns null when nothing matches', () => {
    expect(resolvePublisher('http://example.org/whonet', PUBS)).toBeNull();
  });
});
