import { describe, expect, it } from 'vitest';
import type { Questionnaire } from 'fhir/r4';

describe('fhir/r4 types', () => {
  it('is importable as a plain object shape', () => {
    const q: Questionnaire = { resourceType: 'Questionnaire', status: 'active' };
    expect(q.resourceType).toBe('Questionnaire');
  });
});
