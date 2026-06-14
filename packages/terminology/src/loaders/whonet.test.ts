import { describe, it, expect, vi } from 'vitest';

// node:sqlite is a Node 24 built-in not known to Vite 5 — mock it so the
// transform pipeline does not fail when importing the whonet loader module.
vi.mock('node:sqlite', () => ({ DatabaseSync: class {} }));

import { joinForwardReverse } from './whonet';

describe('joinForwardReverse', () => {
  it('joins forward+reverse lookups into code/display pairs', () => {
    const forward = [{ WHONET_Code: 'AMP', ASIARS_Net_Code: 1 }, { WHONET_Code: 'CIP', ASIARS_Net_Code: 2 }];
    const reverse = [{ ASIARS_Net_Code: 1, WHONET_Code: 'Ampicillin' }, { ASIARS_Net_Code: 2, WHONET_Code: 'Ciprofloxacin' }];
    const pairs = joinForwardReverse(forward, reverse);
    expect(pairs.find((c) => c.code === 'AMP')?.display).toBe('Ampicillin');
    expect(pairs).toHaveLength(2);
  });
});
