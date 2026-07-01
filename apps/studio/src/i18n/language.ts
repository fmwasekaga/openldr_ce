import i18n from './index';

export const STORAGE_KEY = 'openldr.lang';
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'pt', label: 'Português' },
] as const;
export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

function isSupported(v: string | null): v is LanguageCode {
  return v === 'en' || v === 'fr' || v === 'pt';
}

export function getStoredLanguage(): LanguageCode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isSupported(v) ? v : 'en';
  } catch { return 'en'; }
}

export async function setLanguage(code: LanguageCode): Promise<void> {
  try { localStorage.setItem(STORAGE_KEY, code); } catch { /* ignore */ }
  await i18n.changeLanguage(code);
}
