import { describe, it, expect } from 'vitest';
import { combineCycleResults } from './cycle-result';
import type { CycleResult } from './cycle-result';

const r = (outcome: CycleResult['outcome'], applied = 0): CycleResult => ({ outcome, applied });

describe('combineCycleResults', () => {
  it('progressed wins over everything — there may be more work', () => {
    expect(combineCycleResults(r('progressed'), r('failed')).outcome).toBe('progressed');
    expect(combineCycleResults(r('failed'), r('progressed')).outcome).toBe('progressed');
    expect(combineCycleResults(r('progressed'), r('drained')).outcome).toBe('progressed');
    expect(combineCycleResults(r('drained'), r('progressed')).outcome).toBe('progressed');
    expect(combineCycleResults(r('progressed'), r('progressed')).outcome).toBe('progressed');
  });

  it('failed beats drained — one sick stream must not read as caught up', () => {
    expect(combineCycleResults(r('failed'), r('drained')).outcome).toBe('failed');
    expect(combineCycleResults(r('drained'), r('failed')).outcome).toBe('failed');
    expect(combineCycleResults(r('failed'), r('failed')).outcome).toBe('failed');
  });

  it('drained only when both drained', () => {
    expect(combineCycleResults(r('drained'), r('drained')).outcome).toBe('drained');
  });

  it('sums applied across both streams', () => {
    expect(combineCycleResults(r('progressed', 3), r('progressed', 4)).applied).toBe(7);
    expect(combineCycleResults(r('failed', 0), r('drained', 0)).applied).toBe(0);
  });
});
