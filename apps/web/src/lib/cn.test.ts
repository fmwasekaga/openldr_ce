import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c');
  });
  it('merges conflicting tailwind classes (last wins)', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });
  it('handles arrays and conditionals', () => {
    expect(cn(['a', 'b'], { c: true, d: false })).toBe('a b c');
  });
});
