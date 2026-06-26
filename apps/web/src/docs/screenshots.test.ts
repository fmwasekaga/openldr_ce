import { describe, it, expect } from 'vitest';
import { makeResolver } from './screenshots';
import screenshotManifest from './0.1.0/screenshot-manifest.json';

const manifest = screenshotManifest as { shots: Array<{ name: string }> };
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

  it('keeps manifest outputs as unique PNG basenames', () => {
    const names = manifest.shots.map((shot) => shot.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[^/\\]+\.png$/);
    }
  });
});
