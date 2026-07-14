import { describe, expect, it } from 'vitest';
import type { AppSettingRecord, AppSettingStore } from '@openldr/db';
import { getSyncConfig, setSyncConfig } from './sync-settings';

function fakeStore(initial: Record<string, string> = {}): AppSettingStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(key: string): Promise<AppSettingRecord | null> {
      const value = data.get(key);
      return value == null ? null : { key, value, updatedAt: new Date(0), updatedBy: null };
    },
    async getAll() {
      return [...data.entries()].map(([key, value]) => ({ key, value, updatedAt: new Date(0), updatedBy: null }));
    },
    async set(key: string, value: string) {
      data.set(key, value);
    },
  };
}

const encrypt = (plain: string) => `enc:${plain}`;

const fullInput = {
  enabled: true,
  mode: 'push' as const,
  centralUrl: 'https://central.example.org',
  siteId: 'lab-01',
  oidcIssuer: 'https://auth.example.org',
  clientId: 'lab-client',
  clientSecret: 's3cr3t',
  intervalMinutes: 30,
};

describe('sync settings (discrete keys)', () => {
  it('returns disabled defaults when nothing is stored', async () => {
    expect(await getSyncConfig(fakeStore())).toEqual({
      enabled: false,
      mode: 'bidirectional',
      centralUrl: '',
      siteId: '',
      oidcIssuer: '',
      clientId: '',
      clientSecretSet: false,
      intervalMinutes: 15,
    });
  });

  it('writes all seven non-secret discrete keys + the encrypted secret, never the plaintext', async () => {
    const store = fakeStore();
    const view = await setSyncConfig(store, fullInput, 'tester', encrypt);

    expect(store.data.get('sync.enabled')).toBe('true');
    expect(store.data.get('sync.mode')).toBe('push');
    expect(store.data.get('sync.central_url')).toBe('https://central.example.org');
    expect(store.data.get('sync.site_id')).toBe('lab-01');
    expect(store.data.get('sync.oidc_issuer')).toBe('https://auth.example.org');
    expect(store.data.get('sync.client_id')).toBe('lab-client');
    expect(store.data.get('sync.interval_minutes')).toBe('30');
    // secret is sealed, never plaintext
    expect(store.data.get('sync.client_secret')).toBe('enc:s3cr3t');
    expect(store.data.get('sync.client_secret')).not.toContain('s3cr3t'.padStart(7));

    // the returned view carries clientSecretSet, never the value
    expect(view.clientSecretSet).toBe(true);
    expect(view).not.toHaveProperty('clientSecret');
    expect(JSON.stringify(view)).not.toContain('s3cr3t');
    expect(JSON.stringify(view)).not.toContain('enc:s3cr3t');
  });

  it('preserves an existing secret when clientSecret is absent', async () => {
    const store = fakeStore({ 'sync.client_secret': 'enc:old-secret' });
    const { clientSecret: _omit, ...noSecret } = fullInput;
    const view = await setSyncConfig(store, noSecret, 'tester', encrypt);
    expect(store.data.get('sync.client_secret')).toBe('enc:old-secret');
    expect(view.clientSecretSet).toBe(true);
  });

  it('preserves an existing secret when clientSecret is blank', async () => {
    const store = fakeStore({ 'sync.client_secret': 'enc:old-secret' });
    const view = await setSyncConfig(store, { ...fullInput, clientSecret: '' }, 'tester', encrypt);
    expect(store.data.get('sync.client_secret')).toBe('enc:old-secret');
    expect(view.clientSecretSet).toBe(true);
  });

  it('getSyncConfig reflects secret presence but never returns the value', async () => {
    const store = fakeStore({ 'sync.client_secret': 'enc:whatever' });
    const view = await getSyncConfig(store);
    expect(view.clientSecretSet).toBe(true);
    expect(JSON.stringify(view)).not.toContain('whatever');
  });

  it('round-trips the non-secret fields through get', async () => {
    const store = fakeStore();
    await setSyncConfig(store, fullInput, 'tester', encrypt);
    const view = await getSyncConfig(store);
    expect(view).toEqual({
      enabled: true,
      mode: 'push',
      centralUrl: 'https://central.example.org',
      siteId: 'lab-01',
      oidcIssuer: 'https://auth.example.org',
      clientId: 'lab-client',
      clientSecretSet: true,
      intervalMinutes: 30,
    });
  });

  it('rejects enabling sync without required credentials', async () => {
    await expect(
      setSyncConfig(fakeStore(), { enabled: true, centralUrl: '', siteId: 'lab-01' }, 'tester', encrypt),
    ).rejects.toThrow();
  });

  it('rejects a non-http central URL', async () => {
    await expect(
      setSyncConfig(fakeStore(), { centralUrl: 'ftp://nope' }, 'tester', encrypt),
    ).rejects.toThrow();
  });

  it('rejects a non-http oidc issuer', async () => {
    await expect(
      setSyncConfig(fakeStore(), { oidcIssuer: 'ftp://nope' }, 'tester', encrypt),
    ).rejects.toThrow();
  });
});
