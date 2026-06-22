import { describe, it, expect } from 'vitest';
import { readGrant, allowedResourceTypes, allowedHosts } from './grant';

describe('readGrant', () => {
  it('treats a manifest with no capabilities field as legacy (unrestricted)', () => {
    expect(readGrant({ id: 'x', version: '1.0.0' })).toEqual({ legacy: true });
  });
  it('returns capabilities for a marketplace manifest', () => {
    const caps = [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }];
    expect(readGrant({ schemaVersion: 1, capabilities: caps })).toEqual({ legacy: false, capabilities: caps });
  });
  it('an empty capabilities array is a marketplace artifact, not legacy', () => {
    expect(readGrant({ schemaVersion: 1, capabilities: [] })).toEqual({ legacy: false, capabilities: [] });
  });
  it('throws when capabilities is present but a string (corrupt/forged row)', () => {
    expect(() => readGrant({ schemaVersion: 1, capabilities: 'oops' })).toThrow();
  });
  it('throws when capabilities is present but null (corrupt/forged row)', () => {
    expect(() => readGrant({ schemaVersion: 1, capabilities: null })).toThrow();
  });
});

describe('allowedResourceTypes / allowedHosts', () => {
  it('extracts the emit-fhir allowlist', () => {
    expect(allowedResourceTypes([{ kind: 'emit-fhir', resourceTypes: ['Patient', 'Observation'] }])).toEqual(['Patient', 'Observation']);
    expect(allowedResourceTypes([])).toEqual([]);
  });
  it('extracts the net-egress allowlist', () => {
    expect(allowedHosts([{ kind: 'net-egress', allowedHosts: ['ex.org:443'] }])).toEqual(['ex.org:443']);
    expect(allowedHosts([])).toEqual([]);
  });
});
