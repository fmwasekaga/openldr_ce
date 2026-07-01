import { describe, it, expect, vi } from 'vitest';
import { createPostgresListenerDriver, parseNotifyPayload, validateChannel } from './listener-postgres';

describe('parseNotifyPayload', () => {
  it('parses JSON objects and wraps non-JSON', () => {
    expect(parseNotifyPayload('ch', '{"a":1}')).toEqual({ channel: 'ch', a: 1 });
    expect(parseNotifyPayload('ch', 'hello')).toEqual({ channel: 'ch', payload: 'hello' });
    expect(parseNotifyPayload('ch', '')).toEqual({ channel: 'ch', payload: '' });
    expect(parseNotifyPayload('ch', '[1,2]')).toEqual({ channel: 'ch', payload: '[1,2]' });
  });
});

describe('validateChannel', () => {
  it('accepts identifiers, rejects injection', () => {
    expect(() => validateChannel('my_channel')).not.toThrow();
    expect(() => validateChannel('bad-name')).toThrow(/invalid channel/);
    expect(() => validateChannel('a"; DROP')).toThrow(/invalid channel/);
  });
});

describe('postgres listener driver', () => {
  function fakeClient() {
    const handlers: Record<string, (arg: unknown) => void> = {};
    return {
      connect: vi.fn(async () => {}),
      query: vi.fn(async () => ({})),
      on: vi.fn((evt: string, cb: (arg: unknown) => void) => { handlers[evt] = cb; }),
      removeAllListeners: vi.fn(),
      end: vi.fn(async () => {}),
      emit: (evt: string, arg: unknown) => handlers[evt]?.(arg),
    };
  }
  const connectors = {
    get: vi.fn(async () => ({ type: 'postgres', enabled: true })),
    getDecryptedConfig: vi.fn(async () => ({ host: 'h', port: '5432', database: 'd', user: 'u', password: 'p' })),
  };

  it('LISTENs and fires onFire on notification', async () => {
    const client = fakeClient();
    const driver = createPostgresListenerDriver({ connectors, secretsKey: 'k', logger: { error: vi.fn(), warn: vi.fn() }, makeClient: () => client as never });
    const onFire = vi.fn(async () => {});
    const handle = await driver.start({ workflowId: 'w', nodeId: 'n', triggerType: 'postgres', config: { connectorId: 'c1', channel: 'ch' } }, onFire);
    expect(client.connect).toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('LISTEN "ch"');
    client.emit('notification', { channel: 'ch', payload: '{"x":1}' });
    await new Promise((r) => setTimeout(r, 0));
    expect(onFire).toHaveBeenCalledWith({ channel: 'ch', x: 1 }, undefined);
    await handle.stop();
    expect(client.end).toHaveBeenCalled();
  });

  it('throws when the connector is missing or disabled', async () => {
    const driver = createPostgresListenerDriver({
      connectors: { get: vi.fn(async () => null), getDecryptedConfig: vi.fn(async () => ({})) },
      secretsKey: 'k', logger: { error: vi.fn(), warn: vi.fn() }, makeClient: () => ({} as never),
    });
    await expect(driver.start({ workflowId: 'w', nodeId: 'n', triggerType: 'postgres', config: { connectorId: 'c1', channel: 'ch' } }, vi.fn()))
      .rejects.toThrow(/not found or disabled/);
  });

  it('throws when the connector is the wrong type', async () => {
    const driver = createPostgresListenerDriver({
      connectors: { get: vi.fn(async () => ({ type: 'mysql', enabled: true })), getDecryptedConfig: vi.fn(async () => ({})) },
      secretsKey: 'k', logger: { error: vi.fn(), warn: vi.fn() }, makeClient: () => fakeClient() as never,
    });
    await expect(driver.start({ workflowId: 'w', nodeId: 'n', triggerType: 'postgres', config: { connectorId: 'c1', channel: 'ch' } }, vi.fn())).rejects.toThrow(/postgres connector/);
  });
});
