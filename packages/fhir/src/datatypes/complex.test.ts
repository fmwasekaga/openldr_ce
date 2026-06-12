import { describe, it, expect } from 'vitest';
import { Identifier, Coding, CodeableConcept, Reference, HumanName, Quantity } from './complex';

describe('fhir complex datatypes', () => {
  it('Coding accepts a typical coding and preserves extensions', () => {
    const r = Coding.safeParse({ system: 'http://loinc.org', code: '2339-0', display: 'Glucose', extension: [{ url: 'x' }] });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as Record<string, unknown>).extension).toBeDefined();
  });
  it('CodeableConcept nests codings', () => {
    expect(CodeableConcept.safeParse({ coding: [{ code: 'x' }], text: 'glucose' }).success).toBe(true);
  });
  it('Identifier validates use enum', () => {
    expect(Identifier.safeParse({ system: 'urn:x', value: '123', use: 'official' }).success).toBe(true);
    expect(Identifier.safeParse({ use: 'bogus' }).success).toBe(false);
  });
  it('Reference and HumanName parse', () => {
    expect(Reference.safeParse({ reference: 'Patient/1' }).success).toBe(true);
    expect(HumanName.safeParse({ family: 'Doe', given: ['Jane'] }).success).toBe(true);
  });
  it('Quantity rejects a non-numeric value', () => {
    expect(Quantity.safeParse({ value: 'high' }).success).toBe(false);
  });
});
