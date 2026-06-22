import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en';
import { fr } from './fr';
import { pt } from './pt';

/** Read the persisted language at init time — inlined to avoid a circular import with language.ts. */
function _initLng(): string {
  try {
    const v = localStorage.getItem('openldr.lang');
    if (v === 'en' || v === 'fr' || v === 'pt') return v;
  } catch { /* ignore */ }
  return 'en';
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fr: { translation: fr }, pt: { translation: pt } },
  lng: _initLng(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
