import { describe, it, expect } from 'vitest';
import { extractFromFileHandler } from './extract-from-file';
import { createContext } from '../execution-context';
import type { BinaryRef } from '../items';

function fakeCtxWith(objectKey: string, bytes: Uint8Array) {
  const store = new Map<string, Uint8Array>([[objectKey, bytes]]);
  const services = {
    readBinary: async (k: string) => { const b = store.get(k); if (!b) throw new Error('not found'); return b; },
  } as unknown as import('../services').WorkflowServices;
  return createContext(undefined, () => {}, [], undefined, services);
}
const ref = (objectKey: string): BinaryRef => ({ objectKey, contentType: 'application/octet-stream', fileName: 'f', byteSize: 1 });
const node = (cfg: Record<string, unknown>) => ({ id: 'ef1', type: 'action', data: { action: 'extract-from-file', config: cfg } });

describe('extractFromFileHandler', () => {
  it('parses a JSON array file into items', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify([{ a: 1 }, { a: 2 }]));
    const ctx = fakeCtxWith('k1', bytes);
    const result = await extractFromFileHandler(node({ format: 'json', sourceField: 'file' }), ctx, [{ json: {}, binary: { file: ref('k1') } }]);
    expect(result).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
  });
  it('parses a CSV file into items', async () => {
    const bytes = new TextEncoder().encode('a,b\n1,x\n2,y\n');
    const ctx = fakeCtxWith('k2', bytes);
    const result = await extractFromFileHandler(node({ format: 'csv', sourceField: 'file' }), ctx, [{ json: {}, binary: { file: ref('k2') } }]);
    expect(result).toEqual([{ json: { a: 1, b: 'x' } }, { json: { a: 2, b: 'y' } }]);
  });
  it('wraps text content under a field', async () => {
    const bytes = new TextEncoder().encode('hello world');
    const ctx = fakeCtxWith('k3', bytes);
    const result = await extractFromFileHandler(node({ format: 'text', sourceField: 'file', outputField: 'content' }), ctx, [{ json: {}, binary: { file: ref('k3') } }]);
    expect(result).toEqual([{ json: { content: 'hello world' } }]);
  });
  it('throws a clear error when the input item has no file', async () => {
    const ctx = fakeCtxWith('k4', new Uint8Array());
    await expect(extractFromFileHandler(node({ format: 'json', sourceField: 'file' }), ctx, [{ json: {} }])).rejects.toThrow(/no file/);
  });
});
