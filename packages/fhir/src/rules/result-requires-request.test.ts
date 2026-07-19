import { describe, it, expect } from 'vitest';
import { resultRequiresRequest } from './result-requires-request';
import type { RuleContext } from './types';
import type { FhirResource } from '../validate';

const labObs = (extra: Record<string, unknown> = {}): FhirResource => ({
  resourceType: 'Observation', id: 'o1', status: 'final',
  category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
  code: { text: 'Hb' }, subject: { reference: 'Patient/p1' }, ...extra,
});
const ctx = (level: RuleContext['level'], batch: FhirResource[] = [], exists = false): RuleContext => ({
  level, batch, resolveServiceRequest: async () => exists,
});

describe('resultRequiresRequest', () => {
  it('applies to laboratory Observation and LAB DiagnosticReport only', () => {
    expect(resultRequiresRequest.appliesTo(labObs())).toBe(true);
    expect(resultRequiresRequest.appliesTo({ resourceType: 'QuestionnaireResponse', id: 'q' } as FhirResource)).toBe(false);
    expect(resultRequiresRequest.appliesTo({ resourceType: 'Observation', id: 'v', status: 'final',
      category: [{ coding: [{ code: 'vital-signs' }] }], code: {} } as FhirResource)).toBe(false);
    expect(resultRequiresRequest.appliesTo({ resourceType: 'DiagnosticReport', id: 'd', status: 'final',
      category: [{ coding: [{ code: 'LAB' }] }], code: {} } as FhirResource)).toBe(true);
  });

  it('medium: flags a missing basedOn', async () => {
    expect(await resultRequiresRequest.check(labObs(), ctx('medium'))).toHaveLength(1);
    expect(await resultRequiresRequest.check(labObs({ basedOn: [{ reference: 'ServiceRequest/sr1' }] }), ctx('medium'))).toHaveLength(0);
  });

  it('high: a basedOn that resolves nowhere is flagged; in-batch or in-store resolves', async () => {
    const obs = labObs({ basedOn: [{ reference: 'ServiceRequest/sr1' }] });
    expect(await resultRequiresRequest.check(obs, ctx('high'))).toHaveLength(1);            // dangling
    const sr: FhirResource = { resourceType: 'ServiceRequest', id: 'sr1', status: 'active' } as FhirResource;
    expect(await resultRequiresRequest.check(obs, ctx('high', [sr]))).toHaveLength(0);       // in batch
    expect(await resultRequiresRequest.check(obs, ctx('high', [], true))).toHaveLength(0);    // in store
  });
});
