import { describe, expect, it } from 'vitest';
import { PAGE_TARGETS, getPageTarget, validateTemplateTargets } from './page-targets';
import type { FormField } from './schema/form-schema';

const field = (over: Partial<FormField>): FormField => ({ id: 'f', fhirPath: null, displayLabel: 'F', description: null, fieldType: 'text', required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' }, ...over });

describe('page targets', () => {
  it('exposes forms/users/facilities/patients/orders', () => {
    expect(PAGE_TARGETS.map((p) => p.id)).toEqual(['forms', 'users', 'facilities', 'patients', 'orders']);
    expect(getPageTarget('users')?.requiredKeys).toContain('email');
    expect(getPageTarget('patients')?.requiredKeys).toEqual(['firstName', 'lastName', 'dateOfBirth', 'sex']);
    expect(getPageTarget('orders')?.requiredKeys).toEqual(['patient', 'tests']);
  });
  it('reports missing required keys for a target page', () => {
    const violations = validateTemplateTargets(['facilities'], [field({ apiProperty: undefined })]);
    expect(violations[0]).toMatchObject({ pageId: 'facilities', missing: ['name'] });
  });
  it('passes when an enabled field supplies the key', () => {
    expect(validateTemplateTargets(['facilities'], [field({ apiProperty: 'name' })])).toEqual([]);
  });
});
