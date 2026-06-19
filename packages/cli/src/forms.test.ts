import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { runFormsExtract } from './forms';

const fixture = (name: string) => fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));

describe('runFormsExtract', () => {
  it('extracts clinical resources from the sample form + response into a transaction bundle', () => {
    // The new model extracts domain resources (Observation/ServiceRequest) via the
    // ported extractors; entity records (Patient/facility/user) are created by the
    // page-target Save handlers, not by FHIR extraction.
    const out = runFormsExtract(fixture('sample-questionnaire.json'), fixture('sample-response.json'), { subject: { reference: 'Patient/1' } });
    expect(out.invalidCount).toBe(0);
    expect(out.resourceTypes).toContain('ServiceRequest');
    expect((out.bundle as { type: string }).type).toBe('transaction');
  });
});
