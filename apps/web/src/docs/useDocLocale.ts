import { useEffect, useState } from 'react';
import type { Locale } from './registry';

const KEY = 'openldr-docs-locale';

function stored(): Locale {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'en' || v === 'fr' || v === 'pt') return v;
  } catch {
    // localStorage may be unavailable
  }
  return 'en';
}

export function useDocLocale(): [Locale, (l: Locale) => void] {
  const [locale, setLocale] = useState<Locale>(stored);
  useEffect(() => {
    try { localStorage.setItem(KEY, locale); } catch { /* ignore */ }
  }, [locale]);
  return [locale, setLocale];
}
