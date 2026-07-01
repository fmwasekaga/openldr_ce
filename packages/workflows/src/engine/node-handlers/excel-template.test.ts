import { describe, it, expect } from 'vitest';
import XlsxPopulate from 'xlsx-populate';
import { excelTemplateHandler } from './excel-template';
import { createContext } from '../execution-context';
import type { BinaryRef } from '../items';

async function blankTemplateBytes(): Promise<Uint8Array> {
  const wb = await XlsxPopulate.fromBlankAsync();
  wb.sheet(0).cell('A1').value('Province'); // a header row to preserve
  wb.sheet(0).cell('B1').value('Count');
  return new Uint8Array(await wb.outputAsync() as ArrayBuffer);
}

function fakeCtx(templateKey: string, templateBytes: Uint8Array) {
  const store = new Map<string, Uint8Array>([[templateKey, templateBytes]]);
  let n = 0;
  const services = {
    readBinary: async (k: string) => { const b = store.get(k); if (!b) throw new Error('nf'); return b; },
    writeBinary: async ({ bytes, fileName, contentType }: { bytes: Uint8Array; fileName: string; contentType: string }): Promise<BinaryRef> => {
      const objectKey = `workflow-artifacts/t-${n++}/${fileName}`;
      store.set(objectKey, bytes);
      return { objectKey, contentType, fileName, byteSize: bytes.byteLength };
    },
  } as unknown as import('../services').WorkflowServices;
  return { ctx: createContext(undefined, () => {}, [], undefined, services), store };
}

const node = (cfg: Record<string, unknown>) => ({ id: 'xt1', type: 'action', data: { action: 'excel-template', config: cfg } });

describe('excelTemplateHandler', () => {
  it('fills the template range in declared column order and returns a binary', async () => {
    const tpl = await blankTemplateBytes();
    const { ctx, store } = fakeCtx('tpl-key', tpl);
    const input = [
      { json: { Province: 'Lusaka', Count: 5 } },
      { json: { Province: 'Ndola', Count: 3 } },
    ];
    const out = await excelTemplateHandler(
      node({ templateRef: 'tpl-key', startCell: 'A2', columns: ['Province', 'Count'], fileName: 'report.xlsx', binaryField: 'file' }),
      ctx, input,
    );
    const ref = (out[0].binary as Record<string, BinaryRef>).file;
    expect(ref.fileName).toBe('report.xlsx');
    const wb = await XlsxPopulate.fromDataAsync(Buffer.from(store.get(ref.objectKey)!));
    expect(wb.sheet(0).cell('A2').value()).toBe('Lusaka');
    expect(wb.sheet(0).cell('B3').value()).toBe(3);
    expect(wb.sheet(0).cell('A1').value()).toBe('Province'); // header preserved
  });

  it('throws without services', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(excelTemplateHandler(node({ templateRef: 'k', columns: ['a'] }), ctx, [{ json: {} }]))
      .rejects.toThrow(/requires server services/);
  });

  it('throws when templateRef is missing', async () => {
    const { ctx } = fakeCtx('tpl-key', await blankTemplateBytes());
    await expect(excelTemplateHandler(node({ columns: ['a'] }), ctx, [{ json: {} }]))
      .rejects.toThrow(/templateRef is required/);
  });
});
