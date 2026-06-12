import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { runFormsExtract } from './forms';

const fixture = (name: string) => fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));

describe('runFormsExtract', () => {
  it('extracts a valid Patient from the sample form + response', () => {
    const out = runFormsExtract(fixture('sample-questionnaire.json'), fixture('sample-response.json'), { subject: { reference: 'Patient/1' } });
    expect(out.invalidCount).toBe(0);
    expect(out.resourceTypes).toContain('Patient');
    expect((out.bundle as { type: string }).type).toBe('transaction');
  });
});
