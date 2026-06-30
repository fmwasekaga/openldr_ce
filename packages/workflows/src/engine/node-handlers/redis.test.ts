import { describe, it, expect } from 'vitest';
import { redisHandler } from './redis';
import { createContext } from '../execution-context';

function fakeCtx(result: unknown) {
  const calls: unknown[] = [];
  const services = { runConnectorRedis: async (i: unknown) => { calls.push(i); return { result }; } } as unknown as import('../services').WorkflowServices;
  return { ctx: createContext(undefined, () => {}, [], undefined, services), calls };
}
const node = (cfg: Record<string, unknown>) => ({ id: 'rd1', type: 'action', data: { action: 'redis', config: cfg } });

describe('redisHandler', () => {
  it('get returns {value}', async () => {
    const { ctx, calls } = fakeCtx('hello');
    const result = await redisHandler(node({ connectorId: 'c1', operation: 'get', key: 'k1' }), ctx, []);
    expect(calls[0]).toEqual({ connectorId: 'c1', operation: 'get', key: 'k1', value: undefined, ttlSeconds: undefined });
    expect(result).toEqual([{ json: { value: 'hello' } }]);
  });
  it('set resolves templates in key/value and returns {ok}', async () => {
    const { ctx, calls } = fakeCtx('OK');
    const result = await redisHandler(node({ connectorId: 'c1', operation: 'set', key: 'k:{{ $json.id }}', value: '{{ $json.v }}', ttlSeconds: 30 }), ctx, [{ json: { id: '7', v: 'x' } }]);
    expect(calls[0]).toEqual({ connectorId: 'c1', operation: 'set', key: 'k:7', value: 'x', ttlSeconds: 30 });
    expect(result).toEqual([{ json: { ok: 'OK' } }]);
  });
  it('del returns {deleted}', async () => {
    const { ctx } = fakeCtx(1);
    expect(await redisHandler(node({ connectorId: 'c1', operation: 'del', key: 'k1' }), ctx, [])).toEqual([{ json: { deleted: 1 } }]);
  });
  it('throws without connector/key/services', async () => {
    const { ctx } = fakeCtx(null);
    await expect(redisHandler(node({ connectorId: '', operation: 'get', key: 'k' }), ctx, [])).rejects.toThrow(/connector is required/);
    await expect(redisHandler(node({ connectorId: 'c1', operation: 'get', key: '' }), ctx, [])).rejects.toThrow(/key is required/);
    const bare = createContext(undefined, () => {});
    await expect(redisHandler(node({ connectorId: 'c1', operation: 'get', key: 'k' }), bare, [])).rejects.toThrow(/requires server services/);
  });
});
