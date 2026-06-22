import { describe, it, expect } from 'vitest';
import { en } from './en';

/** Recursively collect dotted key paths from a nested resource object. */
function keyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object' && !Array.isArray(v) ? keyPaths(v as Record<string, unknown>, path) : [path];
  });
}

const enKeys = keyPaths(en).sort();

describe('i18n key parity', () => {
  it('en has a non-trivial key set', () => {
    expect(enKeys.length).toBeGreaterThan(100);
  });
  // fr/pt assertions are added in Tasks 4 and 5 once those bundles exist:
  //   it('fr matches en', () => expect(keyPaths(fr).sort()).toEqual(enKeys));
  //   it('pt matches en', () => expect(keyPaths(pt).sort()).toEqual(enKeys));
});
