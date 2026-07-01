import { describe, it, expect } from 'vitest';
import XlsxPopulate from 'xlsx-populate';
import { pivotHandler } from '../engine/node-handlers/pivot';
import { mergeHandler } from '../engine/node-handlers/merge';
import { excelTemplateHandler } from '../engine/node-handlers/excel-template';
import { createContext } from '../engine/execution-context';
import { AMR_ANTIBIOTICS, AMR_TEMPLATE_COLUMNS } from './amr-columns';
import type { BinaryRef } from '../engine/items';

describe('AMR Ndola pipeline (nodes composed)', () => {
  it('extract → pivot → join → template produces a filled, password-protected xlsx', async () => {
    // Stand-ins for the two portable SELECTs.
    const isolates = [{ json: { requestid: 'R1', organism: 'E.coli', cultureTestCode: 'CULUR', CultureTestDescription: 'Urine Culture', LIMSRptResult: 'E.coli', RequestID: 'R1', LIMSSpecimenSourceCode: 'UR', LIMSSpecimenSourceDesc: 'Urine', IdentificationNumber: 'H1', AccessionDate: '2026-06-02', SpecimenDate: '2026-06-01', FIRSTNAME: 'Jane', LastName: 'Doe', AgeInYears: 34, DOB: '1992-01-01', sex: 'F', LocationCode: 'W1', Location: 'Ward 1', AST_TestCode: 'SENS', AST_Test: 'Sensitivity', ORGANISM: 'E.coli' } }];
    const astLong = [
      { json: { requestid: 'R1', organism: 'E.coli', LIMSSubstanceName: 'Amikacin', ASTValue: 'S' } },
      { json: { requestid: 'R1', organism: 'E.coli', LIMSSubstanceName: 'Ampicillin', ASTValue: 'R' } },
    ];

    const ctx = createContext(undefined, () => {}, [
      { id: 'e1', source: 'isolates', target: 'join' },
      { id: 'e2', source: 'pivot', target: 'join' },
    ]);

    const pivoted = await pivotHandler(
      { id: 'pivot', type: 'action', data: { config: { groupBy: ['requestid', 'organism'], pivotColumn: 'LIMSSubstanceName', valueColumn: 'ASTValue', columns: [...AMR_ANTIBIOTICS], aggregate: 'max' } } } as any,
      ctx, astLong,
    );
    ctx.nodeOutputs = { isolates, pivot: pivoted };
    const joined = await mergeHandler(
      { id: 'join', type: 'action', data: { config: { mode: 'combineByKey', joinKeys: ['requestid', 'organism'], joinType: 'left' } } } as any,
      ctx, [],
    );
    expect(joined[0].json.Amikacin).toBe('S');
    expect(joined[0].json.Ampicillin).toBe('R');

    // Build a template with the header row, then fill it.
    const tpl = await XlsxPopulate.fromBlankAsync();
    AMR_TEMPLATE_COLUMNS.forEach((h, i) => tpl.sheet(0).cell(1, i + 1).value(h));
    const tplBytes = new Uint8Array(await tpl.outputAsync() as ArrayBuffer);
    const store = new Map<string, Uint8Array>([['tpl', tplBytes]]);
    let n = 0;
    (ctx as any).services = {
      readBinary: async (k: string) => store.get(k)!,
      writeBinary: async ({ bytes, fileName, contentType }: any) => { const objectKey = `a/${n++}/${fileName}`; store.set(objectKey, bytes); return { objectKey, contentType, fileName, byteSize: bytes.byteLength }; },
      resolveSecret: async () => 'Micro!',
    };
    const out = await excelTemplateHandler(
      { id: 'xt', type: 'action', data: { config: { templateRef: 'tpl', startCell: 'A2', columns: [...AMR_TEMPLATE_COLUMNS], autoFilter: 'A1', fileName: 'amr.xlsx', password: { connectorId: 'c', key: 'amr_pw' } } } } as any,
      ctx, joined,
    );
    const ref = (out[0].binary as Record<string, BinaryRef>).file;
    const wb = await XlsxPopulate.fromDataAsync(Buffer.from(store.get(ref.objectKey)!), { password: 'Micro!' });
    expect(wb.sheet(0).cell('A2').value()).toBe('CULUR'); // first template column filled
  });
});
