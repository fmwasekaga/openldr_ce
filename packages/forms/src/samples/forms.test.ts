import { describe, expect, it } from 'vitest';
import { sampleForms } from './forms';
import { FormSchema } from '../schema/form-schema';
import { toQuestionnaire } from '../to-questionnaire';

describe('sample forms', () => {
  it('parse against the schema and export to Questionnaire', () => {
    expect(sampleForms.length).toBeGreaterThanOrEqual(2);
    for (const form of sampleForms) {
      const parsed = FormSchema.parse(form);
      const q = toQuestionnaire(parsed);
      expect(q.resourceType).toBe('Questionnaire');
    }
  });
  it('includes a Facility (Location) form targeting facilities', () => {
    const facility = sampleForms.find((f) => f.fhirResourceType === 'Location');
    expect(facility?.targetPages).toContain('facilities');
    expect(facility?.fields.some((x) => x.apiProperty === 'name')).toBe(true);
  });
});
