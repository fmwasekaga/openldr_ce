import { describe, it, expect } from 'vitest';
import i18n from './index';
import { en } from './en';
import { fr } from './fr';

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

describe('i18n wiring', () => {
  it('resolves a known common key to English', () => {
    expect(i18n.t('common.save')).toBe('Save');
  });
  it('exposes the reportBuilder namespace', () => {
    expect((en as Record<string, unknown>).reportBuilder).toBeDefined();
  });
  it('serves the French reportBuilder value when language is fr', async () => {
    await i18n.changeLanguage('fr');
    expect(i18n.t('reportBuilder.palette.heading')).toBe(fr.reportBuilder.palette.heading);
    expect(i18n.t('reportBuilder.header.publish')).toBe(fr.reportBuilder.header.publish);
    await i18n.changeLanguage('en'); // restore for other tests
  });
});
