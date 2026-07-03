import { describe, expect, it } from 'vitest';
import { NUMBER_SETTINGS, getNumberSettingDefinition, parseNumberSetting } from './number-settings';

describe('number settings registry', () => {
  it('every entry has i18n keys and a default within [min,max]', () => {
    for (const s of NUMBER_SETTINGS) {
      expect(s.labelKey.length).toBeGreaterThan(0);
      expect(s.descriptionKey.length).toBeGreaterThan(0);
      expect(s.min).toBeLessThanOrEqual(s.default);
      expect(s.default).toBeLessThanOrEqual(s.max);
    }
  });

  it('parse falls back to default for missing/invalid values', () => {
    const def = getNumberSettingDefinition('dashboard.sql_timeout_ms')!;
    expect(parseNumberSetting(null, def)).toBe(def.default);
    expect(parseNumberSetting('', def)).toBe(def.default);
    expect(parseNumberSetting('not-a-number', def)).toBe(def.default);
  });

  it('parse clamps into [min,max]', () => {
    const def = getNumberSettingDefinition('dashboard.sql_row_cap')!;
    expect(parseNumberSetting('0', def)).toBe(def.min);
    expect(parseNumberSetting(String(def.max + 999), def)).toBe(def.max);
    expect(parseNumberSetting('500', def)).toBe(500);
  });
});
