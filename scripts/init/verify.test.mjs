import { describe, it, expect } from 'vitest';
import { healthUrl, isHealthy } from './verify.mjs';

describe('verify helpers', () => {
  it('builds the gateway health url', () => {
    expect(healthUrl('https://lab.example.org', 443)).toBe('https://lab.example.org/health');
    expect(healthUrl('https://192.168.1.20:8443', 8443)).toBe('https://192.168.1.20:8443/health');
  });
  it('treats non-"down" status as healthy', () => {
    expect(isHealthy({ status: 'up' })).toBe(true);
    expect(isHealthy({ status: 'degraded' })).toBe(true);
    expect(isHealthy({ status: 'down' })).toBe(false);
    expect(isHealthy(null)).toBe(false);
    expect(isHealthy({})).toBe(false);
  });
});
