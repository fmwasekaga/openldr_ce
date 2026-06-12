import { describe, it, expect } from 'vitest';
import { validateAnswers } from './validate-answers';
import { computeVisibility } from './visibility';
import type { FormSchema } from './schema/form-schema';

const form: FormSchema = {
  id: 'f', name: 'f', title: { en: 'F' }, status: 'active', languages: ['en'],
  sections: [
    {
      id: 's', title: { en: 'S' },
      fields: [
        { id: 'sex', type: 'choice', label: { en: 'Sex' }, options: [{ code: 'female', display: { en: 'F' } }, { code: 'male', display: { en: 'M' } }] },
        { id: 'pregnant', type: 'boolean', label: { en: 'Pregnant' }, required: true, visibility: { whenField: 'sex', equals: 'female' } },
        { id: 'age', type: 'integer', label: { en: 'Age' }, required: true },
      ],
    },
  ],
};

describe('computeVisibility', () => {
  it('hides the dependent field until the controller matches', () => {
    expect(computeVisibility(form, { sex: { code: 'male' } }).get('pregnant')).toBe(false);
    expect(computeVisibility(form, { sex: { code: 'female' } }).get('pregnant')).toBe(true);
  });
});

describe('validateAnswers', () => {
  it('flags a missing required visible field', () => {
    const r = validateAnswers(form, { sex: { code: 'female' } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const exprs = r.outcome.issue.flatMap((i) => i.expression ?? []);
      expect(exprs).toContain('pregnant');
      expect(exprs).toContain('age');
    }
  });
  it('does not flag a hidden required field', () => {
    const r = validateAnswers(form, { sex: { code: 'male' }, age: 30 });
    expect(r.ok).toBe(true);
  });
  it('flags a bad choice value', () => {
    const r = validateAnswers(form, { sex: { code: 'other' }, age: 30 });
    expect(r.ok).toBe(false);
  });
});
