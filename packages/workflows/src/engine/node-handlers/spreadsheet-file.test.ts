import { describe, it, expect } from 'vitest';
import { spreadsheetFileHandler } from './spreadsheet-file';
import { createContext } from '../execution-context';
import { itemsToXlsx } from './file-codecs';
import type { BinaryRef } from '../items';

function fakeBinaryCtx(seed?: { key: string; bytes: Uint8Array }) {
  const store = new Map<string, Uint8Array>();
  if (seed) store.set(seed.key, seed.bytes);
  let n = 0;
  const services = {
    readBinary: async (k: string) => { const b = store.get(k); if (!b) throw new Error('nf'); return b; },
    writeBinary: async ({ bytes, fileName, contentType }: { bytes: Uint8Array; fileName: string; contentType: string }): Promise<BinaryRef> => {
      const objectKey = `workflow-artifacts/test-${n++}/${fileName}`;
      store.set(objectKey, bytes);
      return { objectKey, contentType, fileName, byteSize: bytes.byteLength };
    },
  } as unknown as import('../services').WorkflowServices;
  return { ctx: createContext(undefined, () => {}, [], undefined, services), store };
}
const ref = (objectKey: string): BinaryRef => ({ objectKey, contentType: 'x', fileName: 'f', byteSize: 1 });
const node = (cfg: Record<string, unknown>) => ({ id: 'sf1', type: 'action', data: { action: 'spreadsheet-file', config: cfg } });

describe('spreadsheetFileHandler', () => {
  it('reads an xlsx file into items', async () => {
    const bytes = itemsToXlsx([{ json: { name: 'Ann', age: 30 } }]);
    const { ctx } = fakeBinaryCtx({ key: 'k1', bytes });
    const result = await spreadsheetFileHandler(node({ operation: 'read', sourceField: 'file' }), ctx, [{ json: {}, binary: { file: ref('k1') } }]);
    expect(result).toEqual([{ json: { name: 'Ann', age: 30 } }]);
  });
  it('reads rows from every input item', async () => {
    const { ctx, store } = fakeBinaryCtx();
    store.set('k1', itemsToXlsx([{ json: { name: 'Ann' } }]));
    store.set('k2', itemsToXlsx([{ json: { name: 'Bob' } }]));
    const result = await spreadsheetFileHandler(node({ operation: 'read', sourceField: 'file' }), ctx, [
      { json: {}, binary: { file: ref('k1') } },
      { json: {}, binary: { file: ref('k2') } },
    ]);
    expect(result).toEqual([{ json: { name: 'Ann' } }, { json: { name: 'Bob' } }]);
  });
  it('writes items to an xlsx file', async () => {
    const { ctx, store } = fakeBinaryCtx();
    const result = await spreadsheetFileHandler(node({ operation: 'write', format: 'xlsx', binaryField: 'data', fileName: 'sheet.xlsx' }), ctx, [{ json: { a: 1 } }]);
    const r = (result[0].binary as Record<string, BinaryRef>).data;
    expect(r.fileName).toBe('sheet.xlsx');
    expect(store.get(r.objectKey)!.byteLength).toBeGreaterThan(0);
  });
  it('throws without services', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(spreadsheetFileHandler(node({ operation: 'read' }), ctx, [{ json: {} }])).rejects.toThrow(/requires server services/);
  });
});
