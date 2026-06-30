import { describe, it, expect } from 'vitest';
import { createConnectorRedis } from './connector-redis';

describe('createConnectorRedis', () => {
  it('constructs a client with get/set/del/quit', () => {
    const c = createConnectorRedis({ host: 'h', port: '6379' });
    expect(typeof c.get).toBe('function');
    expect(typeof c.quit).toBe('function');
    c.disconnect(); // tear down the lazy client without connecting
  });
  it('rejects an invalid port', () => {
    expect(() => createConnectorRedis({ host: 'h', port: 'abc' })).toThrow(/invalid connector port/);
  });
});
