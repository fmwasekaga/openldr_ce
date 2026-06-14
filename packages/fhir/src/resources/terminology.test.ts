import { describe, it, expect } from 'vitest';
import { validateResource } from '../validate';

describe('terminology resources', () => {
  it('validates a CodeSystem', () => {
    const r = validateResource({ resourceType: 'CodeSystem', url: 'http://x/cs', status: 'active', content: 'complete', concept: [{ code: 'a', display: 'A' }] });
    expect(r.ok).toBe(true);
  });
  it('validates a ValueSet with compose + expansion', () => {
    const r = validateResource({ resourceType: 'ValueSet', url: 'http://x/vs', status: 'active', compose: { include: [{ system: 'http://x/cs', concept: [{ code: 'a' }] }] } });
    expect(r.ok).toBe(true);
  });
  it('validates a ConceptMap', () => {
    const r = validateResource({ resourceType: 'ConceptMap', url: 'http://x/cm', status: 'active', group: [{ source: 'http://x/cs', target: 'http://loinc.org', element: [{ code: 'a', target: [{ code: '1', equivalence: 'equivalent' }] }] }] });
    expect(r.ok).toBe(true);
  });
  it('rejects a CodeSystem missing status', () => {
    expect(validateResource({ resourceType: 'CodeSystem', url: 'http://x/cs', content: 'complete' }).ok).toBe(false);
  });
});
