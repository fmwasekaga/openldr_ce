import { describe, expect, it } from 'vitest';
import { computeNextFormVersion, formContentChanged, makeDuplicateName } from './lifecycle';
import type { FormSchema } from './schema/form-schema';

const schema = (overrides: Partial<FormSchema> = {}): FormSchema => ({
  id: 'specimen-intake',
  name: 'Specimen intake',
  title: { en: 'Specimen intake' },
  status: 'draft',
  languages: ['en'],
  sections: [{ id: 'main', title: { en: 'Main' }, fields: [{ id: 'q1', type: 'string', label: { en: 'Question' } }] }],
  ...overrides,
});

describe('computeNextFormVersion', () => {
  it('starts at version 1 when no versions exist', () => {
    expect(computeNextFormVersion([])).toBe(1);
  });

  it('returns one more than the highest existing version', () => {
    expect(computeNextFormVersion([1, 3, 2])).toBe(4);
  });
});

describe('formContentChanged', () => {
  const base = {
    name: 'Specimen intake',
    versionLabel: 'v1',
    fhirResourceType: 'Questionnaire',
    schema: schema(),
    targetPages: ['forms'],
  };

  it('ignores version label-only changes', () => {
    expect(formContentChanged(base, { ...base, versionLabel: 'v2' })).toBe(false);
  });

  it('detects name, schema, target page, and FHIR resource type changes', () => {
    expect(formContentChanged(base, { ...base, name: 'Updated intake' })).toBe(true);
    expect(formContentChanged(base, { ...base, schema: schema({ title: { en: 'Updated' } }) })).toBe(true);
    expect(formContentChanged(base, { ...base, targetPages: ['specimens'] })).toBe(true);
    expect(formContentChanged(base, { ...base, fhirResourceType: 'Observation' })).toBe(true);
  });
});

describe('makeDuplicateName', () => {
  it('appends a copy suffix', () => {
    expect(makeDuplicateName('Specimen intake')).toBe('Specimen intake copy');
  });
});
