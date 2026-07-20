import { afterEach, describe, expect, it } from 'vitest';
import { SyncConfigInputSchema } from './sync';

// A minimal enabled config; individual tests override the URL fields under test.
const enabled = {
  enabled: true,
  mode: 'bidirectional' as const,
  centralUrl: 'https://central.example.org',
  siteId: 'lab-01',
  oidcIssuer: 'https://auth.example.org',
  clientId: 'lab-client',
  intervalMinutes: 15,
};

describe('SyncConfigInputSchema transport security', () => {
  const prev = process.env.SYNC_ALLOW_INSECURE_TRANSPORT;
  afterEach(() => {
    if (prev === undefined) delete process.env.SYNC_ALLOW_INSECURE_TRANSPORT;
    else process.env.SYNC_ALLOW_INSECURE_TRANSPORT = prev;
  });

  it('accepts https:// for centralUrl + oidcIssuer when enabled', () => {
    delete process.env.SYNC_ALLOW_INSECURE_TRANSPORT;
    expect(SyncConfigInputSchema.safeParse(enabled).success).toBe(true);
  });

  it('rejects a plaintext http:// centralUrl to a routable host when enabled', () => {
    delete process.env.SYNC_ALLOW_INSECURE_TRANSPORT;
    const r = SyncConfigInputSchema.safeParse({ ...enabled, centralUrl: 'http://central.example.org' });
    expect(r.success).toBe(false);
  });

  it('rejects a plaintext http:// oidcIssuer to a routable host when enabled', () => {
    delete process.env.SYNC_ALLOW_INSECURE_TRANSPORT;
    const r = SyncConfigInputSchema.safeParse({ ...enabled, oidcIssuer: 'http://auth.example.org' });
    expect(r.success).toBe(false);
  });

  it('allows http://localhost (loopback dev carve-out) when enabled', () => {
    delete process.env.SYNC_ALLOW_INSECURE_TRANSPORT;
    const r = SyncConfigInputSchema.safeParse({
      ...enabled,
      centralUrl: 'http://localhost:3000',
      oidcIssuer: 'http://127.0.0.1:8080/realms/openldr',
    });
    expect(r.success).toBe(true);
  });

  it('allows plaintext http:// to a routable host only with the explicit insecure override', () => {
    process.env.SYNC_ALLOW_INSECURE_TRANSPORT = 'true';
    const r = SyncConfigInputSchema.safeParse({
      ...enabled,
      centralUrl: 'http://central.lan',
      oidcIssuer: 'http://auth.lan/realms/openldr',
    });
    expect(r.success).toBe(true);
  });

  it('does not transport-check a DISABLED config (placeholder http is fine)', () => {
    delete process.env.SYNC_ALLOW_INSECURE_TRANSPORT;
    const r = SyncConfigInputSchema.safeParse({ enabled: false, centralUrl: 'http://central.example.org' });
    expect(r.success).toBe(true);
  });

  it('still rejects a non-http(s) scheme regardless of enabled/override', () => {
    process.env.SYNC_ALLOW_INSECURE_TRANSPORT = 'true';
    const r = SyncConfigInputSchema.safeParse({ ...enabled, centralUrl: 'ftp://central.example.org' });
    expect(r.success).toBe(false);
  });

  it('centralPublicKey is optional — absent parses (server preserves the stored key)', () => {
    delete process.env.SYNC_ALLOW_INSECURE_TRANSPORT;
    const r = SyncConfigInputSchema.safeParse(enabled);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.centralPublicKey).toBeUndefined();
  });
});
