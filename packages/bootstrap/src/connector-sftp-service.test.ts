import { describe, it, expect, vi } from 'vitest';
import { createConnectorSftpRunner } from './connector-sftp-service';

const connectorsFake = (rec: unknown) => ({
  get: vi.fn(async () => rec as never),
  getDecryptedConfig: vi.fn(async () => ({ host: 'h', port: '22', user: 'u', password: 'p' })),
});
function fakeClient() {
  let ended = false;
  const calls: string[] = [];
  return {
    client: {
      connect: async () => { calls.push('connect'); },
      get: async (p: string) => { calls.push(`get ${p}`); return Buffer.from('FILE'); },
      put: async (_b: unknown, p: string) => { calls.push(`put ${p}`); },
      list: async (p: string) => { calls.push(`list ${p}`); return [{ name: 'a.txt', size: 4, type: '-' }]; },
      delete: async (p: string) => { calls.push(`delete ${p}`); },
      rename: async (a: string, b: string) => { calls.push(`rename ${a} ${b}`); },
      end: async () => { ended = true; },
    },
    calls, isEnded: () => ended,
  };
}

describe('createConnectorSftpRunner', () => {
  it('download returns bytes + fileName and ends', async () => {
    const f = fakeClient();
    const run = createConnectorSftpRunner({ connectors: connectorsFake({ type: 'sftp', enabled: true }), secretsKey: 'k', connect: async () => f.client as never });
    const res = await run({ connectorId: 's1', operation: 'download', remotePath: '/dir/a.txt' });
    expect(new TextDecoder().decode(res.bytes!)).toBe('FILE');
    expect(res.fileName).toBe('a.txt');
    expect(f.isEnded()).toBe(true);
  });
  it('upload puts the bytes', async () => {
    const f = fakeClient();
    const run = createConnectorSftpRunner({ connectors: connectorsFake({ type: 'sftp', enabled: true }), secretsKey: 'k', connect: async () => f.client as never });
    expect(await run({ connectorId: 's1', operation: 'upload', remotePath: '/x', bytes: new TextEncoder().encode('Y') })).toEqual({ ok: true });
    expect(f.calls).toContain('put /x');
  });
  it('list returns entries', async () => {
    const f = fakeClient();
    const run = createConnectorSftpRunner({ connectors: connectorsFake({ type: 'sftp', enabled: true }), secretsKey: 'k', connect: async () => f.client as never });
    expect((await run({ connectorId: 's1', operation: 'list', remotePath: '/d' })).entries).toEqual([{ name: 'a.txt', size: 4, type: '-' }]);
  });
  it('rename requires toPath and calls rename', async () => {
    const f = fakeClient();
    const run = createConnectorSftpRunner({ connectors: connectorsFake({ type: 'sftp', enabled: true }), secretsKey: 'k', connect: async () => f.client as never });
    await run({ connectorId: 's1', operation: 'rename', remotePath: '/a', toPath: '/b' });
    expect(f.calls).toContain('rename /a /b');
  });
  it('ends the client even when the op throws', async () => {
    const f = fakeClient();
    f.client.get = async () => { throw new Error('boom'); };
    const run = createConnectorSftpRunner({ connectors: connectorsFake({ type: 'sftp', enabled: true }), secretsKey: 'k', connect: async () => f.client as never });
    await expect(run({ connectorId: 's1', operation: 'download', remotePath: '/a' })).rejects.toThrow('boom');
    expect(f.isEnded()).toBe(true);
  });
  it('throws for a non-sftp connector', async () => {
    const run = createConnectorSftpRunner({ connectors: connectorsFake({ type: 'redis', enabled: true }), secretsKey: 'k', connect: vi.fn() as never });
    await expect(run({ connectorId: 'x', operation: 'list', remotePath: '/' })).rejects.toThrow(/not an sftp connector/);
  });
});
