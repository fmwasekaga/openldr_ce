import { describe, it, expect } from 'vitest';
import { up, down } from './043_reports';

describe('043_reports migration', () => {
  it('exports up and down', () => {
    expect(typeof up).toBe('function');
    expect(typeof down).toBe('function');
  });
});
