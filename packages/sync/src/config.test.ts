import { describe, expect, it, vi } from 'vitest';
import type { AppSettingStore, AppSettingRecord } from '@openldr/db';
import { readSyncConfig } from './config';

// A Map-backed fake AppSettingStore exercising only what readSyncConfig uses (`get`). getAll/set throw
// so an accidental reliance on them surfaces loudly.
function fakeStore(entries: Record<string, string>): AppSettingStore {
  const map = new Map(Object.entries(entries));
  return {
    async get(key: string): Promise<AppSettingRecord | null> {
      if (!map.has(key)) return null;
      return { key, value: map.get(key)!, updatedAt: new Date(0), updatedBy: null };
    },
    async getAll() {
      throw new Error('getAll not used by readSyncConfig');
    },
    async set() {
      throw new Error('set not used by readSyncConfig');
    },
  };
}

// Encrypt convention for the fake: ciphertext is `enc:<plaintext>`; decrypt strips the prefix. A blob
// without the prefix is treated as corrupt and throws (mirrors the real GCM auth failure).
const fakeDecrypt = (blob: string): string => {
  if (!blob.startsWith('enc:')) throw new Error('bad blob');
  return blob.slice('enc:'.length);
};

const FULL = {
  'sync.enabled': 'true',
  'sync.central_url': 'https://central.example/api',
  'sync.oidc_issuer': 'https://kc.example/realms/openldr',
  'sync.client_id': 'lab-nairobi',
  'sync.client_secret': 'enc:s3cr3t',
  'sync.site_id': 'site-nairobi-01',
};

describe('readSyncConfig', () => {
  it('returns a fully-populated config with the DECRYPTED secret when all keys present + enabled', async () => {
    const cfg = await readSyncConfig(fakeStore(FULL), fakeDecrypt);
    expect(cfg).toEqual({
      enabled: true,
      centralUrl: 'https://central.example/api',
      oidcIssuer: 'https://kc.example/realms/openldr',
      clientId: 'lab-nairobi',
      clientSecret: 's3cr3t', // decrypted, not the ciphertext
      siteId: 'site-nairobi-01',
      mode: 'bidirectional', // default when sync.mode absent
      intervalMinutes: 15, // default when sync.interval_minutes absent
    });
  });

  it('returns null when sync.enabled is absent (regardless of other keys)', async () => {
    const { 'sync.enabled': _omit, ...rest } = FULL;
    const cfg = await readSyncConfig(fakeStore(rest), fakeDecrypt);
    expect(cfg).toBeNull();
  });

  it("returns null when sync.enabled is 'false'", async () => {
    const cfg = await readSyncConfig(fakeStore({ ...FULL, 'sync.enabled': 'false' }), fakeDecrypt);
    expect(cfg).toBeNull();
  });

  it('returns null (does not warn) when disabled — the off path is silent', async () => {
    const logger = { warn: vi.fn() };
    const cfg = await readSyncConfig(fakeStore({ ...FULL, 'sync.enabled': 'false' }), fakeDecrypt, logger);
    expect(cfg).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns null AND warns with the missing key when enabled but central_url is missing', async () => {
    const { 'sync.central_url': _omit, ...rest } = FULL;
    const logger = { warn: vi.fn() };
    const cfg = await readSyncConfig(fakeStore(rest), fakeDecrypt, logger);
    expect(cfg).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('sync.central_url'));
  });

  it('treats an empty-string required value as missing', async () => {
    const logger = { warn: vi.fn() };
    const cfg = await readSyncConfig(fakeStore({ ...FULL, 'sync.site_id': '   ' }), fakeDecrypt, logger);
    expect(cfg).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('sync.site_id'));
  });

  it('lists every missing key in one warning', async () => {
    const logger = { warn: vi.fn() };
    const cfg = await readSyncConfig(
      fakeStore({ 'sync.enabled': 'true', 'sync.client_id': 'x', 'sync.client_secret': 'enc:y' }),
      fakeDecrypt,
      logger,
    );
    expect(cfg).toBeNull();
    const msg = logger.warn.mock.calls[0][0] as string;
    expect(msg).toContain('sync.central_url');
    expect(msg).toContain('sync.oidc_issuer');
    expect(msg).toContain('sync.site_id');
  });

  it('returns null and warns when decrypt throws', async () => {
    const logger = { warn: vi.fn() };
    // ciphertext lacks the `enc:` prefix → fakeDecrypt throws.
    const cfg = await readSyncConfig(fakeStore({ ...FULL, 'sync.client_secret': 'corrupt-blob' }), fakeDecrypt, logger);
    expect(cfg).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('decrypt'));
  });

  it('returns null and warns when the secret decrypts to an empty value', async () => {
    const logger = { warn: vi.fn() };
    const cfg = await readSyncConfig(fakeStore({ ...FULL, 'sync.client_secret': 'enc:' }), fakeDecrypt, logger);
    expect(cfg).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('empty'));
  });

  it('supports an async decrypt fn', async () => {
    const asyncDecrypt = async (blob: string) => fakeDecrypt(blob);
    const cfg = await readSyncConfig(fakeStore(FULL), asyncDecrypt);
    expect(cfg?.clientSecret).toBe('s3cr3t');
  });

  describe('sync.mode', () => {
    it("reads mode:'push' from sync.mode='push'", async () => {
      const cfg = await readSyncConfig(fakeStore({ ...FULL, 'sync.mode': 'push' }), fakeDecrypt);
      expect(cfg?.mode).toBe('push');
    });

    it("reads mode:'pull' from sync.mode='pull'", async () => {
      const cfg = await readSyncConfig(fakeStore({ ...FULL, 'sync.mode': 'pull' }), fakeDecrypt);
      expect(cfg?.mode).toBe('pull');
    });

    it("defaults to 'bidirectional' when sync.mode is absent", async () => {
      const cfg = await readSyncConfig(fakeStore(FULL), fakeDecrypt);
      expect(cfg?.mode).toBe('bidirectional');
    });

    it("lowercases so 'PULL' → 'pull'", async () => {
      const cfg = await readSyncConfig(fakeStore({ ...FULL, 'sync.mode': 'PULL' }), fakeDecrypt);
      expect(cfg?.mode).toBe('pull');
    });

    it("falls back to 'bidirectional' on a garbage value", async () => {
      const cfg = await readSyncConfig(fakeStore({ ...FULL, 'sync.mode': 'sideways' }), fakeDecrypt);
      expect(cfg?.mode).toBe('bidirectional');
    });
  });

  describe('sync.interval_minutes', () => {
    it('reads intervalMinutes:30 from sync.interval_minutes=30', async () => {
      const cfg = await readSyncConfig(fakeStore({ ...FULL, 'sync.interval_minutes': '30' }), fakeDecrypt);
      expect(cfg?.intervalMinutes).toBe(30);
    });

    it('defaults to 15 when sync.interval_minutes is absent', async () => {
      const cfg = await readSyncConfig(fakeStore(FULL), fakeDecrypt);
      expect(cfg?.intervalMinutes).toBe(15);
    });

    it('rejects 0 (below the [1,1440] floor) → 15', async () => {
      const cfg = await readSyncConfig(fakeStore({ ...FULL, 'sync.interval_minutes': '0' }), fakeDecrypt);
      expect(cfg?.intervalMinutes).toBe(15);
    });

    it('rejects 5000 (above the 1440 ceiling) → 15', async () => {
      const cfg = await readSyncConfig(fakeStore({ ...FULL, 'sync.interval_minutes': '5000' }), fakeDecrypt);
      expect(cfg?.intervalMinutes).toBe(15);
    });

    it('floors a fractional value: 12.9 → 12', async () => {
      const cfg = await readSyncConfig(fakeStore({ ...FULL, 'sync.interval_minutes': '12.9' }), fakeDecrypt);
      expect(cfg?.intervalMinutes).toBe(12);
    });
  });

  describe('boolean parsing of sync.enabled', () => {
    it.each(['true', 'TRUE', 'True', '1', ' true '])('treats %o as enabled', async (val) => {
      const cfg = await readSyncConfig(fakeStore({ ...FULL, 'sync.enabled': val }), fakeDecrypt);
      expect(cfg).not.toBeNull();
    });

    it.each(['false', 'FALSE', '0', 'no', 'yes', ''])('treats %o as disabled', async (val) => {
      const cfg = await readSyncConfig(fakeStore({ ...FULL, 'sync.enabled': val }), fakeDecrypt);
      expect(cfg).toBeNull();
    });
  });
});
