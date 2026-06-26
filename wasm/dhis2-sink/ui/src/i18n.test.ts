import { createMockOpenldr } from '@openldr/plugin-ui-sdk';
import { bundles, resetLocale, t } from './i18n';

describe('dhis2-sink i18n', () => {
  it('fr and pt have exactly the same key set as en', () => {
    const enKeys = Object.keys(bundles.en).sort();
    for (const locale of ['fr', 'pt'] as const) {
      const keys = Object.keys(bundles[locale]).sort();
      // Missing keys (in en, not in this locale) + extra keys (in this locale, not en).
      const missing = enKeys.filter((k) => !(k in bundles[locale]));
      const extra = keys.filter((k) => !(k in bundles.en));
      expect({ locale, missing, extra }).toEqual({ locale, missing: [], extra: [] });
      expect(keys).toEqual(enKeys);
    }
  });

  it('t() falls back to en for an unknown locale', () => {
    resetLocale();
    (window as unknown as { openldr: unknown }).openldr = createMockOpenldr({
      pluginId: 'dhis2-sink',
      locale: 'zz', // not en/fr/pt → resolves to en
    });
    expect(t('dashboard.title')).toBe(bundles.en['dashboard.title']);
    expect(t('mappings.run')).toBe(bundles.en['mappings.run']);
    resetLocale();
  });

  it('t() resolves the active locale and falls back to en for a missing key', () => {
    resetLocale();
    (window as unknown as { openldr: unknown }).openldr = createMockOpenldr({
      pluginId: 'dhis2-sink',
      locale: 'fr',
    });
    expect(t('mappings.run')).toBe(bundles.fr['mappings.run']);
    // Unknown key → returns the key itself (after the en fallback misses).
    expect(t('does.not.exist')).toBe('does.not.exist');
    resetLocale();
  });

  it('t() interpolates {name}-style placeholders', () => {
    resetLocale();
    (window as unknown as { openldr: unknown }).openldr = createMockOpenldr({
      pluginId: 'dhis2-sink',
      locale: 'en',
    });
    expect(t('mappings.deletedToast', { name: 'AMR agg' })).toBe('Deleted AMR agg');
    resetLocale();
  });
});
