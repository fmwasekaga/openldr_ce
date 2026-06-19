import { describe, expect, it } from 'vitest';
import { makeExampleAnswers } from './example';
import type { FormSchema } from './types';

const schema: FormSchema = {
  id: 'ex1',
  name: 'Example form',
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: null,
  fhirProfileUrl: null,
  facilityId: null,
  fields: [
    {
      id: 'name',
      fhirPath: null,
      displayLabel: 'Name',
      description: null,
      fieldType: 'text',
      required: false,
      enabled: true,
      order: 1,
      cardinality: { min: 0, max: '1' },
    },
    {
      id: 'age',
      fhirPath: null,
      displayLabel: 'Age',
      description: null,
      fieldType: 'number',
      required: false,
      enabled: true,
      order: 2,
      cardinality: { min: 0, max: '1' },
    },
    {
      id: 'ok',
      fhirPath: null,
      displayLabel: 'OK?',
      description: null,
      fieldType: 'boolean',
      required: false,
      enabled: true,
      order: 3,
      cardinality: { min: 0, max: '1' },
    },
    {
      id: 'sex',
      fhirPath: null,
      displayLabel: 'Sex',
      description: null,
      fieldType: 'select',
      required: false,
      enabled: true,
      order: 4,
      cardinality: { min: 0, max: '1' },
      valueSetOptions: [{ code: 'f', display: 'F' }],
    },
    {
      id: 'disabled_field',
      fhirPath: null,
      displayLabel: 'Hidden',
      description: null,
      fieldType: 'text',
      required: false,
      enabled: false,
      order: 5,
      cardinality: { min: 0, max: '1' },
    },
  ],
  sections: [],
  targetPages: [],
  languages: ['en'],
  version: 1,
  active: true,
  status: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('makeExampleAnswers', () => {
  it('returns example values for each enabled field type', () => {
    const result = makeExampleAnswers(schema);
    expect(typeof result['name']).toBe('string');
    expect(typeof result['age']).toBe('number');
    expect(result['ok']).toBe(true);
    expect(result['sex']).toBe('f');
  });

  it('omits disabled fields', () => {
    const result = makeExampleAnswers(schema);
    expect('disabled_field' in result).toBe(false);
  });
});
