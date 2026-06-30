import * as XLSX from 'xlsx';
import type { WorkflowItem } from '../items';

/** items → CSV bytes (utf8). */
export function itemsToCsv(items: WorkflowItem[]): Uint8Array {
  const ws = XLSX.utils.json_to_sheet(items.map((i) => i.json));
  return new TextEncoder().encode(XLSX.utils.sheet_to_csv(ws));
}

/** items → XLSX bytes. */
export function itemsToXlsx(items: WorkflowItem[]): Uint8Array {
  const ws = XLSX.utils.json_to_sheet(items.map((i) => i.json));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new Uint8Array(buf);
}

/** CSV/XLSX bytes → row objects (first sheet). Empty workbook → []. */
export function fileToRows(bytes: Uint8Array): Record<string, unknown>[] {
  const wb = XLSX.read(bytes, { type: 'array' });
  const first = wb.SheetNames[0];
  if (!first) return [];
  return XLSX.utils.sheet_to_json(wb.Sheets[first]) as Record<string, unknown>[];
}
