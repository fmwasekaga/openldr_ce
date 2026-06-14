import { describe, it, expect } from 'vitest';
import { makeResolver } from './screenshots';

const resolve = makeResolver({ 'dashboard.png': '/assets/dashboard.abc.png' });

describe('screenshot resolver', () => {
  it('maps a bare basename to its bundled url', () => {
    expect(resolve('dashboard.png')).toBe('/assets/dashboard.abc.png');
  });
  it('returns null for an unknown basename', () => {
    expect(resolve('missing.png')).toBeNull();
  });
  it('passes through absolute and http(s) sources', () => {
    expect(resolve('https://example.org/x.png')).toBe('https://example.org/x.png');
    expect(resolve('/already/abs.png')).toBe('/already/abs.png');
  });
});
