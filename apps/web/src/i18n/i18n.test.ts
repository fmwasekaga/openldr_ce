import { describe, it, expect } from 'vitest';
import i18n from './index';

describe('i18n', () => {
  it('initializes with en and resolves table + users keys', () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.t('table.filter')).toBe('Filter');
    expect(i18n.t('table.operators.like')).toBe('Contains');
    expect(i18n.t('users.roleNames.lab_admin')).toBe('Lab Admin');
    expect(i18n.t('users.count', { count: 3 })).toBe('3 users');
  });
  it('falls back to the raw role for an unknown role key', () => {
    expect(i18n.t('users.roleNames.custom_role', { defaultValue: 'custom_role' })).toBe('custom_role');
  });
});
