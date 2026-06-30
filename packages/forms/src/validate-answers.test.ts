import { describe, it, expect } from 'vitest';
import { validateAnswers } from './validate-answers';
import type { FormSchema, FormField } from './schema/form-schema';

const field = (over: Partial<FormField>): FormField => ({
  id: 'f', fhirPath: null, displayLabel: 'F', description: null, fieldType: 'text',
  required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' }, ...over,
}) as FormField;

const model = (fields: FormField[]): FormSchema => ({
  id: 'form-1', name: 'T', versionLabel: null, fhirVersion: null, fhirResourceType: null,
  fhirProfileUrl: null, facilityId: null, fields, sections: [], targetPages: [],
  version: 1, active: true, status: 'published', createdAt: '', updatedAt: '',
}) as FormSchema;

describe('validateAnswers', () => {
  it('flags a missing required field', () => {
    const errs = validateAnswers(model([field({ id: 'name', displayLabel: 'Name', required: true })]), {});
    expect(errs).toEqual([{ fieldId: 'name', label: 'Name', reason: 'required' }]);
  });

  it('passes when a required field is present', () => {
    const errs = validateAnswers(model([field({ id: 'name', required: true })]), { name: 'Ada' });
    expect(errs).toEqual([]);
  });

  it('rejects a select value outside the option set', () => {
    const f = field({ id: 'sex', fieldType: 'select', valueSetOptions: [{ code: 'M', display: 'Male' }, { code: 'F', display: 'Female' }] });
    const errs = validateAnswers(model([f]), { sex: 'X' });
    expect(errs).toHaveLength(1);
    expect(errs[0].fieldId).toBe('sex');
  });

  it('allows a custom select value when allowCustomValue is set', () => {
    const f = field({ id: 'sex', fieldType: 'select', allowCustomValue: true, valueSetOptions: [{ code: 'M', display: 'Male' }] });
    expect(validateAnswers(model([f]), { sex: 'X' })).toEqual([]);
  });

  it('enforces numeric min/max', () => {
    const f = field({ id: 'age', fieldType: 'number', constraints: { min: 0, max: 120 } });
    expect(validateAnswers(model([f]), { age: 200 })).toHaveLength(1);
    expect(validateAnswers(model([f]), { age: 30 })).toEqual([]);
  });

  it('enforces text maxLength', () => {
    const f = field({ id: 'note', fieldType: 'text', constraints: { maxLength: 3 } });
    expect(validateAnswers(model([f]), { note: 'abcd' })).toHaveLength(1);
  });

  it('skips disabled and group fields', () => {
    const disabled = field({ id: 'a', required: true, enabled: false });
    const group = field({ id: 'g', required: true, fieldType: 'group' });
    expect(validateAnswers(model([disabled, group]), {})).toEqual([]);
  });
});
