import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { runFhirValidate } from './fhir';

const fixture = (name: string) => fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));

describe('runFhirValidate', () => {
  it('passes a valid Patient file', () => {
    const out = runFhirValidate(fixture('valid-patient.json'));
    expect(out.allValid).toBe(true);
    expect(out.results[0].valid).toBe(true);
  });
  it('fails an Observation missing status', () => {
    const out = runFhirValidate(fixture('invalid-observation.json'));
    expect(out.allValid).toBe(false);
    expect(out.results[0].valid).toBe(false);
    expect(out.results[0].outcome).toBeDefined();
  });
  it('validates the Bundle envelope and each entry, flagging the bad one', () => {
    const out = runFhirValidate(fixture('bundle-mixed.json'));
    expect(out.allValid).toBe(false);
    const labels = out.results.map((r) => r.label);
    expect(labels).toContain('Bundle'); // envelope row
    expect(labels).toContain('entry[1]');
    const bad = out.results.filter((r) => !r.valid);
    expect(bad).toHaveLength(1);
    expect(bad[0].label).toBe('entry[1]');
  });
});
