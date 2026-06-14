import { describe, it, expect } from 'vitest';
import { createMssqlStore } from './index';

const cfg = { host: '127.0.0.1', port: 1433, database: 'openldr', user: 'sa', password: 'x', encrypt: false, trustServerCertificate: true };

describe('createMssqlStore', () => {
  it('reports up when the ping succeeds', async () => {
    const store = createMssqlStore(cfg, { ping: async () => {} });
    const r = await store.healthCheck();
    expect(r.status).toBe('up');
    await store.close();
  });
  it('reports down when the ping throws', async () => {
    const store = createMssqlStore(cfg, { ping: async () => { throw new Error('ECONNREFUSED'); } });
    const r = await store.healthCheck();
    expect(r.status).toBe('down');
    expect(r.detail).toContain('ECONNREFUSED');
    await store.close();
  });
});
