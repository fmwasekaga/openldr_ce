import { describe, expect, it } from 'vitest';
import { FormSchema, FormField, FieldType } from './form-schema';

const field = {
  id: 'name', fhirPath: 'name', displayLabel: 'Name', description: null,
  fieldType: 'text', required: true, enabled: true, order: 0,
  cardinality: { min: 0, max: '1' },
};

describe('form-schema (corlix model)', () => {
  it('accepts the full 17-type union', () => {
    for (const t of ['text','number','date','datetime','boolean','select','multiselect','phone','email','address','identifier','attachment','organism','antibiogram','reference','facility','group']) {
      expect(FieldType.parse(t)).toBe(t);
    }
  });

  it('parses a flat field with corlix props', () => {
    const parsed = FormField.parse({ ...field, code: [{ system: 'http://loinc.org', code: '1234-5' }], translations: { fr: { label: 'Nom' } }, visibility: { combinator: 'all', conditions: [{ fieldId: 'x', operator: 'isNotEmpty' }] } });
    expect(parsed.fieldType).toBe('text');
    expect(parsed.code?.[0].code).toBe('1234-5');
    expect(parsed.translations?.fr.label).toBe('Nom');
    expect(parsed.visibility?.conditions[0].operator).toBe('isNotEmpty');
  });

  it('parses a flat FormSchema with form-level FHIR metadata', () => {
    const schema = FormSchema.parse({
      id: 'facility', name: 'Facility', versionLabel: '1.0.0',
      fhirVersion: 'R4', fhirResourceType: 'Location', fhirProfileUrl: null, facilityId: null,
      fields: [field], sections: [], targetPages: ['facilities'], languages: ['fr'],
      version: 1, active: true, status: 'draft', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(schema.fhirResourceType).toBe('Location');
    expect(schema.fields[0].id).toBe('name');
  });

  it('rejects an unknown field type', () => {
    expect(() => FormField.parse({ ...field, fieldType: 'bogus' })).toThrow();
  });
});
