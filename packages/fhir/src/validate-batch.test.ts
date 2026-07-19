import { describe, it, expect } from 'vitest';
import { validateBatch } from './validate-batch';
import type { StrictnessLevel } from './rules/types';

const patient = { resourceType: 'Patient', id: 'p1' };
const sr = { resourceType: 'ServiceRequest', id: 'sr1', status: 'active', intent: 'order', subject: { reference: 'Patient/p1' } };
const labObs = (basedOn?: unknown) => ({
  resourceType: 'Observation', id: 'o1', status: 'final',
  category: [{ coding: [{ code: 'laboratory' }] }], code: { text: 'Hb' }, subject: { reference: 'Patient/p1' },
  ...(basedOn ? { basedOn } : {}),
});
const run = (resources: unknown[], level: StrictnessLevel, exists = false) =>
  validateBatch(resources, { level, resolveServiceRequest: async () => exists });

describe('validateBatch', () => {
  it('low: structural only — a lab result with no order passes', async () => {
    const r = await run([patient, labObs()], 'low');
    expect(r.ok).toBe(true);
  });
  it('high: a lab result with no order fails with an OperationOutcome', async () => {
    const r = await run([patient, labObs()], 'high');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.outcome.issue.length).toBeGreaterThan(0);
  });
  it('high: result + its order in the same batch passes', async () => {
    const r = await run([patient, sr, labObs([{ reference: 'ServiceRequest/sr1' }])], 'high');
    expect(r.ok).toBe(true);
  });
  it('still rejects structurally invalid resources at any level', async () => {
    const r = await run([{ resourceType: 'Observation' /* missing required fields */ }], 'low');
    expect(r.ok).toBe(false);
  });
  it('aggregates multiple issues into one outcome', async () => {
    const r = await run([labObs(), labObs()], 'medium');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.outcome.issue.length).toBe(2);
  });
  it('skips clinical rules when structural validation fails', async () => {
    // Batch: (a) structurally-invalid Observation, (b) clinically-broken lab result (no basedOn).
    // At 'high' the result-requires-request rule WOULD fire — but structural failure short-circuits it.
    const r = await run([{ resourceType: 'Observation' }, labObs()], 'high');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // The clinical rule emits code 'required' with a basedOn expression — it must be absent.
      const clinical = r.outcome.issue.filter(
        (i) => i.code === 'required' && (i.expression ?? []).some((e) => e.endsWith('.basedOn')),
      );
      expect(clinical).toHaveLength(0);
      // Only structural issues remain (validateResource emits code 'structure' for missing required fields).
      expect(r.outcome.issue.length).toBeGreaterThan(0);
      expect(r.outcome.issue.every((i) => i.code === 'structure')).toBe(true);
    }
  });
});
