import { describe, it, expect } from 'vitest';
import { ftpHandler } from './ftp';
import { createContext } from '../execution-context';
import type { BinaryRef } from '../items';

function fakeCtx(sftpResult: Record<string, unknown>) {
  const store = new Map<string, Uint8Array>();
  let wn = 0;
  const calls: unknown[] = [];
  const services = {
    runConnectorSftp: async (i: unknown) => { calls.push(i); return sftpResult; },
    writeBinary: async ({ bytes, fileName, contentType }: { bytes: Uint8Array; fileName: string; contentType: string }): Promise<BinaryRef> => {
      const objectKey = `workflow-artifacts/t-${wn++}/${fileName}`; store.set(objectKey, bytes);
      return { objectKey, contentType, fileName, byteSize: bytes.byteLength };
    },
    readBinary: async (k: string) => { const b = store.get(k); if (!b) throw new Error('nf'); return b; },
  } as unknown as import('../services').WorkflowServices;
  return { ctx: createContext(undefined, () => {}, [], undefined, services), calls, store };
}
const node = (cfg: Record<string, unknown>) => ({ id: 'f1', type: 'action', data: { action: 'ftp', config: cfg } });

describe('ftpHandler', () => {
  it('download writes a BinaryRef onto the item', async () => {
    const { ctx } = fakeCtx({ bytes: new TextEncoder().encode('DATA'), fileName: 'a.txt' });
    const result = await ftpHandler(node({ connectorId: 'c1', operation: 'download', remotePath: '/d/a.txt', binaryField: 'file' }), ctx, []);
    const ref = (result[0].binary as Record<string, BinaryRef>).file;
    expect(ref.fileName).toBe('a.txt');
    expect((result[0].json as Record<string, unknown>).fileName).toBe('a.txt');
  });
  it('upload reads the input item file and sends bytes', async () => {
    const { ctx, calls } = fakeCtx({ ok: true });
    const seeded = await ctx.services!.writeBinary!({ bytes: new TextEncoder().encode('UP'), fileName: 'u.txt', contentType: 'text/plain' });
    const result = await ftpHandler(node({ connectorId: 'c1', operation: 'upload', remotePath: '/up/u.txt', binaryField: 'file' }), ctx, [{ json: {}, binary: { file: seeded } }]);
    const sent = calls[0] as { bytes: Uint8Array };
    expect(new TextDecoder().decode(sent.bytes)).toBe('UP');
    expect((result[0].json as Record<string, unknown>).ok).toBe(true);
  });
  it('list maps entries to items', async () => {
    const { ctx } = fakeCtx({ entries: [{ name: 'a', size: 1, type: '-' }, { name: 'b', size: 2, type: 'd' }] });
    const result = await ftpHandler(node({ connectorId: 'c1', operation: 'list', remotePath: '/d' }), ctx, []);
    expect(result).toEqual([{ json: { name: 'a', size: 1, type: '-' } }, { json: { name: 'b', size: 2, type: 'd' } }]);
  });
  it('rename requires toPath', async () => {
    const { ctx } = fakeCtx({ ok: true });
    await expect(ftpHandler(node({ connectorId: 'c1', operation: 'rename', remotePath: '/a' }), ctx, [])).rejects.toThrow(/toPath/);
  });
  it('upload throws when the input has no file', async () => {
    const { ctx } = fakeCtx({ ok: true });
    await expect(ftpHandler(node({ connectorId: 'c1', operation: 'upload', remotePath: '/x', binaryField: 'file' }), ctx, [{ json: {} }])).rejects.toThrow(/no file/);
  });
  it('throws without connector / remotePath / services', async () => {
    const { ctx } = fakeCtx({});
    await expect(ftpHandler(node({ connectorId: '', operation: 'list', remotePath: '/d' }), ctx, [])).rejects.toThrow(/connector is required/);
    await expect(ftpHandler(node({ connectorId: 'c1', operation: 'list', remotePath: '' }), ctx, [])).rejects.toThrow(/remote path/);
    const bare = createContext(undefined, () => {});
    await expect(ftpHandler(node({ connectorId: 'c1', operation: 'list', remotePath: '/d' }), bare, [])).rejects.toThrow(/requires server services/);
  });
});
