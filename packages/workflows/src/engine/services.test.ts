import { describe, it, expect, vi } from 'vitest';
import { guardedFetch, parseAllowlist } from './services';

const okFetch = vi.fn(async () => new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json' } }));

/**
 * Build a Headers-like response stub the way the host fetch returns it:
 * supports `.get(name)`, `.forEach(cb)`, and the body via `.text()`.
 */
function makeResponse(opts: {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}): Response {
  const h = new Headers(opts.headers ?? {});
  return {
    status: opts.status,
    headers: h,
    text: async () => opts.body ?? '',
  } as unknown as Response;
}

describe('parseAllowlist', () => {
  it('splits, trims, lowercases, drops blanks', () => {
    expect(parseAllowlist(' A.com, b.org ,, ')).toEqual(['a.com', 'b.org']);
  });
});

describe('guardedFetch', () => {
  it('rejects a host not on the allow-list', async () => {
    await expect(guardedFetch({ url: 'https://evil.com/x' }, 'api.good.com', okFetch as never)).rejects.toThrow(/not allowed/);
  });
  it('allows an on-list host and parses JSON', async () => {
    const r = await guardedFetch({ url: 'https://api.good.com/x' }, 'api.good.com', okFetch as never);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ a: 1 });
  });
  it('empty allow-list rejects everything', async () => {
    await expect(guardedFetch({ url: 'https://api.good.com/x' }, '', okFetch as never)).rejects.toThrow(/not allowed/);
  });
  it('returns text when body is not JSON', async () => {
    const textFetch = vi.fn(async () => new Response('hello', { status: 200 }));
    const r = await guardedFetch({ url: 'https://api.good.com/x' }, 'api.good.com', textFetch as never);
    expect(r.data).toBe('hello');
  });
  it('rejects an invalid URL', async () => {
    await expect(guardedFetch({ url: 'not a url' }, 'api.good.com', okFetch as never)).rejects.toThrow(/invalid URL/);
  });

  // ---- SEC-05: redirect handling / SSRF bypass ----

  it('SEC-05: rejects a redirect to a non-allowlisted host and does NOT fetch it', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('http://localhost/')) {
        return makeResponse({ status: 302, headers: { location: 'http://127.0.0.1/admin' } });
      }
      // Any fetch of the disallowed loopback target would be a bypass.
      return makeResponse({ status: 200, body: 'SHOULD NOT BE FETCHED' });
    });
    await expect(
      guardedFetch({ url: 'http://localhost/start' }, 'localhost', fetchImpl as never),
    ).rejects.toThrow('HTTP host not allowed: 127.0.0.1');
    // The initial hop happened; the 127.0.0.1 hop must NOT have been fetched.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost/start');
  });

  it('follows a redirect to an allowlisted host and returns the final 200', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.good.com/start') {
        return makeResponse({ status: 302, headers: { location: 'https://api.good.com/final' } });
      }
      return makeResponse({ status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' });
    });
    const r = await guardedFetch({ url: 'https://api.good.com/start' }, 'api.good.com', fetchImpl as never);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('follows a relative redirect Location resolved against the current URL', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.good.com/a/b') {
        return makeResponse({ status: 302, headers: { location: '/c/d' } });
      }
      return makeResponse({ status: 200, body: 'final' });
    });
    const r = await guardedFetch({ url: 'https://api.good.com/a/b' }, 'api.good.com', fetchImpl as never);
    expect(r.data).toBe('final');
    expect(fetchImpl.mock.calls[1][0]).toBe('https://api.good.com/c/d');
  });

  it('throws on too many redirects (hop cap)', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      return makeResponse({ status: 302, headers: { location: `https://api.good.com/hop${n}` } });
    });
    await expect(
      guardedFetch({ url: 'https://api.good.com/start' }, 'api.good.com', fetchImpl as never),
    ).rejects.toThrow(/too many redirects/);
  });

  it('rejects a non-http(s) initial URL scheme', async () => {
    await expect(
      guardedFetch({ url: 'file:///etc/passwd' }, 'api.good.com', okFetch as never),
    ).rejects.toThrow(/scheme/i);
  });

  it('rejects a non-http(s) redirect Location scheme', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://api.good.com/start') {
        return makeResponse({ status: 302, headers: { location: 'file:///etc/passwd' } });
      }
      return makeResponse({ status: 200, body: 'nope' });
    });
    await expect(
      guardedFetch({ url: 'https://api.good.com/start' }, 'api.good.com', fetchImpl as never),
    ).rejects.toThrow(/scheme/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('303 switches to GET and drops the body', async () => {
    const seen: Array<{ method?: string; body?: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ method: init.method, body: init.body as unknown });
      if (url === 'https://api.good.com/post') {
        return makeResponse({ status: 303, headers: { location: 'https://api.good.com/result' } });
      }
      return makeResponse({ status: 200, body: 'done' });
    });
    await guardedFetch(
      { url: 'https://api.good.com/post', method: 'POST', body: { x: 1 } },
      'api.good.com',
      fetchImpl as never,
    );
    expect(seen[0].method).toBe('POST');
    expect(seen[0].body).toBeDefined();
    expect(seen[1].method).toBe('GET');
    expect(seen[1].body).toBeUndefined();
  });

  it('307 preserves method and body', async () => {
    const seen: Array<{ method?: string; body?: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ method: init.method, body: init.body as unknown });
      if (url === 'https://api.good.com/post') {
        return makeResponse({ status: 307, headers: { location: 'https://api.good.com/result' } });
      }
      return makeResponse({ status: 200, body: 'done' });
    });
    await guardedFetch(
      { url: 'https://api.good.com/post', method: 'POST', body: { x: 1 } },
      'api.good.com',
      fetchImpl as never,
    );
    expect(seen[1].method).toBe('POST');
    expect(seen[1].body).toBe(seen[0].body);
    expect(seen[1].body).toBeDefined();
  });

  it('strips Authorization and Cookie on a cross-host redirect', async () => {
    const seen: Array<Record<string, string>> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ ...(init.headers as Record<string, string>) });
      if (url === 'https://a.good.com/start') {
        return makeResponse({ status: 302, headers: { location: 'https://b.good.com/next' } });
      }
      return makeResponse({ status: 200, body: 'done' });
    });
    await guardedFetch(
      {
        url: 'https://a.good.com/start',
        headers: { Authorization: 'Bearer secret', Cookie: 'sid=abc', 'X-Keep': 'yes' },
      },
      'a.good.com,b.good.com',
      fetchImpl as never,
    );
    // First hop keeps the auth headers.
    expect(seen[0].Authorization).toBe('Bearer secret');
    expect(seen[0].Cookie).toBe('sid=abc');
    // Cross-host hop strips them but keeps benign headers.
    expect(seen[1].Authorization).toBeUndefined();
    expect(seen[1].Cookie).toBeUndefined();
    expect(seen[1]['X-Keep']).toBe('yes');
  });

  it('keeps Authorization on a same-host redirect', async () => {
    const seen: Array<Record<string, string>> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ ...(init.headers as Record<string, string>) });
      if (url === 'https://api.good.com/start') {
        return makeResponse({ status: 302, headers: { location: 'https://api.good.com/next' } });
      }
      return makeResponse({ status: 200, body: 'done' });
    });
    await guardedFetch(
      { url: 'https://api.good.com/start', headers: { Authorization: 'Bearer secret' } },
      'api.good.com',
      fetchImpl as never,
    );
    expect(seen[1].Authorization).toBe('Bearer secret');
  });

  it('treats a 3xx with no Location as the final response', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({ status: 304, body: '' }));
    const r = await guardedFetch({ url: 'https://api.good.com/x' }, 'api.good.com', fetchImpl as never);
    expect(r.status).toBe(304);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
