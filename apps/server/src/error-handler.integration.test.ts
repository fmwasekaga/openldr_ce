import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Writable } from 'node:stream';
import { appError } from '@openldr/core';
import { registerErrorHandler } from './error-handler';

/**
 * Pins the ERROR CONTRACT end-to-end, through a real Fastify request cycle.
 *
 * The unit tests around toErrorResponse can only assert what we hand it; they can't prove Fastify's
 * own client errors reach it carrying a usable statusCode. That gap is exactly how every route in
 * the app came to answer 500/SY0500 for a malformed JSON body. These drive real requests instead.
 */
async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);

  // Body schema → a bad payload raises FST_ERR_VALIDATION (statusCode 400) inside Fastify.
  app.post('/validated', {
    schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } },
  }, async () => ({ ok: true }));

  app.post('/echo', async (req) => ({ got: req.body }));
  app.get('/boom', async () => { throw new Error('kaboom'); });
  app.get('/app-error', async () => { throw appError('RP0002'); });
  app.get('/too-large', async () => { throw Object.assign(new Error('file too large'), { statusCode: 413 }); });

  await app.ready();
  return app;
}

describe('error contract over a real request cycle', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildTestApp(); });
  afterAll(async () => { await app.close(); });

  it('answers 400 + SY0400 for a malformed JSON body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"name": ', // truncated → FST_ERR_CTP_INVALID_JSON_BODY
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'SY0400' });
  });

  it('answers 400 + SY0400 for a schema validation failure', async () => {
    const res = await app.inject({ method: 'POST', url: '/validated', payload: { wrong: 'field' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'SY0400' });
  });

  it('answers 415 + SY0415 for an unsupported content-type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      // application/xml has no parser → FST_ERR_CTP_INVALID_MEDIA_TYPE. (Not text/plain: Fastify
      // ships a default parser for that one, so it would be accepted with a 200.)
      headers: { 'content-type': 'application/xml' },
      payload: '<hello/>',
    });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toMatchObject({ code: 'SY0415' });
  });

  it('answers 413 + SY0413 for an oversized payload', async () => {
    const res = await app.inject({ method: 'GET', url: '/too-large' });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: 'SY0413', error: 'file too large' });
  });

  it('still answers 500 + SY0500 for an unexpected error', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: 'SY0500', error: 'kaboom' });
  });

  it('still round-trips an AppError unchanged', async () => {
    const res = await app.inject({ method: 'GET', url: '/app-error' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'RP0002', error: 'report not found' });
  });

  it('always answers with the {error, code, correlationId} contract and a catalog-shaped code', async () => {
    for (const url of ['/boom', '/app-error', '/too-large']) {
      const body = (await app.inject({ method: 'GET', url })).json();
      expect(Object.keys(body).sort(), url).toEqual(['code', 'correlationId', 'error']);
      expect(body.code, url).toMatch(/^[A-Z]{2,4}\d{4}$/);
      expect(body.correlationId, url).toBeTruthy();
    }
  });
});

describe('error logging', () => {
  /** Build an app whose pino output is captured, so we can assert on the emitted log line. */
  async function appWithCapturedLog(): Promise<{ app: FastifyInstance; lines: Record<string, unknown>[] }> {
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) { lines.push(JSON.parse(String(chunk))); cb(); },
    });
    const app = Fastify({ logger: { level: 'warn', stream } });
    registerErrorHandler(app);
    app.get('/unsupported', async () => {
      throw Object.assign(new Error('unsupported content-encoding: br'), {
        statusCode: 415,
        code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE',
      });
    });
    await app.ready();
    return { app, lines };
  }

  // We deliberately keep the library's code off the wire — so it has to survive SOMEWHERE, or we've
  // just destroyed the diagnostic. The log is where it lives: a correlationId from a client's 415
  // must still grep to a line naming the real Fastify code.
  it('logs the library error code that is withheld from the client', async () => {
    const { app, lines } = await appWithCapturedLog();
    const res = await app.inject({ method: 'GET', url: '/unsupported' });
    await app.close();

    expect(res.json()).toMatchObject({ code: 'SY0415' });
    expect(JSON.stringify(res.json())).not.toContain('FST_ERR_CTP_INVALID_MEDIA_TYPE');

    const logged = lines.find((l) => l.code === 'SY0415');
    expect(logged, 'no log line carried the mapped code').toBeDefined();
    expect(logged!.libCode).toBe('FST_ERR_CTP_INVALID_MEDIA_TYPE');
    expect(logged!.correlationId).toBe(res.json().correlationId);
  });

  it('logs a 4xx at warn and a 5xx at error', async () => {
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) { lines.push(JSON.parse(String(chunk))); cb(); },
    });
    const app = Fastify({ logger: { level: 'warn', stream } });
    registerErrorHandler(app);
    app.get('/client', async () => { throw appError('RP0001'); });
    app.get('/server', async () => { throw new Error('kaboom'); });
    await app.ready();

    await app.inject({ method: 'GET', url: '/client' });
    await app.inject({ method: 'GET', url: '/server' });
    await app.close();

    expect(lines.find((l) => l.code === 'RP0001')!.level).toBe(40); // pino warn
    expect(lines.find((l) => l.code === 'SY0500')!.level).toBe(50); // pino error
  });
});
