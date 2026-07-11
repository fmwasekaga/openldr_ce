import { describe, it, expect } from 'vitest';
import { createMysqlStore } from './index';

const cfg = { host: '127.0.0.1', port: 3306, database: 'openldr', user: 'root', password: 'x', ssl: false };

describe('createMysqlStore', () => {
  it('reports up when the ping succeeds', async () => {
    const store = createMysqlStore(cfg, { ping: async () => {} });
    const r = await store.healthCheck();
    expect(r.status).toBe('up');
    await store.close();
  });
  it('reports down when the ping throws', async () => {
    const store = createMysqlStore(cfg, { ping: async () => { throw new Error('ECONNREFUSED'); } });
    const r = await store.healthCheck();
    expect(r.status).toBe('down');
    expect(r.detail).toContain('ECONNREFUSED');
    await store.close();
  });
});
