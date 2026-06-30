import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { compressionHandler } from './compression';
import { createContext } from '../execution-context';
import type { BinaryRef } from '../items';

function fakeBinaryCtx() {
  const store = new Map<string, Uint8Array>();
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
const node = (cfg: Record<string, unknown>) => ({ id: 'zp1', type: 'action', data: { action: 'compression', config: cfg } });

describe('compressionHandler', () => {
  it('zips input files into one archive', async () => {
    const { ctx, store } = fakeBinaryCtx();
    const a = await ctx.services!.writeBinary!({ bytes: new TextEncoder().encode('AAA'), fileName: 'a.txt', contentType: 'text/plain' });
    const b = await ctx.services!.writeBinary!({ bytes: new TextEncoder().encode('BBB'), fileName: 'b.txt', contentType: 'text/plain' });
    const result = await compressionHandler(node({ operation: 'zip', sourceField: 'file', binaryField: 'zip', fileName: 'out.zip' }), ctx, [
      { json: {}, binary: { file: a } },
      { json: {}, binary: { file: b } },
    ]);
    const zipRef = (result[0].binary as Record<string, BinaryRef>).zip;
    expect(zipRef.fileName).toBe('out.zip');
    const z = await JSZip.loadAsync(store.get(zipRef.objectKey)!);
    expect(Object.keys(z.files).sort()).toEqual(['a.txt', 'b.txt']);
  });
  it('unzips an archive into per-entry items', async () => {
    const { ctx, store } = fakeBinaryCtx();
    const zip = new JSZip();
    zip.file('x.txt', 'XXX');
    zip.file('y.txt', 'YYY');
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });
    const zipRef = await ctx.services!.writeBinary!({ bytes: zipBytes, fileName: 'in.zip', contentType: 'application/zip' });
    const result = await compressionHandler(node({ operation: 'unzip', sourceField: 'file' }), ctx, [{ json: {}, binary: { file: zipRef } }]);
    const names = result.map((r) => (r.json as Record<string, unknown>).fileName).sort();
    expect(names).toEqual(['x.txt', 'y.txt']);
    const firstRef = (result[0].binary as Record<string, BinaryRef>).file;
    expect(store.get(firstRef.objectKey)!.byteLength).toBeGreaterThan(0);
  });
  it('throws without services', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(compressionHandler(node({ operation: 'zip' }), ctx, [{ json: {} }])).rejects.toThrow(/requires server services/);
  });
});
