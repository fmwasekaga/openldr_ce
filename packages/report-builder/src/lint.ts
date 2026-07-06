import type { WidgetQuery } from '@openldr/dashboards';
import type { Block, ReportTemplate } from './schema';

export type ReportLintSeverity = 'error' | 'warning';
export interface ReportLintIssue {
  severity: ReportLintSeverity;
  code: 'empty-name' | 'empty-query' | 'unbound-sql-var' | 'orphaned-param-ref' | 'duplicate-param-id' | 'unused-parameter' | 'empty-report';
  message: string;
  rowIndex?: number;
  cellIndex?: number;
  paramId?: string;
}

const PARAM_TOKEN = /\{\{\s*param\.(\w+)\s*\}\}/g;
const VAR_TOKEN = /\{\{(\w+)\}\}/g;

function isDataBlock(b: Block): boolean {
  return b.kind === 'kpi' || b.kind === 'chart' || b.kind === 'table';
}
// The runnable query for a data block (kpi/chart carry `query`; table carries `source` unless 'primary').
function dataQuery(b: Block): WidgetQuery | null {
  if (b.kind === 'kpi' || b.kind === 'chart') return b.query;
  if (b.kind === 'table') return b.source === 'primary' ? null : b.source;
  return null;
}
// Collect {{param.<id>}} ids referenced by a query's builder filter values or sql `values`.
function paramRefs(q: WidgetQuery): string[] {
  const ids: string[] = [];
  const scan = (v: unknown) => {
    if (typeof v !== 'string') return;
    PARAM_TOKEN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PARAM_TOKEN.exec(v))) ids.push(m[1]);
  };
  if (q.mode === 'builder') for (const f of q.filters ?? []) scan(f.value);
  else if (q.values) for (const v of Object.values(q.values)) scan(v);
  if (q.mode === 'builder' && (q as { filterTree?: unknown }).filterTree) {
    const walk = (node: any) => {
      if (node.kind === 'rule') scan(node.value);
      else for (const c of node.children) walk(c);
    };
    walk((q as any).filterTree);
  }
  return ids;
}

export function lintReportTemplate(t: ReportTemplate): ReportLintIssue[] {
  const issues: ReportLintIssue[] = [];
  const definedSet = new Set(t.parameters.map((p) => p.id));
  const usedParamIds = new Set<string>();

  // A `daterange` param populates fixed `from`/`to` value keys at runtime (ParamValuesBar),
  // so filters bind {{param.from}}/{{param.to}} rather than {{param.<id>}}.
  const dateRangeParamIds = t.parameters.filter((p) => p.type === 'daterange').map((p) => p.id);
  const providedKeys = new Set<string>(dateRangeParamIds.length ? ['from', 'to'] : []);

  if (t.name.trim() === '') issues.push({ severity: 'error', code: 'empty-name', message: 'Report has no name' });

  let dataBlocks = 0;
  const consumeRefs = (q: WidgetQuery, loc?: { rowIndex: number; cellIndex: number }) => {
    for (const id of paramRefs(q)) {
      if (providedKeys.has(id)) { for (const dp of dateRangeParamIds) usedParamIds.add(dp); continue; }
      usedParamIds.add(id);
      if (!definedSet.has(id)) issues.push({ severity: 'error', code: 'orphaned-param-ref', message: `References parameter "${id}" which is not defined`, ...loc });
    }
  };

  t.rows.forEach((row, r) => row.cells.forEach((cell, c) => {
    const block = cell.block;
    if (!isDataBlock(block)) return;
    dataBlocks++;
    const loc = { rowIndex: r, cellIndex: c };
    if (block.kind === 'table' && block.source === 'primary') {
      if (!t.dataset) issues.push({ severity: 'error', code: 'empty-query', message: 'Table uses the primary dataset but none is configured', ...loc });
      return;
    }
    const q = dataQuery(block);
    if (!q) return;
    const empty = q.mode === 'builder' ? !q.model : !q.sql?.trim();
    if (empty) { issues.push({ severity: 'error', code: 'empty-query', message: 'Data block has no query configured', ...loc }); return; }
    if (q.mode === 'sql') {
      const values = q.values ?? {};
      const seen = new Set<string>();
      VAR_TOKEN.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = VAR_TOKEN.exec(q.sql))) {
        const name = m[1];
        if (!seen.has(name) && !(name in values)) { seen.add(name); issues.push({ severity: 'error', code: 'unbound-sql-var', message: `SQL variable {{${name}}} is not bound to a parameter`, ...loc }); }
      }
    }
    consumeRefs(q, loc);
  }));

  if (t.dataset) consumeRefs(t.dataset);

  const seenIds = new Set<string>();
  for (const p of t.parameters) {
    if (seenIds.has(p.id)) issues.push({ severity: 'error', code: 'duplicate-param-id', message: `Duplicate parameter id "${p.id}"`, paramId: p.id });
    else seenIds.add(p.id);
  }
  for (const p of t.parameters) {
    if (!usedParamIds.has(p.id)) issues.push({ severity: 'warning', code: 'unused-parameter', message: `Parameter "${p.id}" is defined but never used`, paramId: p.id });
  }
  if (dataBlocks === 0) issues.push({ severity: 'warning', code: 'empty-report', message: 'Report has no data blocks' });

  return issues;
}
