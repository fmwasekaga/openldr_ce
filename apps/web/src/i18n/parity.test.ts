import { describe, it, expect } from 'vitest';
import { en } from './en';
import { fr } from './fr';

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
  it('fr matches en exactly', () => {
    expect(keyPaths(fr as Record<string, unknown>).sort()).toEqual(enKeys);
  });
  // pt assertion added in Task 5:
  //   it('pt matches en exactly', () => { expect(keyPaths(pt as Record<string, unknown>).sort()).toEqual(enKeys); });
});
