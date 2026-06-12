import { describe, it, expect } from 'vitest';
import type { AggregatedHealth } from '@openldr/core';
import { formatHealthTable, exitCodeFor } from './format';

const sample: AggregatedHealth = {
  status: 'down',
  checks: {
    auth: { status: 'up', latencyMs: 12 },
    blob: { status: 'down', latencyMs: 5, detail: 'NoSuchBucket' },
  },
};

describe('formatHealthTable', () => {
  it('renders one row per check with status and latency', () => {
    const text = formatHealthTable(sample);
    expect(text).toContain('auth');
    expect(text).toContain('up');
    expect(text).toContain('blob');
    expect(text).toContain('down');
    expect(text).toContain('NoSuchBucket');
  });
});

describe('exitCodeFor', () => {
  it('is 0 when overall up', () => {
    expect(exitCodeFor({ status: 'up', checks: {} })).toBe(0);
  });
  it('is 1 when overall down', () => {
    expect(exitCodeFor(sample)).toBe(1);
  });
});
