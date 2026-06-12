import { describe, it, expect } from 'vitest';
import { toQuestionnaire } from './to-questionnaire';
import { fromQuestionnaire } from './from-questionnaire';
import type { FormSchema } from './schema/form-schema';

const form: FormSchema = {
  id: 'intake', name: 'intake', title: { en: 'Intake', fr: 'Admission' }, status: 'active', languages: ['en', 'fr'],
  sections: [
    {
      id: 'demographics', title: { en: 'Demographics' }, resourceType: 'Patient',
      fields: [
        { id: 'given', type: 'string', label: { en: 'Given name' }, required: true, fhirPath: 'name.0.given.0' },
        { id: 'sex', type: 'choice', label: { en: 'Sex' }, fhirPath: 'gender', options: [{ code: 'female', display: { en: 'Female' } }, { code: 'male', display: { en: 'Male' } }] },
        { id: 'pregnant', type: 'boolean', label: { en: 'Pregnant?' }, visibility: { whenField: 'sex', equals: 'female' }, observationExtract: true, code: { code: '82810-3', system: 'http://loinc.org' } },
      ],
    },
  ],
};

describe('FormSchema <-> Questionnaire', () => {
  it('produces a valid Questionnaire shape', () => {
    const q = toQuestionnaire(form);
    expect(q.resourceType).toBe('Questionnaire');
    expect(q.item?.length).toBe(1);
    expect((q.item?.[0] as { type: string }).type).toBe('group');
  });
  it('round-trips losslessly', () => {
    expect(fromQuestionnaire(toQuestionnaire(form))).toEqual(form);
  });
});
