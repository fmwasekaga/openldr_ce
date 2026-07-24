import { describe, it, expect } from 'vitest';
import { pickHandler } from './index';
import { unwrapBundleHandler } from './unwrap-bundle';
import type { RunnerNode } from './types';

describe('node handler registry', () => {
  it('registers unwrap-bundle', () => {
    const node: RunnerNode = { id: 'n1', type: 'action', data: { action: 'unwrap-bundle' } };
    expect(pickHandler(node)).toBe(unwrapBundleHandler);
  });
});
