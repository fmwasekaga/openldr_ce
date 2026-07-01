import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:net';
import { isPortFree } from './port-check.mjs';

let srv;
afterEach(() => { if (srv) srv.close(); srv = undefined; });

describe('isPortFree', () => {
  it('true for an unbound port, false for a bound one', async () => {
    await new Promise((res) => { srv = createServer().listen(0, '0.0.0.0', res); });
    const busy = srv.address().port;
    expect(await isPortFree(busy)).toBe(false);
    srv.close(); srv = undefined;
    expect(await isPortFree(busy)).toBe(true);
  });
});
