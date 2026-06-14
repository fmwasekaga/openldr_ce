import { describe, it, expect } from 'vitest';

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
