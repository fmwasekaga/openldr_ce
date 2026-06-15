import { describe, it, expect } from 'vitest';
import { fhirValueSetToInput, valueSetToFhirResource } from './fhirValueSet';

describe('fhirValueSet', () => {
  it('maps a FHIR ValueSet resource to input', () => {
    const input = fhirValueSetToInput({
      resourceType: 'ValueSet', url: 'urn:test:vs', status: 'active', title: 'T',
      compose: { include: [{ system: 's1', concept: [{ code: 'A', display: 'Alpha' }] }] },
    });
    expect(input.url).toBe('urn:test:vs');
    expect(input.status).toBe('active');
    expect(input.compose.include?.[0]?.concept?.[0]?.code).toBe('A');
  });

  it('rejects a non-ValueSet resource', () => {
    expect(() => fhirValueSetToInput({ resourceType: 'CodeSystem' })).toThrow();
  });

  it('rejects a ValueSet without url', () => {
    expect(() => fhirValueSetToInput({ resourceType: 'ValueSet', status: 'active' })).toThrow();
  });

  it('builds compose from expansion.contains when compose is absent', () => {
    const input = fhirValueSetToInput({
      resourceType: 'ValueSet', url: 'urn:test:vs2', status: 'active',
      expansion: { contains: [{ system: 's1', code: 'A', display: 'Alpha' }, { system: 's1', code: 'B' }] },
    });
    expect(input.compose.include).toHaveLength(1);
    expect(input.compose.include?.[0]?.concept).toHaveLength(2);
  });

  it('emits a FHIR resource with an expansion block', () => {
    const res = valueSetToFhirResource(
      { id: 'vs-1', url: 'urn:test:vs', status: 'active', experimental: false, version: null, name: null, title: 'T', description: null, compose: { include: [{ system: 's1' }] } },
      [{ system: 's1', code: 'A', display: 'Alpha' }],
    );
    expect(res.resourceType).toBe('ValueSet');
    expect((res.expansion as { total: number }).total).toBe(1);
  });
});
