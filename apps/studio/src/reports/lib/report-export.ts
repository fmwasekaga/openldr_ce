import * as XLSX from 'xlsx';
import type { ReportColumn } from '../../api';

/** Pure: shape rows into label-keyed objects (column order preserved). Testable. */
export function buildExportRows(
  columns: ReportColumn[],
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.map((r) =>
    Object.fromEntries(columns.map((c) => [c.label, r[c.key] ?? ''])),
  );
}

/** Triggers a client-side XLSX download of the given (already filtered) rows. */
export function exportXlsx(
  fileName: string,
  columns: ReportColumn[],
  rows: Record<string, unknown>[],
): void {
  const ws = XLSX.utils.json_to_sheet(buildExportRows(columns, rows));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}
