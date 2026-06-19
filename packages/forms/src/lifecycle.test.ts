import { describe, expect, it } from 'vitest';
import { computeNextFormVersion, formContentChanged, makeDuplicateName } from './lifecycle';
import { makeField, makeSchema } from './__fixtures__/forms';

function schema() {
  return makeSchema({
    id: 'specimen-intake',
    name: 'Specimen intake',
    fields: [makeField({ id: 'q1', displayLabel: 'Question', fieldType: 'text', order: 0 })],
    sections: [{ id: 'main', label: 'Main', order: 0 }],
  });
}

describe('computeNextFormVersion', () => {
  it('starts at 1 when no versions exist', () => {
    expect(computeNextFormVersion([])).toBe(1);
  });

  it('returns one more than the highest existing version', () => {
    expect(computeNextFormVersion([1, 3, 2])).toBe(4);
  });
});

describe('makeDuplicateName', () => {
  it('appends " copy" suffix', () => {
    expect(makeDuplicateName('X')).toBe('X copy');
  });

  it('works with multi-word names', () => {
    expect(makeDuplicateName('Specimen intake')).toBe('Specimen intake copy');
  });
});

describe('formContentChanged', () => {
  const base = {
    name: 'Specimen intake',
    fhirResourceType: 'Questionnaire' as string | null,
    targetPages: ['forms'] as string[],
    schema: schema(),
  };

  it('returns false for identical content', () => {
    expect(formContentChanged(base, { ...base })).toBe(false);
  });

  it('returns true when name changes', () => {
    expect(formContentChanged(base, { ...base, name: 'New name' })).toBe(true);
  });

  it('returns true when fields change', () => {
    const modified = {
      ...base,
      schema: makeSchema({
        id: 'specimen-intake',
        name: 'Specimen intake',
        fields: [makeField({ id: 'q1', displayLabel: 'Changed label', fieldType: 'text', order: 0 })],
      }),
    };
    expect(formContentChanged(base, modified)).toBe(true);
  });

  it('returns true when sections change', () => {
    const modified = {
      ...base,
      schema: makeSchema({
        id: 'specimen-intake',
        name: 'Specimen intake',
        fields: base.schema.fields,
        sections: [{ id: 'new-section', label: 'New', order: 0 }],
      }),
    };
    expect(formContentChanged(base, modified)).toBe(true);
  });

  it('returns true when targetPages change', () => {
    expect(formContentChanged(base, { ...base, targetPages: ['specimens'] })).toBe(true);
  });

  it('returns true when fhirResourceType changes', () => {
    expect(formContentChanged(base, { ...base, fhirResourceType: 'Observation' })).toBe(true);
  });

  it('returns false when only version or timestamps differ (envelope-only change)', () => {
    const before = { ...base, schema: { ...schema(), version: 1, updatedAt: '2026-01-01T00:00:00.000Z' } };
    const after = { ...base, schema: { ...schema(), version: 2, updatedAt: '2026-06-01T00:00:00.000Z' } };
    expect(formContentChanged(before, after)).toBe(false);
  });
});
