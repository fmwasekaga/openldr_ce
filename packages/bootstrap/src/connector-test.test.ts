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
  it('verifies for email types', async () => {
    const verify = vi.fn(async () => true);
    const close = vi.fn(() => {});
    await testConnector('smtp', {}, { email: () => ({ verify, close }) as never });
    expect(verify).toHaveBeenCalled();
  });
  it('connects + lists for sftp', async () => {
    const list = vi.fn(async () => []);
    const end = vi.fn(async () => {});
    await testConnector('sftp', {}, { sftp: async () => ({ list, end }) as never });
    expect(list).toHaveBeenCalledWith('.');
    expect(end).toHaveBeenCalled();
  });
  it('probes an imap connector (connect + open INBOX + logout)', async () => {
    const connect = vi.fn(async () => {});
    const logout = vi.fn(async () => {});
    const getMailboxLock = vi.fn(async () => ({ release: () => {} }));
    await testConnector('imap', { host: 'h', port: '993', user: 'u', password: 'p', tls: 'true' }, {
      imap: () => ({ connect, logout, getMailboxLock } as never),
    });
    expect(connect).toHaveBeenCalled();
    expect(getMailboxLock).toHaveBeenCalledWith('INBOX');
    expect(logout).toHaveBeenCalled();
  });
});
