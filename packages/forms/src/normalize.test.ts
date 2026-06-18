import { describe, expect, it } from 'vitest';
import { normalizeFormSchema } from './normalize';

describe('normalizeFormSchema', () => {
  it('fills required form defaults for legacy partial objects', () => {
    const form = normalizeFormSchema({ id: 'legacy-form', name: 'Legacy form' });

    expect(form).toEqual({
      id: 'legacy-form',
      name: 'Legacy form',
      title: { en: 'Legacy form' },
      status: 'draft',
      languages: ['en'],
      sections: [],
    });
  });

  it('normalizes partial sections and fields while preserving simple visibility and builder metadata', () => {
    const form = normalizeFormSchema({
      id: 'f',
      name: 'F',
      sections: [
        {
          id: 's',
          fields: [
            {
              id: 'needs-followup',
              type: 'choice',
              label: { en: 'Needs follow up?' },
              visibility: { whenField: 'category', equals: 'lab' },
              placeholder: { en: 'Choose one' },
              valueSetBinding: { url: 'urn:test:followup', strength: 'preferred' },
            },
          ],
        },
      ],
    });

    expect(form.sections[0]).toMatchObject({ id: 's', title: { en: 's' } });
    expect(form.sections[0]?.fields[0]).toMatchObject({
      id: 'needs-followup',
      type: 'choice',
      label: { en: 'Needs follow up?' },
      visibility: { whenField: 'category', equals: 'lab' },
      placeholder: { en: 'Choose one' },
      valueSetBinding: { url: 'urn:test:followup', strength: 'preferred' },
    });
  });

  it('fails loudly when normalized content is still invalid', () => {
    expect(() => normalizeFormSchema({ id: 'f', name: 'F', sections: [{ id: 's', fields: [{ id: 'q', type: 'not-a-type' }] }] })).toThrow();
  });
});
