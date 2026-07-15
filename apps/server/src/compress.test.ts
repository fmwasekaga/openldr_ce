import { describe, it, expect } from 'vitest';
import { gzipSync, gunzipSync } from 'node:zlib';
import { buildApp } from './app';
import { ctxWith } from './test-helpers';

/**
 * Sync S7-B — gzip on the wire, asserted through the REAL `buildApp`.
 *
 * These tests deliberately drive `buildApp` rather than a bespoke Fastify instance. The thing that
 * actually breaks here is the REGISTRATION ORDER, not the options object: @fastify/compress works
 * by installing an `onRoute` listener that rewrites each route's hooks as it is added, so a
 * fire-and-forget `void app.register(compress, ...)` leaves the plugin inert against every route
 * while still looking perfectly configured. A test that registers the plugin itself (await, then
 * routes) can only ever pin the options and would stay green against that broken wiring — so it
 * has to be the real app or it proves nothing.
 *
 * Real routes are used throughout (no invented test routes), so this exercises the shipped app.
 */

/** Grow the publishers list past the 1KB threshold using the real create route. */
async function seedPublishers(app: Awaited<ReturnType<typeof buildApp>>, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminology/publishers',
      payload: { name: `Filler-${i}-aaaaaaaaaaaaaaaaaaaa`, role: 'local' },
    });
    expect(res.statusCode).toBe(201);
  }
}

describe('@fastify/compress wiring (through the real buildApp)', () => {
  it('inflates a gzipped request body', async () => {
    const app = await buildApp(ctxWith('up'));
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminology/publishers',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      payload: gzipSync(JSON.stringify({ name: 'GzipCo', role: 'local' })),
    });
    // 201 proves the body was genuinely inflated and parsed — an un-inflated gzip body fails
    // content-length/JSON parsing with a 400 instead.
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'GzipCo', role: 'local' });
    await app.close();
  });

  it('still accepts a plain request body (no regression)', async () => {
    const app = await buildApp(ctxWith('up'));
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminology/publishers',
      payload: { name: 'PlainCo', role: 'local' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'PlainCo', role: 'local' });
    await app.close();
  });

  it('rejects an unsupported request encoding with a coded 415', async () => {
    const app = await buildApp(ctxWith('up'));
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminology/publishers',
      headers: { 'content-type': 'application/json', 'content-encoding': 'br' },
      payload: Buffer.from('irrelevant'),
    });
    expect(res.statusCode).toBe(415);
    // Flows through the central error handler's AppError branch, so it keeps the catalog code +
    // correlationId contract rather than leaking a raw library code.
    expect(res.json()).toMatchObject({ code: 'SY0415', error: 'unsupported content-encoding: br' });
    expect(typeof res.json().correlationId).toBe('string');
    await app.close();
  });

  it('gzips a response above the threshold and leaves a small one alone', async () => {
    const app = await buildApp(ctxWith('up'));
    await app.ready();
    await seedPublishers(app, 40);

    const big = await app.inject({
      method: 'GET',
      url: '/api/terminology/publishers',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(big.statusCode).toBe(200);
    expect(big.headers['content-encoding']).toBe('gzip');
    const inflated = gunzipSync(big.rawPayload);
    expect(inflated.length).toBeGreaterThan(1024);
    // Round-trips to the real payload, and actually saved bytes.
    expect(JSON.parse(inflated.toString()).length).toBeGreaterThan(40);
    expect(big.rawPayload.length).toBeLessThan(inflated.length);

    // /health is well under the 1024-byte threshold → must stay uncompressed.
    const small = await app.inject({ method: 'GET', url: '/health', headers: { 'accept-encoding': 'gzip' } });
    expect(small.statusCode).toBe(200);
    expect(small.headers['content-encoding']).toBeUndefined();
    await app.close();
  });

  it('does not compress when the client does not ask (negotiation stays transparent)', async () => {
    const app = await buildApp(ctxWith('up'));
    await app.ready();
    await seedPublishers(app, 40);
    const res = await app.inject({ method: 'GET', url: '/api/terminology/publishers' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(res.body).length).toBeGreaterThan(40);
    await app.close();
  });

  it('advertises Accept-Encoding: gzip on responses (RFC 7694)', async () => {
    const app = await buildApp(ctxWith('up'));
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(String(res.headers['accept-encoding'])).toMatch(/gzip/);
    await app.close();
  });
});
