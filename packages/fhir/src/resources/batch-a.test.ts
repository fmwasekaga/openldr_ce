import { describe, it, expect } from 'vitest';
import { Patient } from './patient';
import { Organization } from './organization';
import { Location } from './location';

describe('Patient', () => {
  it('parses a valid Patient and preserves an extension', () => {
    const r = Patient.safeParse({
      resourceType: 'Patient',
      id: 'p1',
      gender: 'female',
      birthDate: '1990-05-01',
      name: [{ family: 'Doe', given: ['Jane'] }],
      extension: [{ url: 'urn:x', valueString: 'keep' }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as Record<string, unknown>).extension).toBeDefined();
  });
  it('rejects a bad gender code', () => {
    expect(Patient.safeParse({ resourceType: 'Patient', gender: 'X' }).success).toBe(false);
  });
  it('rejects a wrong resourceType', () => {
    expect(Patient.safeParse({ resourceType: 'Observation' }).success).toBe(false);
  });
});

describe('Organization & Location', () => {
  it('Organization parses', () => {
    expect(Organization.safeParse({ resourceType: 'Organization', name: 'Central Lab' }).success).toBe(true);
  });
  it('Location validates its status enum', () => {
    expect(Location.safeParse({ resourceType: 'Location', status: 'active', name: 'Bench 1' }).success).toBe(true);
    expect(Location.safeParse({ resourceType: 'Location', status: 'bogus' }).success).toBe(false);
  });
});
