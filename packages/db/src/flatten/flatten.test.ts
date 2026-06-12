import { describe, it, expect } from 'vitest';
import { flattenResource } from './index';

describe('flattenResource', () => {
  it('flattens a Patient to a scalar row', () => {
    const out = flattenResource(
      {
        resourceType: 'Patient',
        id: 'p1',
        identifier: [{ system: 'urn:mrn', value: '123' }],
        name: [{ family: 'Doe', given: ['Jane'] }],
        gender: 'female',
        birthDate: '1990-05-01',
        managingOrganization: { reference: 'Organization/o1' },
      },
      { sourceSystem: 'whonet' },
    );
    expect(out?.table).toBe('patients');
    expect(out?.row).toMatchObject({
      id: 'p1',
      identifier_system: 'urn:mrn',
      identifier_value: '123',
      family_name: 'Doe',
      given_name: 'Jane',
      gender: 'female',
      birth_date: '1990-05-01',
      managing_organization: 'Organization/o1',
      source_system: 'whonet',
      plugin_id: null,
    });
  });

  it('flattens an Observation including value + specimen ref', () => {
    const out = flattenResource({
      resourceType: 'Observation',
      id: 'o1',
      status: 'final',
      code: { coding: [{ code: 'CIP', display: 'Ciprofloxacin' }] },
      specimen: { reference: 'Specimen/iso1' },
      valueCodeableConcept: { text: 'Resistant' },
      interpretation: [{ coding: [{ code: 'R' }] }],
    });
    expect(out?.table).toBe('observations');
    expect(out?.row).toMatchObject({
      id: 'o1',
      status: 'final',
      code_code: 'CIP',
      code_text: 'Ciprofloxacin',
      specimen_ref: 'Specimen/iso1',
      value_text: 'Resistant',
      interpretation_code: 'R',
    });
  });

  it('returns null for a non-domain resource (Bundle)', () => {
    expect(flattenResource({ resourceType: 'Bundle', type: 'collection' })).toBeNull();
  });

  it('returns null for a non-object', () => {
    expect(flattenResource(null)).toBeNull();
  });
});
