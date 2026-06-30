import { describe, it, expect } from 'vitest';
import { createConnectorDb, buildPgUrl } from './connector-db';

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
  it('accepts an IPv6 host and brackets it in the pg URL', () => {
    expect(() => createConnectorDb('postgres', { host: '::1', port: '5432', database: 'd', user: 'u', password: 'p' })).not.toThrow();
    expect(buildPgUrl({ host: '::1', port: '5432', database: 'd', user: 'u', password: 'p' })).toContain('[::1]');
  });
  it('throws on an invalid host', () => {
    expect(() => createConnectorDb('postgres', { host: 'evil/db', port: '5432', database: 'd', user: 'u', password: 'p' })).toThrow(/invalid connector host/);
  });
  it('throws on a non-numeric port', () => {
    expect(() => createConnectorDb('postgres', { host: 'h', port: 'abc', database: 'd', user: 'u', password: 'p' })).toThrow(/invalid connector port/);
  });
});
