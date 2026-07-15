import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { encodePushBody, advertisesGzip, GZIP_MIN_BYTES } from './sync-gzip';

describe('advertisesGzip', () => {
  it('detects gzip in an Accept-Encoding advert', () => {
    expect(advertisesGzip('gzip')).toBe(true);
    expect(advertisesGzip('gzip, deflate')).toBe(true);
    expect(advertisesGzip('deflate, gzip;q=1.0')).toBe(true);
  });
  it('is false for absent/other adverts (the old-central case)', () => {
    expect(advertisesGzip(null)).toBe(false);
    expect(advertisesGzip('')).toBe(false);
    expect(advertisesGzip('identity')).toBe(false);
    expect(advertisesGzip('deflate')).toBe(false);
  });
});

describe('encodePushBody', () => {
  const big = JSON.stringify({ pad: 'x'.repeat(GZIP_MIN_BYTES + 100) });

  it('sends PLAIN with no Content-Encoding when central has not advertised (old-central safety)', () => {
    const { body, headers } = encodePushBody(big, false);
    expect(body).toBe(big);
    expect(headers['Content-Encoding']).toBeUndefined();
  });

  it('gzips when advertised and above the threshold, and it round-trips', () => {
    const { body, headers } = encodePushBody(big, true);
    expect(headers['Content-Encoding']).toBe('gzip');
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(gunzipSync(body as Buffer).toString()).toBe(big);
  });

  it('stays plain below the threshold even when advertised', () => {
    const small = JSON.stringify({ a: 1 });
    const { body, headers } = encodePushBody(small, true);
    expect(body).toBe(small);
    expect(headers['Content-Encoding']).toBeUndefined();
  });

  it('actually shrinks a realistic repetitive batch', () => {
    const { body } = encodePushBody(big, true);
    expect((body as Buffer).byteLength).toBeLessThan(Buffer.byteLength(big));
  });
});
