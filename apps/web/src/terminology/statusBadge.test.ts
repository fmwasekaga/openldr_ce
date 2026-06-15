import { describe, it, expect } from 'vitest';
import { statusBadgeClass } from './statusBadge';

describe('statusBadgeClass', () => {
  it('ACTIVE → contains emerald', () => {
    expect(statusBadgeClass('ACTIVE')).toContain('emerald');
  });

  it('DRAFT → contains amber', () => {
    expect(statusBadgeClass('DRAFT')).toContain('amber');
  });

  it('DEPRECATED → contains orange', () => {
    expect(statusBadgeClass('DEPRECATED')).toContain('orange');
  });

  it('DISABLED → contains muted-foreground', () => {
    expect(statusBadgeClass('DISABLED')).toContain('muted-foreground');
  });

  it('unknown → empty string', () => {
    expect(statusBadgeClass('UNKNOWN')).toBe('');
    expect(statusBadgeClass('')).toBe('');
  });
});
