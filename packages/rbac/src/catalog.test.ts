import { describe, it, expect } from 'vitest';
import { CAPABILITIES, CAPABILITY_KEYS, CAPABILITY_GROUPS } from './catalog';

describe('capability catalog', () => {
  it('includes the data_exposure.manage capability', () => {
    expect(CAPABILITY_KEYS).toContain('data_exposure.manage');
  });

  it('exposes 37 unique capability keys', () => {
    expect(CAPABILITY_KEYS.length).toBe(37);
    expect(new Set(CAPABILITY_KEYS).size).toBe(37);
  });

  it('every capability belongs to a declared group', () => {
    const groupKeys = new Set(CAPABILITY_GROUPS.map((g) => g.key));
    for (const c of CAPABILITIES) expect(groupKeys.has(c.group)).toBe(true);
  });

  it('every capability has a non-empty label and description', () => {
    for (const c of CAPABILITIES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  it('groups partition the catalog with no orphan or duplicate', () => {
    const flat = CAPABILITY_GROUPS.flatMap((g) => g.capabilities.map((c) => c.key));
    expect(flat.sort()).toEqual([...CAPABILITY_KEYS].sort());
  });
});
