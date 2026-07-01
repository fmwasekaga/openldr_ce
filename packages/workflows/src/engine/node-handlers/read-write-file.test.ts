import { describe, it, expect, vi } from 'vitest';
import { readWriteFileHandler } from './read-write-file';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';

const node = (config: Record<string, unknown>) => ({ id: 'f', type: 'action', data: { action: 'read-write-file', config } });

describe('readWriteFileHandler', () => {
  it('read (binary) → BinaryRef on item.binary', async () => {
    const hostFileRead = vi.fn(async () => ({ bytes: new Uint8Array([1, 2]) }));
    const writeBinary = vi.fn(async () => ({ objectKey: 'k', contentType: 'application/octet-stream', fileName: 'a.bin', byteSize: 2 }));
    const ctx = createContext(undefined, () => {}, [], undefined, { hostFileRead, writeBinary } as unknown as WorkflowServices);
    const out = await readWriteFileHandler(node({ operation: 'read', path: 'a.bin' }), ctx, [{ json: {} }]);
    expect(hostFileRead).toHaveBeenCalledWith('a.bin');
    expect(out[0].binary?.file).toMatchObject({ objectKey: 'k' });
  });

  it('read (asText) → utf8 into json', async () => {
    const hostFileRead = vi.fn(async () => ({ bytes: new Uint8Array(Buffer.from('hello', 'utf8')) }));
    const ctx = createContext(undefined, () => {}, [], undefined, { hostFileRead } as unknown as WorkflowServices);
    const out = await readWriteFileHandler(node({ operation: 'read', path: 'a.txt', asText: true }), ctx, [{ json: {} }]);
    expect(out[0].json.content).toBe('hello');
  });

  it('write from textContent', async () => {
    const hostFileWrite = vi.fn(async (_p: string, _b: Uint8Array) => ({ byteSize: 5 }));
    const ctx = createContext(undefined, () => {}, [], undefined, { hostFileWrite } as unknown as WorkflowServices);
    await readWriteFileHandler(node({ operation: 'write', path: 'o.txt', textContent: 'hello' }), ctx, [{ json: {} }]);
    const [p, bytes] = hostFileWrite.mock.calls[0];
    expect(p).toBe('o.txt');
    expect(Buffer.from(bytes).toString('utf8')).toBe('hello');
  });

  it('write from a binary field via readBinary', async () => {
    const readBinary = vi.fn(async () => new Uint8Array([7, 8]));
    const hostFileWrite = vi.fn(async (_p: string, _b: Uint8Array) => ({ byteSize: 2 }));
    const ctx = createContext(undefined, () => {}, [], undefined, { readBinary, hostFileWrite } as unknown as WorkflowServices);
    await readWriteFileHandler(node({ operation: 'write', path: 'o.bin' }), ctx, [{ json: {}, binary: { file: { objectKey: 'k', contentType: 'x', byteSize: 2 } } }]);
    expect(readBinary).toHaveBeenCalledWith('k');
    expect([...hostFileWrite.mock.calls[0][1]]).toEqual([7, 8]);
  });

  it('list → entries into json', async () => {
    const hostFileList = vi.fn(async () => ({ entries: [{ name: 'a', type: 'file' as const, size: 1 }] }));
    const ctx = createContext(undefined, () => {}, [], undefined, { hostFileList } as unknown as WorkflowServices);
    const out = await readWriteFileHandler(node({ operation: 'list', path: '' }), ctx, [{ json: {} }]);
    expect(out[0].json.entries).toEqual([{ name: 'a', type: 'file', size: 1 }]);
  });

  it('delete → hostFileDelete', async () => {
    const hostFileDelete = vi.fn(async () => ({ ok: true as const }));
    const ctx = createContext(undefined, () => {}, [], undefined, { hostFileDelete } as unknown as WorkflowServices);
    await readWriteFileHandler(node({ operation: 'delete', path: 'gone.txt' }), ctx, [{ json: {} }]);
    expect(hostFileDelete).toHaveBeenCalledWith('gone.txt');
  });

  it('throws when the service is absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(readWriteFileHandler(node({ operation: 'read', path: 'a' }), ctx, [{ json: {} }])).rejects.toThrow(/requires server services/);
  });
});
