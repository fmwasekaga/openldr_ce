import { describe, it, expect } from 'vitest';
import { toQuestionnaire } from '../to-questionnaire';
import { buildResponse } from '../response';
import { extractResources } from './extract';
import type { FormSchema } from '../schema/form-schema';

const form: FormSchema = {
  id: 'intake', name: 'intake', title: { en: 'Intake' }, status: 'active', languages: ['en'],
  sections: [
    {
      id: 'demographics', title: { en: 'Demographics' }, resourceType: 'Patient',
      fields: [
        { id: 'given', type: 'string', label: { en: 'Given' }, fhirPath: 'name.0.given.0' },
        { id: 'sex', type: 'choice', label: { en: 'Sex' }, fhirPath: 'gender', options: [{ code: 'female', display: { en: 'Female' } }] },
        { id: 'temp', type: 'decimal', label: { en: 'Temp' }, observationExtract: true, code: { code: '8310-5', system: 'http://loinc.org' }, unit: 'Cel' },
      ],
    },
  ],
};

describe('extractResources', () => {
  it('extracts a valid Patient and an Observation', () => {
    const q = toQuestionnaire(form);
    const qr = buildResponse(form, { given: 'Jane', sex: { code: 'female' }, temp: 38.5 }, { status: 'completed' });
    const { resources, invalid } = extractResources(qr, q, { subject: { reference: 'Patient/1' } });
    expect(invalid).toHaveLength(0);
    const patient = resources.find((r) => r.resourceType === 'Patient') as Record<string, unknown>;
    expect(patient).toBeDefined();
    expect(patient.gender).toBe('female');
    expect((patient.name as Array<{ given: string[] }>)[0].given[0]).toBe('Jane');
    const obs = resources.find((r) => r.resourceType === 'Observation') as Record<string, unknown>;
    expect(obs).toBeDefined();
    expect((obs.valueQuantity as { value: number }).value).toBe(38.5);
  });

  it('does not extract fields from a hidden section', () => {
    const sectionForm: FormSchema = {
      ...form,
      sections: [
        {
          ...form.sections[0],
          visibility: { whenField: 'show-demographics', equals: true },
          fields: [
            { id: 'show-demographics', type: 'boolean', label: { en: 'Show demographics' } },
            ...form.sections[0].fields,
          ],
        },
      ],
    };
    const q = toQuestionnaire(sectionForm);
    const qr = buildResponse(sectionForm, { 'show-demographics': false, given: 'Jane', sex: { code: 'female' }, temp: 38.5 }, { status: 'completed' });
    const { resources } = extractResources(qr, q, { subject: { reference: 'Patient/1' } });

    const patient = resources.find((r) => r.resourceType === 'Patient') as Record<string, unknown>;
    expect(patient?.gender).toBeUndefined();
    expect(patient?.name).toBeUndefined();
    expect(resources.some((r) => r.resourceType === 'Observation')).toBe(false);
  });
});
