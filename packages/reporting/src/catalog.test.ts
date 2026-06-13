import { describe, it, expect } from 'vitest';
import { reportCatalog, getReport, reportSummaries } from './catalog';

describe('catalog', () => {
  it('exposes the four reports', () => {
    expect(reportCatalog().map((r) => r.id).sort()).toEqual(['amr-resistance', 'patient-demographics', 'test-volume', 'turnaround-time']);
  });
  it('getReport finds and misses', () => {
    expect(getReport('amr-resistance')?.name).toBe('AMR Resistance Rate');
    expect(getReport('nope')).toBeUndefined();
  });
  it('amr params reject wrong-typed input but accept empty', () => {
    expect(getReport('amr-resistance')!.params.safeParse({}).success).toBe(true);
    expect(getReport('amr-resistance')!.params.safeParse({ from: 5 }).success).toBe(false);
  });
  it('reportSummaries returns id+name+description', () => {
    expect(reportSummaries()[0]).toHaveProperty('description');
  });
});
