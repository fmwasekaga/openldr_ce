import { describe, it, expect } from 'vitest';
import { validateResource, validateBundleEntries } from './validate';

describe('validateResource', () => {
  it('returns ok for a valid resource', () => {
    const r = validateResource({ resourceType: 'Patient', gender: 'male' });
    expect(r.ok).toBe(true);
  });
  it('returns a not-supported outcome for an unknown resourceType', () => {
    const r = validateResource({ resourceType: 'Practitioner' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.outcome.issue[0].code).toBe('not-supported');
  });
  it('returns a structure outcome when resourceType is missing', () => {
    const r = validateResource({ gender: 'male' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.outcome.issue[0].code).toBe('structure');
  });
  it('returns invalid issues naming the bad field', () => {
    const r = validateResource({ resourceType: 'Observation', code: { text: 'x' } }); // missing status
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.outcome.issue.some((i) => i.expression?.includes('status'))).toBe(true);
  });
});

describe('validateBundleEntries', () => {
  it('validates each entry and flags the bad one by index', () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        { resource: { resourceType: 'Patient', id: 'ok' } },
        { resource: { resourceType: 'Observation', code: { text: 'x' } } }, // missing status
      ],
    };
    const results = validateBundleEntries(bundle);
    expect(results).toHaveLength(2);
    expect(results[0].result.ok).toBe(true);
    expect(results[1].result.ok).toBe(false);
    expect(results[1].entry).toBe(1);
  });
});
