import { describe, it, expect } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Content Editor')).toBe('content-editor');
  });
  it('strips unsafe characters and collapses separators', () => {
    expect(slugify('  Lab  Manager!! ')).toBe('lab-manager');
    expect(slugify('a__b--c')).toBe('a-b-c');
  });
  it('returns empty string for all-unsafe input', () => {
    expect(slugify('!!!')).toBe('');
  });
});
