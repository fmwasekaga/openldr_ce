import { describe, it, expect } from 'vitest';
import { listModels, getModel } from './registry';

describe('model registry', () => {
  it('exposes service_requests with count metric and date dimension', () => {
    const m = getModel('service_requests');
    expect(m).toBeDefined();
    expect(m!.metrics.some((x) => x.agg === 'count')).toBe(true);
    const authored = m!.dimensions.find((d) => d.key === 'authored_on');
    expect(authored?.kind).toBe('date');
    expect(authored?.dateGrain).toContain('month');
  });
  it('every dimension key is unique per model', () => {
    for (const m of listModels()) {
      const cols = m.dimensions.map((d) => d.key);
      expect(new Set(cols).size).toBe(cols.length);
    }
  });
});
