import { describe, it, expect } from 'vitest';
import { resolveText, deriveLanguages } from './i18n';

describe('i18n', () => {
  it('resolves the requested language, falls back to en', () => {
    expect(resolveText({ en: 'Hello', fr: 'Bonjour' }, 'fr')).toBe('Bonjour');
    expect(resolveText({ en: 'Hello' }, 'pt')).toBe('Hello');
  });
  it('derives languages present anywhere in the form', () => {
    const langs = deriveLanguages({
      id: 'f', name: 'f', title: { en: 'F' }, status: 'active', languages: ['en'],
      sections: [{ id: 's', title: { en: 'S', pt: 'S-pt' }, fields: [{ id: 'q', type: 'string', label: { en: 'Q' } }] }],
    });
    expect(langs.sort()).toEqual(['en', 'pt']);
  });
});
