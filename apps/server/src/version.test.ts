import { describe, it, expect, afterEach } from 'vitest';
import { readAppVersion } from './version';

describe('readAppVersion', () => {
  afterEach(() => { delete process.env.APP_VERSION; });

  it('prefers the APP_VERSION env override', () => {
    process.env.APP_VERSION = '9.9.9-test';
    expect(readAppVersion()).toBe('9.9.9-test');
  });

  it('falls back to the repo package.json version (semver-ish string)', () => {
    delete process.env.APP_VERSION;
    expect(readAppVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
