import { describe, it, expect, vi } from 'vitest';
import { guardedFetch, parseAllowlist } from './services';

const okFetch = vi.fn(async () => new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json' } }));

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
});
