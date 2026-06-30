import { describe, it, expect } from 'vitest';
import { convertToFileHandler } from './convert-to-file';
import { createContext } from '../execution-context';
import type { BinaryRef } from '../items';

function fakeBinaryCtx() {
  const store = new Map<string, Uint8Array>();
  let n = 0;
  const services = {
    writeBinary: async ({ bytes, fileName, contentType }: { bytes: Uint8Array; fileName: string; contentType: string }): Promise<BinaryRef> => {
      const objectKey = `workflow-artifacts/test-${n++}/${fileName}`;
      store.set(objectKey, bytes);
      return { objectKey, contentType, fileName, byteSize: bytes.byteLength };
    },
  } as unknown as import('../services').WorkflowServices;
  return { ctx: createContext(undefined, () => {}, [], undefined, services), store };
}
const node = (cfg: Record<string, unknown>) => ({ id: 'cf1', type: 'action', data: { action: 'convert-to-file', config: cfg } });

describe('convertToFileHandler', () => {
  it('writes json bytes and attaches a BinaryRef', async () => {
    const { ctx, store } = fakeBinaryCtx();
    const result = await convertToFileHandler(node({ format: 'json', fileName: 'out.json', binaryField: 'data' }), ctx, [{ json: { a: 1 } }, { json: { a: 2 } }]);
    const ref = (result[0].binary as Record<string, BinaryRef>).data;
    expect(ref.contentType).toBe('application/json');
    expect(JSON.parse(new TextDecoder().decode(store.get(ref.objectKey)!))).toEqual([{ a: 1 }, { a: 2 }]);
  });
  it('writes csv bytes', async () => {
    const { ctx, store } = fakeBinaryCtx();
    const result = await convertToFileHandler(node({ format: 'csv', fileName: 'out.csv', binaryField: 'data' }), ctx, [{ json: { a: 1, b: 2 } }]);
    const ref = (result[0].binary as Record<string, BinaryRef>).data;
    expect(ref.contentType).toBe('text/csv');
    expect(new TextDecoder().decode(store.get(ref.objectKey)!)).toContain('a,b');
  });
  it('throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(convertToFileHandler(node({ format: 'json' }), ctx, [{ json: {} }])).rejects.toThrow(/requires server services/);
  });
});
