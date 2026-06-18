import { describe, expect, it } from 'vitest';
import { computeVisibility } from './visibility';
import type { FormSchema } from './schema/form-schema';

const form: FormSchema = {
  id: 'f',
  name: 'f',
  title: { en: 'F' },
  status: 'active',
  languages: ['en'],
  sections: [
    {
      id: 's',
      title: { en: 'S' },
      fields: [
        { id: 'sex', type: 'choice', label: { en: 'Sex' }, options: [{ code: 'female', display: { en: 'Female' } }, { code: 'male', display: { en: 'Male' } }] },
        { id: 'pregnant', type: 'boolean', label: { en: 'Pregnant' }, visibility: { whenField: 'sex', equals: 'female' } },
        { id: 'age', type: 'integer', label: { en: 'Age' } },
      ],
    },
  ],
};

describe('computeVisibility', () => {
  it('keeps fields without visibility rules visible', () => {
    expect(computeVisibility(form, {}).get('age')).toBe(true);
  });

  it('hides and shows fields with simple visibility rules', () => {
    expect(computeVisibility(form, { sex: { code: 'male' } }).get('pregnant')).toBe(false);
    expect(computeVisibility(form, { sex: { code: 'female' } }).get('pregnant')).toBe(true);
  });
});
