import { describe, it, expect, vi } from 'vitest';
import { createConnectorRedisRunner } from './connector-redis-service';

const connectorsFake = (rec: unknown) => ({
  get: vi.fn(async () => rec as never),
  getDecryptedConfig: vi.fn(async () => ({ host: 'h', port: '6379' })),
});
function fakeClient(getVal: unknown) {
  const calls: string[] = [];
  let quit = false;
  return {
    client: {
      get: async (k: string) => { calls.push(`get ${k}`); return getVal; },
      set: async (...a: unknown[]) => { calls.push(`set ${a.join(',')}`); return 'OK'; },
      del: async (k: string) => { calls.push(`del ${k}`); return 1; },
      quit: async () => { quit = true; return 'OK'; },
    },
    calls, isQuit: () => quit,
  };
}

describe('createConnectorRedisRunner', () => {
  it('get returns {result} and quits', async () => {
    const f = fakeClient('v1');
    const run = createConnectorRedisRunner({ connectors: connectorsFake({ type: 'redis', enabled: true }), secretsKey: 'k', make: () => f.client as never });
    expect(await run({ connectorId: 'r1', operation: 'get', key: 'k1' })).toEqual({ result: 'v1' });
    expect(f.isQuit()).toBe(true);
  });
  it('set with ttl issues EX', async () => {
    const f = fakeClient(null);
    const run = createConnectorRedisRunner({ connectors: connectorsFake({ type: 'redis', enabled: true }), secretsKey: 'k', make: () => f.client as never });
    await run({ connectorId: 'r1', operation: 'set', key: 'k1', value: 'v', ttlSeconds: 60 });
    expect(f.calls.some((c) => c.includes('EX,60'))).toBe(true);
  });
  it('throws for wrong type', async () => {
    const run = createConnectorRedisRunner({ connectors: connectorsFake({ type: 'postgres', enabled: true }), secretsKey: 'k', make: () => ({}) as never });
    await expect(run({ connectorId: 'x', operation: 'get', key: 'k' })).rejects.toThrow(/not a redis connector/);
  });
});
