import { describe, it, expect, vi } from 'vitest';
import { createFormValidateService } from './form-validate-service';
import type { FormSchema, FormField } from '@openldr/forms';

const field = (over: Partial<FormField>): FormField => ({
  id: 'f', fhirPath: null, displayLabel: 'F', description: null, fieldType: 'text',
  required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' }, ...over,
}) as FormField;

const schema = (fields: FormField[]): FormSchema => ({
  id: 'form-1', name: 'T', versionLabel: null, fhirVersion: null, fhirResourceType: null,
  fhirProfileUrl: null, facilityId: null, fields, sections: [], targetPages: [],
  version: 1, active: true, status: 'published', createdAt: '', updatedAt: '',
}) as FormSchema;

describe('createFormValidateService', () => {
  it('throws when the form is not found', async () => {
    const svc = createFormValidateService({ forms: { get: vi.fn(async () => null) } });
    await expect(svc({ formId: 'missing', items: [] })).rejects.toThrow(/Form not found/);
  });

  it('collects invalid items into meta and excludes them from output', async () => {
    const forms = { get: vi.fn(async () => ({ schema: schema([field({ id: 'name', displayLabel: 'Name', required: true })]) })) };
    const svc = createFormValidateService({ forms });
    const out = await svc({ formId: 'form-1', items: [{ json: {} }] });
    expect(out.meta.validated).toBe(0);
    expect(out.meta.invalid).toEqual([{ index: 0, errors: [{ fieldId: 'name', reason: 'required' }] }]);
    expect(out.items).toEqual([]);
  });

  it('counts a valid item as validated', async () => {
    const forms = { get: vi.fn(async () => ({ schema: schema([field({ id: 'name', required: true })]) })) };
    const svc = createFormValidateService({ forms });
    const out = await svc({ formId: 'form-1', items: [{ json: { name: 'Ada' } }] });
    expect(out.meta.validated).toBe(1);
    expect(out.meta.invalid).toEqual([]);
  });
});
