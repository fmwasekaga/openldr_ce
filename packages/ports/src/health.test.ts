import { describe, it, expect } from 'vitest';
import { PORT_NAMES } from './health';

describe('PORT_NAMES', () => {
  it('lists the four phase-1 ports', () => {
    expect(PORT_NAMES).toEqual(['auth', 'blob', 'eventing', 'target-store']);
  });
});
