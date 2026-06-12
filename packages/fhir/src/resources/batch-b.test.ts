import { describe, it, expect } from 'vitest';
import { Specimen } from './specimen';
import { ServiceRequest } from './service-request';
import { DiagnosticReport } from './diagnostic-report';
import { Observation } from './observation';
import { Bundle } from './bundle';

describe('Specimen (isolate = derived Specimen)', () => {
  it('parses an isolate Specimen with parent', () => {
    expect(
      Specimen.safeParse({
        resourceType: 'Specimen',
        status: 'available',
        type: { text: 'isolate' },
        parent: [{ reference: 'Specimen/parent-1' }],
        subject: { reference: 'Patient/1' },
      }).success,
    ).toBe(true);
  });
  it('rejects a bad status', () => {
    expect(Specimen.safeParse({ resourceType: 'Specimen', status: 'bogus' }).success).toBe(false);
  });
});

describe('ServiceRequest required elements', () => {
  it('requires status, intent, subject', () => {
    expect(ServiceRequest.safeParse({ resourceType: 'ServiceRequest' }).success).toBe(false);
    expect(
      ServiceRequest.safeParse({ resourceType: 'ServiceRequest', status: 'active', intent: 'order', subject: { reference: 'Patient/1' } }).success,
    ).toBe(true);
  });
});

describe('DiagnosticReport required elements', () => {
  it('requires status and code', () => {
    expect(DiagnosticReport.safeParse({ resourceType: 'DiagnosticReport', status: 'final' }).success).toBe(false);
    expect(DiagnosticReport.safeParse({ resourceType: 'DiagnosticReport', status: 'final', code: { text: 'Culture' } }).success).toBe(true);
  });
});

describe('Observation (organism + AST)', () => {
  it('parses an AST observation with components referencing a specimen', () => {
    expect(
      Observation.safeParse({
        resourceType: 'Observation',
        status: 'final',
        code: { text: 'Ciprofloxacin susceptibility' },
        specimen: { reference: 'Specimen/isolate-1' },
        valueCodeableConcept: { text: 'Resistant' },
        interpretation: [{ coding: [{ code: 'R' }] }],
      }).success,
    ).toBe(true);
  });
  it('requires status and code', () => {
    expect(Observation.safeParse({ resourceType: 'Observation', code: { text: 'x' } }).success).toBe(false);
  });
});

describe('Bundle', () => {
  it('requires type and accepts entries', () => {
    expect(Bundle.safeParse({ resourceType: 'Bundle' }).success).toBe(false);
    expect(Bundle.safeParse({ resourceType: 'Bundle', type: 'collection', entry: [{ resource: { resourceType: 'Patient' } }] }).success).toBe(true);
  });
});
