import * as XLSX from 'xlsx';
import type { DesignElement, ReportDesign } from './types';
import type { CustomQuery } from '../query/custom-query-types';
import { queryApi } from '../query/api';

export interface SheetData {
  name: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
}

/** Injectable seams so the export is testable without a live API or a real download. */
export interface ExcelExportDeps {
  list(): Promise<CustomQuery[]>;
  run: typeof queryApi.run;
  write(wb: XLSX.WorkBook, filename: string): void;
}

const defaultDeps: ExcelExportDeps = {
  list: () => queryApi.list(),
  run: queryApi.run,
  write: (wb, filename) => XLSX.writeFile(wb, filename),
};

/** Map design parameters → values keyed by param.key (same contract as the preview route). */
export function paramValues(design: ReportDesign): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const p of design.parameters) if (p.value != null) values[p.key] = p.value;
  return values;
}

/** Excel sheet names must be ≤31 chars, contain none of \ / ? * [ ] :, be non-empty and unique. */
export function sheetName(raw: string, used: Set<string>): string {
  const base = raw.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Table';
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
    n += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

/** Resolve one table element to sheet data: run its bound query, or use its static columns/rows. */
async function resolveTable(
  el: DesignElement, queries: CustomQuery[], values: Record<string, unknown>, run: ExcelExportDeps['run'],
): Promise<SheetData> {
  if (el.dataSource) {
    const cq = queries.find((q) => q.id === el.dataSource!.queryId);
    if (!cq) throw new Error(`custom query not found: ${el.dataSource.queryId}`);
    const res = await run({ connectorId: cq.connectorId, sql: cq.sql, params: cq.params, values });
    const columns = el.boundColumns && el.boundColumns.length ? el.boundColumns : res.columns;
    return { name: el.name, columns, rows: res.rows };
  }
  // Unbound: the element's static columns/rows (looks-only sample data on the page).
  const columns = (el.columns ?? []).map((label, i) => ({ key: String(i), label }));
  const rows = (el.rows ?? []).map((r) => Object.fromEntries(r.map((cell, i) => [String(i), cell])));
  return { name: el.name, columns, rows };
}

/** Build a workbook with one sheet per table — a header row of column labels, then the projected rows. */
export function buildWorkbook(sheets: SheetData[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  sheets.forEach((s, i) => {
    const header = s.columns.map((c) => c.label);
    const body = s.rows.map((r) => s.columns.map((c) => r[c.key] ?? ''));
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    XLSX.utils.book_append_sheet(wb, ws, sheetName(s.name || `Table ${i + 1}`, used));
  });
  return wb;
}

/**
 * Export a design's table elements to an .xlsx (one sheet each; bound tables run their query for live
 * rows, unbound tables use their static data). Non-table elements are omitted. Returns the number of
 * tables exported — 0 means nothing was written (caller should surface "nothing to export").
 */
export async function exportDesignToExcel(design: ReportDesign, deps: ExcelExportDeps = defaultDeps): Promise<number> {
  const tables = design.pages.flatMap((p) => p.elements).filter((e) => e.kind === 'table');
  if (tables.length === 0) return 0;
  // Only fetch the query catalog when at least one table is actually bound.
  const queries = tables.some((t) => t.dataSource) ? await deps.list() : [];
  const values = paramValues(design);
  const sheets: SheetData[] = [];
  for (const el of tables) sheets.push(await resolveTable(el, queries, values, deps.run));
  const safeName = (design.name || 'report-design').replace(/[^\w.-]+/g, '_');
  deps.write(buildWorkbook(sheets), `${safeName}.xlsx`);
  return tables.length;
}
