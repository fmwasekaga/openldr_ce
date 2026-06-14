import { describe, it, expect } from 'vitest';
import { DashboardQueryError } from './index';

describe('DashboardQueryError', () => {
  it('exists and carries a message', () => {
    const e = new DashboardQueryError('sql disabled');
    expect(e.message).toBe('sql disabled');
    expect(e.name).toBe('DashboardQueryError');
  });
});
