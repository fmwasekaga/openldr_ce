import { describe, it, expect } from 'vitest';
import { FormField, FormSchema } from './form-schema';

describe('FormSchema model', () => {
  it('accepts a minimal valid form', () => {
    const r = FormSchema.safeParse({
      id: 'f', name: 'f', title: { en: 'F' }, status: 'active', languages: ['en'],
      sections: [{ id: 's', title: { en: 'S' }, fields: [{ id: 'q', type: 'string', label: { en: 'Q' } }] }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects a choice field without options', () => {
    const r = FormField.safeParse({ id: 'q', type: 'choice', label: { en: 'Q' } });
    expect(r.success).toBe(false);
  });
  it('rejects an observationExtract field without code', () => {
    const r = FormField.safeParse({ id: 'q', type: 'integer', label: { en: 'Q' }, observationExtract: true });
    expect(r.success).toBe(false);
  });
});
