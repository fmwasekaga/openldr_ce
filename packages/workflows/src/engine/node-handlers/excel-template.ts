/// <reference path="../../xlsx-populate.d.ts" />
import XlsxPopulate from 'xlsx-populate';
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Column-letter for a 1-based column index (1→A, 27→AA, 74→BV). */
function colLetter(n: number): string {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function parseCell(cell: string): { col: number; row: number } {
  const m = /^([A-Za-z]+)(\d+)$/.exec(cell.trim());
  if (!m) throw new Error(`Excel Template: invalid cell reference '${cell}'`);
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

/**
 * Fill a branded xlsx template with the input rows and return it as a binary.
 * Writes rows into a range starting at `startCell` in the declared `columns`
 * order, optionally applying an autofilter over the header+data.
 */
export const excelTemplateHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.readBinary || !ctx.services.writeBinary) {
    throw new Error('Excel Template requires server services');
  }
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const templateRef = String(config.templateRef ?? '').trim();
  if (!templateRef) throw new Error('Excel Template: templateRef is required');
  const columns = Array.isArray(config.columns) ? (config.columns as string[]) : [];
  if (columns.length === 0) throw new Error('Excel Template: columns is required');
  const sheetIndex = Number(config.sheetIndex ?? 0);
  const startCell = String(config.startCell ?? 'A2');
  const binaryField = String(config.binaryField ?? 'file');
  const fileName = resolveTemplate(String(config.fileName ?? 'report.xlsx'), ctx, input);

  const tplBytes = await ctx.services.readBinary(templateRef);
  const wb = await XlsxPopulate.fromDataAsync(Buffer.from(tplBytes));
  const sheet = wb.sheet(sheetIndex);
  const start = parseCell(startCell);

  const rows = input.map((it) => columns.map((c) => {
    const v = it.json[c];
    return v === undefined || v === null ? '' : (v as string | number | boolean);
  }));

  if (rows.length > 0) {
    const endCol = colLetter(start.col + columns.length - 1);
    const endRow = start.row + rows.length - 1;
    sheet.range(`${startCell}:${endCol}${endRow}`).value(rows);
  }

  if (config.autoFilter) {
    const headerCell = String(config.autoFilter); // e.g. 'A1' — top-left of the header row
    const hdr = parseCell(headerCell);
    const endCol = colLetter(hdr.col + columns.length - 1);
    const endRow = start.row + Math.max(rows.length, 0) - 1;
    sheet.range(`${headerCell}:${endCol}${Math.max(endRow, hdr.row)}`).autoFilter();
  }

  let password: string | undefined;
  const pw = config.password as { connectorId?: string; key?: string } | undefined;
  if (pw?.connectorId && pw.key) {
    if (!ctx.services.resolveSecret) throw new Error('Excel Template: secret resolution unavailable');
    password = await ctx.services.resolveSecret({ connectorId: pw.connectorId, key: pw.key });
    if (!password) throw new Error(`Excel Template: password secret '${pw.key}' did not resolve`);
  }

  const out = (await wb.outputAsync(password ? { password } : undefined)) as Buffer;
  const ref = await ctx.services.writeBinary({ bytes: new Uint8Array(out), fileName, contentType: XLSX_CONTENT_TYPE });
  const items = input.length > 0 ? input : [{ json: {} }];
  return items.map((it, i) => (i === 0 ? { ...it, binary: { ...(it.binary ?? {}), [binaryField]: ref } } : it));
};
