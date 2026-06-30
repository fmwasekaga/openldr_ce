import { describe, it, expect } from 'vitest';
import { createConnectorDb } from './connector-db';

describe('createConnectorDb', () => {
  it('builds a postgres connection object with query + close', () => {
    const conn = createConnectorDb('postgres', { host: 'h', port: '5432', database: 'd', user: 'u', password: 'p' });
    expect(typeof conn.query).toBe('function');
    expect(typeof conn.close).toBe('function');
  });
  it('builds a microsoft-sql connection object', () => {
    const conn = createConnectorDb('microsoft-sql', { host: 'h', port: '1433', database: 'd', user: 'u', password: 'p' });
    expect(typeof conn.query).toBe('function');
  });
  it('throws on an unsupported type', () => {
    expect(() => createConnectorDb('mongodb', {})).toThrow(/unsupported connector type/);
  });
});
