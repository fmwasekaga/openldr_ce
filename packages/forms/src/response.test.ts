import { describe, it, expect } from 'vitest';
import { buildResponse, parseResponse } from './response';
import type { FormSchema } from './schema/form-schema';

const form: FormSchema = {
  id: 'f', name: 'f', title: { en: 'F' }, status: 'active', languages: ['en'],
  sections: [
    {
      id: 'demographics', title: { en: 'Demographics' }, resourceType: 'Patient',
      fields: [
        { id: 'given', type: 'string', label: { en: 'Given' }, fhirPath: 'name.0.given.0' },
        { id: 'sex', type: 'choice', label: { en: 'Sex' }, fhirPath: 'gender', options: [{ code: 'female', display: { en: 'Female' } }] },
      ],
    },
  ],
};

describe('build/parse QuestionnaireResponse', () => {
  it('round-trips answers', () => {
    const answers = { given: 'Jane', sex: { code: 'female' } };
    const qr = buildResponse(form, answers, { status: 'completed' });
    expect(qr.resourceType).toBe('QuestionnaireResponse');
    const parsed = parseResponse(qr);
    expect(parsed.given).toBe('Jane');
    expect(parsed.sex).toMatchObject({ code: 'female' });
  });
});
