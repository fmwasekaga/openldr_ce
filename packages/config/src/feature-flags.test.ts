import { describe, it, expect } from 'vitest';
import { FEATURE_FLAGS, getFlagDefinition, parseFlagValue } from './feature-flags';

describe('feature-flags registry', () => {
  it('includes dashboard.raw_sql defaulting to false', () => {
    const def = getFlagDefinition('dashboard.raw_sql');
    expect(def).toBeDefined();
    expect(def?.default).toBe(false);
  });

  it('every flag has stable id/labelKey/descriptionKey', () => {
    for (const f of FEATURE_FLAGS) {
      expect(typeof f.id).toBe('string');
      expect(f.labelKey.length).toBeGreaterThan(0);
      expect(f.descriptionKey.length).toBeGreaterThan(0);
      expect(typeof f.default).toBe('boolean');
    }
  });

  it('parseFlagValue coerces stored strings and falls back to the default', () => {
    expect(parseFlagValue('true', false)).toBe(true);
    expect(parseFlagValue('false', true)).toBe(false);
    expect(parseFlagValue(undefined, true)).toBe(true);
    expect(parseFlagValue(undefined, false)).toBe(false);
    expect(parseFlagValue('garbage', true)).toBe(true);
  });
});
