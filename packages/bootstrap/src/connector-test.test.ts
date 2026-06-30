import { describe, it, expect, vi } from 'vitest';
import { testConnector } from './connector-test';

describe('testConnector', () => {
  it('runs select 1 for sql types', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const close = vi.fn(async () => {});
    await testConnector('postgres', {}, { sqlDb: () => ({ query, close }) as never });
    expect(query).toHaveBeenCalledWith('select 1');
    expect(close).toHaveBeenCalled();
  });
  it('pings for mongodb', async () => {
    const command = vi.fn(async () => ({ ok: 1 }));
    const close = vi.fn(async () => {});
    await testConnector('mongodb', {}, { mongo: async () => ({ db: { command }, close }) as never });
    expect(command).toHaveBeenCalledWith({ ping: 1 });
    expect(close).toHaveBeenCalled();
  });
  it('pings for redis', async () => {
    const ping = vi.fn(async () => 'PONG');
    const quit = vi.fn(async () => 'OK');
    await testConnector('redis', {}, { redis: () => ({ ping, quit }) as never });
    expect(ping).toHaveBeenCalled();
    expect(quit).toHaveBeenCalled();
  });
  it('throws for an unknown type', async () => {
    await expect(testConnector('mystery', {})).rejects.toThrow(/unsupported connector type/);
  });
});
