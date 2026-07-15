import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import compress from '@fastify/compress';
import { gzipSync, gunzipSync } from 'node:zlib';

async function appWithCompress() {
  const app = Fastify();
  await app.register(compress, {
    globalCompression: true,
    globalDecompression: true,
    threshold: 1024,
    encodings: ['gzip'],
    requestEncodings: ['gzip'],
    // @fastify/compress v9 calls this as (encoding, request) — NOT (request, encoding) as in the
    // v8-era docs — and requires a real Error return (a plain object fails to typecheck and, more
    // importantly, isn't honoured the same way by a real central error handler; see app.ts).
    onUnsupportedRequestEncoding: (encoding) => {
      const err = new Error(`unsupported content-encoding: ${encoding}`) as Error & { statusCode: number; code: string };
      err.statusCode = 415;
      err.code = 'UNSUPPORTED_MEDIA_TYPE';
      return err;
    },
  });
  app.addHook('onSend', async (_req, reply) => {
    if (!reply.getHeader('accept-encoding')) reply.header('Accept-Encoding', 'gzip');
  });
  app.post('/echo', async (req) => ({ got: req.body }));
  app.get('/big', async () => ({ blob: 'x'.repeat(5000) }));
  app.get('/small', async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('@fastify/compress wiring', () => {
  it('inflates a gzipped request body', async () => {
    const app = await appWithCompress();
    const payload = { hello: 'world', n: 1 };
    const res = await app.inject({
      method: 'POST', url: '/echo',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      payload: gzipSync(JSON.stringify(payload)),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().got).toEqual(payload);
  });

  it('still accepts a plain request body (no regression)', async () => {
    const app = await appWithCompress();
    const res = await app.inject({ method: 'POST', url: '/echo', payload: { a: 2 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().got).toEqual({ a: 2 });
  });

  it('rejects an unsupported request encoding with 415', async () => {
    const app = await appWithCompress();
    const res = await app.inject({
      method: 'POST', url: '/echo',
      headers: { 'content-type': 'application/json', 'content-encoding': 'br' },
      payload: Buffer.from('irrelevant'),
    });
    expect(res.statusCode).toBe(415);
  });

  it('gzips a response above the threshold and leaves a small one alone', async () => {
    const app = await appWithCompress();
    const big = await app.inject({ method: 'GET', url: '/big', headers: { 'accept-encoding': 'gzip' } });
    expect(big.headers['content-encoding']).toBe('gzip');
    expect(JSON.parse(gunzipSync(big.rawPayload).toString()).blob.length).toBe(5000);
    const small = await app.inject({ method: 'GET', url: '/small', headers: { 'accept-encoding': 'gzip' } });
    expect(small.headers['content-encoding']).toBeUndefined();
  });

  it('advertises Accept-Encoding: gzip on responses (RFC 7694)', async () => {
    const app = await appWithCompress();
    const res = await app.inject({ method: 'GET', url: '/small' });
    expect(String(res.headers['accept-encoding'])).toMatch(/gzip/);
  });
});
