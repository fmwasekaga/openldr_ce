import { useEffect, useRef, useState } from 'react';
import { runWidgetQuery, type WidgetQuery, type ReportResult } from '../api';
import type { Block, ReportTemplate } from '@openldr/report-builder/pure';

export interface BlockData { result?: ReportResult; error?: string; loading: boolean }

const TOKEN = /\{\{\s*param\.(\w+)\s*\}\}/g;
function resolve(q: WidgetQuery, params: Record<string, string>): WidgetQuery {
  const clone = JSON.parse(JSON.stringify(q)) as WidgetQuery;
  const sub = (v: unknown) => (typeof v === 'string' && v.includes('{{') ? v.replace(TOKEN, (_m, k: string) => params[k] ?? '') : v);
  if (clone.mode === 'builder') clone.filters = (clone.filters ?? []).map((f) => ({ ...f, value: sub(f.value) as never }));
  return clone;
}

// A block's runnable query, or null. table:'primary' has no own query (P3b-1 doesn't fetch the primary dataset).
function blockQuery(block: Block): WidgetQuery | null {
  if (block.kind === 'kpi' || block.kind === 'chart') return block.query;
  if (block.kind === 'table' && block.source !== 'primary') return block.source;
  return null;
}
function hasModel(q: WidgetQuery): boolean {
  return q.mode === 'sql' ? Boolean(q.sql?.trim()) : Boolean(q.model);
}

export function useBlockData(template: ReportTemplate, params: Record<string, string>): Map<string, BlockData> {
  const [data, setData] = useState<Map<string, BlockData>>(new Map());

  const wanted: { key: string; q: WidgetQuery; json: string }[] = [];
  template.rows.forEach((row, r) => row.cells.forEach((cell, c) => {
    const q = blockQuery(cell.block);
    if (q && hasModel(q)) { const rq = resolve(q, params); wanted.push({ key: `${r}:${c}`, q: rq, json: JSON.stringify(rq) }); }
  }));
  const signature = wanted.map((w) => `${w.key}=${w.json}`).join('|');

  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      let cancelled = false;
      setData((prev) => { const next = new Map(prev); for (const w of wanted) next.set(w.key, { ...next.get(w.key), loading: true }); return next; });
      const byJson = new Map<string, { key: string; q: WidgetQuery }[]>();
      for (const w of wanted) { const a = byJson.get(w.json) ?? []; a.push({ key: w.key, q: w.q }); byJson.set(w.json, a); }
      byJson.forEach((cells) => {
        runWidgetQuery(cells[0].q)
          .then((result) => { if (!cancelled) setData((prev) => { const next = new Map(prev); for (const c of cells) next.set(c.key, { result, loading: false }); return next; }); })
          .catch((e) => { if (!cancelled) setData((prev) => { const next = new Map(prev); for (const c of cells) next.set(c.key, { error: e instanceof Error ? e.message : String(e), loading: false }); return next; }); });
      });
      setData((prev) => { const keep = new Set(wanted.map((w) => w.key)); const next = new Map<string, BlockData>(); prev.forEach((v, k) => { if (keep.has(k)) next.set(k, v); }); return next; });
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return data;
}
