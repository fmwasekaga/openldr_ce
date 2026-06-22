import { describe, it, expect, beforeEach } from 'vitest';
import i18n from './index';
import { getStoredLanguage, setLanguage, SUPPORTED_LANGUAGES, STORAGE_KEY } from './language';

beforeEach(() => { localStorage.clear(); });

describe('language', () => {
  it('lists the supported languages', () => {
    expect(SUPPORTED_LANGUAGES.map((l) => l.code)).toEqual(['en', 'fr', 'pt']);
  });
  it('defaults to en with no/invalid stored value', () => {
    expect(getStoredLanguage()).toBe('en');
    localStorage.setItem(STORAGE_KEY, 'xx');
    expect(getStoredLanguage()).toBe('en');
  });
  it('returns a valid stored value', () => {
    localStorage.setItem(STORAGE_KEY, 'fr');
    expect(getStoredLanguage()).toBe('fr');
  });
  it('setLanguage persists and changes i18n', async () => {
    await setLanguage('pt');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('pt');
    expect(i18n.language).toBe('pt');
  });
});
