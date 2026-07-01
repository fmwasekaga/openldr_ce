import { describe, it, expect } from 'vitest';
import { formatIpChoices, isValidFqdn } from './host-detect.mjs';

describe('host-detect', () => {
  it('formats non-internal IPv4 interfaces into {name, address} choices', () => {
    const fake = {
      eth0: [{ family: 'IPv4', address: '192.168.1.20', internal: false }],
      lo:   [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      wg0:  [{ family: 'IPv6', address: 'fe80::1', internal: false }],
    };
    expect(formatIpChoices(fake)).toEqual([{ name: 'eth0', address: '192.168.1.20' }]);
  });
  it('validates FQDNs', () => {
    expect(isValidFqdn('lab.example.org')).toBe(true);
    expect(isValidFqdn('localhost')).toBe(true);
    expect(isValidFqdn('bad_host')).toBe(false);
    expect(isValidFqdn('http://x.com')).toBe(false);
  });
});
