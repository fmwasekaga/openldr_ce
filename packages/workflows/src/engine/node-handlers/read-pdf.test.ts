import { describe, it, expect, vi } from 'vitest';

// Mock pdf-parse: echo the input bytes as text, fixed page count. (vi.mock is hoisted; factory uses no outer vars.)
vi.mock('pdf-parse/lib/pdf-parse.js', () => ({
  default: async (buf: Buffer) => ({ text: Buffer.from(buf).toString('utf8'), numpages: 3 }),
}));

import { readPdfHandler } from './read-pdf';
import { createContext } from '../execution-context';
import type { BinaryRef } from '../items';

function fakeCtx(objectKey: string, bytes: Uint8Array) {
  const store = new Map<string, Uint8Array>([[objectKey, bytes]]);
  const services = { readBinary: async (k: string) => { const b = store.get(k); if (!b) throw new Error('nf'); return b; } } as unknown as import('../services').WorkflowServices;
  return createContext(undefined, () => {}, [], undefined, services);
}
const ref = (objectKey: string): BinaryRef => ({ objectKey, contentType: 'application/pdf', fileName: 'f.pdf', byteSize: 1 });
const node = (cfg: Record<string, unknown>) => ({ id: 'pd1', type: 'action', data: { action: 'read-pdf', config: cfg } });

describe('readPdfHandler', () => {
  it('reads the file and maps extracted text + page count onto the item', async () => {
    const ctx = fakeCtx('k1', new TextEncoder().encode('Hello PDF'));
    const result = await readPdfHandler(node({ sourceField: 'file', outputField: 'text' }), ctx, [{ json: { keep: 1 }, binary: { file: ref('k1') } }]);
    const json = result[0].json as Record<string, unknown>;
    expect(json.text).toBe('Hello PDF');
    expect(json.numPages).toBe(3);
    expect(json.keep).toBe(1); // preserves existing json
  });
  it('throws when no file is present', async () => {
    const ctx = fakeCtx('k2', new Uint8Array());
    await expect(readPdfHandler(node({ sourceField: 'file' }), ctx, [{ json: {} }])).rejects.toThrow(/no file/);
  });
  it('throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(readPdfHandler(node({ sourceField: 'file' }), ctx, [{ json: {}, binary: { file: ref('k') } }])).rejects.toThrow(/requires server services/);
  });
});
