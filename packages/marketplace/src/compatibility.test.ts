import { describe, it, expect } from 'vitest';
import { isCompatible } from './compatibility';

describe('isCompatible', () => {
  it('wildcard matches anything', () => {
    expect(isCompatible('*', '0.1.0')).toBe(true);
  });
  it('exact match', () => {
    expect(isCompatible('0.1.0', '0.1.0')).toBe(true);
    expect(isCompatible('0.1.0', '0.2.0')).toBe(false);
  });
  it('AND range (space-separated comparators)', () => {
    expect(isCompatible('>=0.1.0 <0.2.0', '0.1.0')).toBe(true);
    expect(isCompatible('>=0.1.0 <0.2.0', '0.1.9')).toBe(true);
    expect(isCompatible('>=0.1.0 <0.2.0', '0.2.0')).toBe(false);
    expect(isCompatible('>=0.1.0 <0.2.0', '0.0.9')).toBe(false);
  });
  it('OR ranges', () => {
    expect(isCompatible('0.1.0 || >=1.0.0', '1.2.3')).toBe(true);
    expect(isCompatible('0.1.0 || >=1.0.0', '0.1.0')).toBe(true);
    expect(isCompatible('0.1.0 || >=1.0.0', '0.5.0')).toBe(false);
  });
});
