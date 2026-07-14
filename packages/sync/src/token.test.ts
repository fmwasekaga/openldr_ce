import { describe, expect, it } from 'vitest';
import { createSyncTokenProvider, SyncTokenError } from './token';

const SECRET = 'super-secret-value';
const ISSUER = 'https://kc.example/realms/openldr';

// A fake fetch recording every call and returning a scripted token response. `okResponse` builds a
// minimal Response-shaped object exercising only what fetchFresh reads (ok/status/json).
function okResponse(body: { access_token: string; expires_in?: number }) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function errResponse(status: number) {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

interface FakeFetch {
  fn: typeof fetch;
  calls: { url: string; init: RequestInit | undefined }[];
}
function fakeFetch(responder: (call: number) => Response): FakeFetch {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn = (async (url: unknown, init?: RequestInit) => {
    const idx = calls.length;
    calls.push({ url: String(url), init });
    return responder(idx);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

// A controllable clock so cache-hit / refresh-after-expiry are deterministic (no real sleeps).
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('createSyncTokenProvider', () => {
  it('fetches a token once and returns it', async () => {
    const ff = fakeFetch(() => okResponse({ access_token: 'tok-1', expires_in: 300 }));
    const clock = fakeClock();
    const provider = createSyncTokenProvider({ issuerUrl: ISSUER, clientId: 'sync', clientSecret: SECRET, fetchFn: ff.fn, now: clock.now });

    expect(await provider.getToken()).toBe('tok-1');
    expect(ff.calls).toHaveLength(1);
  });

  it('returns the cached token without a network call while still valid', async () => {
    const ff = fakeFetch(() => okResponse({ access_token: 'tok-1', expires_in: 300 }));
    const clock = fakeClock();
    const provider = createSyncTokenProvider({ issuerUrl: ISSUER, clientId: 'sync', clientSecret: SECRET, fetchFn: ff.fn, now: clock.now });

    expect(await provider.getToken()).toBe('tok-1');
    // Advance to just before expiry (300 - 30 = 270s valid window).
    clock.advance(269 * 1000);
    expect(await provider.getToken()).toBe('tok-1');
    expect(ff.calls).toHaveLength(1); // cache hit, no second fetch
  });

  it('refetches after the token expires', async () => {
    const ff = fakeFetch((n) => okResponse({ access_token: n === 0 ? 'tok-1' : 'tok-2', expires_in: 300 }));
    const clock = fakeClock();
    const provider = createSyncTokenProvider({ issuerUrl: ISSUER, clientId: 'sync', clientSecret: SECRET, fetchFn: ff.fn, now: clock.now });

    expect(await provider.getToken()).toBe('tok-1');
    // Advance past the effective lifetime (300 - 30 = 270s); next call must refetch.
    clock.advance(271 * 1000);
    expect(await provider.getToken()).toBe('tok-2');
    expect(ff.calls).toHaveLength(2);
  });

  it('rejects with an error mentioning the status and not the client_secret on non-2xx', async () => {
    const ff = fakeFetch(() => errResponse(401));
    const provider = createSyncTokenProvider({ issuerUrl: ISSUER, clientId: 'sync', clientSecret: SECRET, fetchFn: ff.fn });

    await expect(provider.getToken()).rejects.toThrowError(SyncTokenError);
    let message = '';
    try {
      await provider.getToken();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('401');
    expect(message).not.toContain(SECRET);
  });

  it('POSTs client_credentials to the token endpoint with a urlencoded body', async () => {
    const ff = fakeFetch(() => okResponse({ access_token: 'tok-1', expires_in: 300 }));
    const provider = createSyncTokenProvider({ issuerUrl: ISSUER, clientId: 'sync-client', clientSecret: SECRET, fetchFn: ff.fn });

    await provider.getToken();
    const call = ff.calls[0];
    expect(call.url).toBe(`${ISSUER}/protocol/openid-connect/token`);
    expect(call.init?.method).toBe('POST');
    const headers = call.init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const params = new URLSearchParams(call.init?.body as string);
    expect(params.get('grant_type')).toBe('client_credentials');
    expect(params.get('client_id')).toBe('sync-client');
    expect(params.get('client_secret')).toBe(SECRET);
  });
});
