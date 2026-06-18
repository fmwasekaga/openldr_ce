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

  it('hides a section and cascades hidden state to its fields', () => {
    const sectionForm: FormSchema = {
      ...form,
      sections: [
        ...form.sections,
        {
          id: 'followup-section',
          title: { en: 'Follow up' },
          visibility: { whenField: 'age', equals: 40 },
          fields: [
            { id: 'followup-note', type: 'string', label: { en: 'Follow up note' } },
            { id: 'followup-confirmed', type: 'boolean', label: { en: 'Confirmed' }, visibility: { whenField: 'sex', equals: 'female' } },
          ],
        },
      ],
    };

    const hidden = computeVisibility(sectionForm, { age: 39, sex: { code: 'female' } });
    expect(hidden.get('followup-section')).toBe(false);
    expect(hidden.get('followup-note')).toBe(false);
    expect(hidden.get('followup-confirmed')).toBe(false);

    const visible = computeVisibility(sectionForm, { age: 40, sex: { code: 'male' } });
    expect(visible.get('followup-section')).toBe(true);
    expect(visible.get('followup-note')).toBe(true);
    expect(visible.get('followup-confirmed')).toBe(false);
  });
});
