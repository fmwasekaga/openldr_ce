import { describe, expect, it } from 'vitest';
import { amrIsolates } from './amr-isolates';

describe('amr-isolates event source', () => {
  it('declares its output columns', () => {
    expect(amrIsolates.columns.map((c) => c.key)).toEqual(['id', 'facility', 'eventDate', 'antibiotic', 'result']);
    expect(amrIsolates.columns.every((c) => typeof c.label === 'string' && c.label.length > 0)).toBe(true);
  });
});
