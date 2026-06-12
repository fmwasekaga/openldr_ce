import { describe, it, expect } from 'vitest';
import { sampleForms } from './forms';
import { toQuestionnaire } from '../to-questionnaire';
import { fromQuestionnaire } from '../from-questionnaire';
import { FormSchema } from '../schema/form-schema';

describe('sample forms', () => {
  it('every sample passes FormSchema validation', () => {
    for (const f of sampleForms()) {
      expect(FormSchema.safeParse(f).success).toBe(true);
    }
  });
  it('every sample round-trips losslessly through a Questionnaire', () => {
    for (const f of sampleForms()) {
      expect(fromQuestionnaire(toQuestionnaire(f))).toEqual(f);
    }
  });
});
