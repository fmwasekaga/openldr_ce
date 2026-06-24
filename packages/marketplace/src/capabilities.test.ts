import { describe, it, expect } from 'vitest';
import { capabilitySchema, parseCapabilities } from './capabilities';

describe('capabilities', () => {
  it('accepts each capability kind with its params', () => {
    expect(capabilitySchema.parse({ kind: 'read-input', formats: ['hl7v2'] })).toEqual({ kind: 'read-input', formats: ['hl7v2'] });
    expect(capabilitySchema.parse({ kind: 'emit-fhir', resourceTypes: ['Observation'] }).kind).toBe('emit-fhir');
    expect(capabilitySchema.parse({ kind: 'net-egress', allowedHosts: ['example.org:443'] }).kind).toBe('net-egress');
    expect(capabilitySchema.parse({ kind: 'data-scope', resourceTypes: ['Patient'], fields: ['name'] }).kind).toBe('data-scope');
  });
  it('defaults optional arrays', () => {
    expect(capabilitySchema.parse({ kind: 'read-input' })).toEqual({ kind: 'read-input', formats: [] });
    expect(capabilitySchema.parse({ kind: 'net-egress' })).toEqual({ kind: 'net-egress', allowedHosts: [] });
  });
  it('rejects an unknown kind', () => {
    expect(() => capabilitySchema.parse({ kind: 'filesystem' })).toThrow();
  });
  it('emit-fhir requires at least one resourceType', () => {
    expect(() => capabilitySchema.parse({ kind: 'emit-fhir', resourceTypes: [] })).toThrow();
  });
  it('parseCapabilities validates an array', () => {
    expect(parseCapabilities([{ kind: 'read-input' }])).toHaveLength(1);
    expect(() => parseCapabilities([{ kind: 'bad' }])).toThrow();
  });
});

describe('host-service capabilities', () => {
  it('parses host:reports, host:connectors, host:schedule presence gates', () => {
    const caps = parseCapabilities([
      { kind: 'host:reports' },
      { kind: 'host:connectors' },
      { kind: 'host:schedule' },
    ]);
    expect(caps.map((c) => c.kind)).toEqual(['host:reports', 'host:connectors', 'host:schedule']);
  });

  it('still rejects an unknown capability kind', () => {
    expect(() => parseCapabilities([{ kind: 'host:bogus' }])).toThrow();
  });
});
