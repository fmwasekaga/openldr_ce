// apps/studio/src/query/workspace/QueryTab.tsx
import { useEffect, useState } from 'react';
import { Play, Save, SlidersHorizontal } from 'lucide-react';
import { queryApi, type ConnectorRef, type RunResult } from '../api';
import { useQueryStore, type QueryTab as QueryTabModel } from '../store';
import { SqlEditor } from './SqlEditor';
import { ResultsGrid } from './ResultsGrid';
import { RunParamsSheet } from '../params/RunParamsSheet';
import { ParametersEditor } from '../../reports-builder/ParametersEditor';
import { TablePagination } from '@/components/ui/table-pagination';

export function QueryTab({ tab }: { tab: QueryTabModel }): JSX.Element {
  const patchQuery = useQueryStore((s) => s.patchQuery);
  const [connectors, setConnectors] = useState<ConnectorRef[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [editorFrac, setEditorFrac] = useState(0.5);
  // Paging over the (potentially large) result set. Remember the last-used param values so page
  // changes re-run the same query for the next slice.
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [lastValues, setLastValues] = useState<Record<string, unknown>>({});

  useEffect(() => { queryApi.connectors().then(setConnectors); }, []);

  const execute = async (values: Record<string, unknown>, p = 0, size = pageSize) => {
    setError(null); setLastValues(values); setPage(p);
    try {
      const r = await queryApi.run({ connectorId: tab.connectorId ?? '', sql: tab.sql, params: tab.params, values, limit: size, offset: p * size });
      setResult(r);
    } catch (e) { setError((e as Error).message); }
  };

  const onRun = () => { if (tab.params.length > 0) setSheetOpen(true); else void execute({}, 0); };

  const save = async () => {
    setError(null);
    const input = { name: tab.title, connectorId: tab.connectorId ?? '', sql: tab.sql, params: tab.params };
    try {
      if (tab.customQueryId) await queryApi.update(tab.customQueryId, input);
      else { const { id } = await queryApi.create(input); patchQuery(tab.id, { customQueryId: id }); }
      patchQuery(tab.id, { dirty: false });
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex min-w-0 flex-col" style={{ height: `${editorFrac * 100}%` }}>
        <div className="flex items-center gap-2 px-3 py-2">
          <button className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground" onClick={onRun}>
            <Play className="h-3.5 w-3.5" /> Run
          </button>
          <button className="flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs" onClick={save}>
            <Save className="h-3.5 w-3.5" /> Save
          </button>
          <button className="flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs" onClick={() => setParamsOpen(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> Parameters
          </button>
          <select className="ml-auto rounded border border-border bg-background px-2 py-1 text-xs" value={tab.connectorId ?? ''}
            onChange={(e) => patchQuery(tab.id, { connectorId: e.target.value, dirty: true })}>
            <option value="" disabled>connector…</option>
            {connectors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="min-h-0 min-w-0 flex-1 border-y border-border">
          <SqlEditor value={tab.sql} onChange={(v) => patchQuery(tab.id, { sql: v, dirty: true })} onRun={onRun} />
        </div>
      </div>
      <div className="h-1 cursor-row-resize bg-border" onMouseDown={(e) => {
        const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
        const move = (ev: MouseEvent) => setEditorFrac(Math.max(0.2, Math.min(0.8, (ev.clientY - box.top) / box.height)));
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
      }} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {error ? <div className="p-3 text-xs text-destructive">{error}</div>
          : <>
              <div className="min-h-0 min-w-0 flex-1"><ResultsGrid result={result} /></div>
              {result && (
                <TablePagination
                  page={page}
                  pageSize={pageSize}
                  total={result.total ?? result.rowCount}
                  onPageChange={(p) => void execute(lastValues, p)}
                  onPageSizeChange={(n) => { setPageSize(n); void execute(lastValues, 0, n); }}
                  leftSlot={<span className="text-muted-foreground">{result.rowCount} rows · {result.ms}ms</span>}
                />
              )}
            </>}
      </div>
      <RunParamsSheet open={sheetOpen} onClose={() => setSheetOpen(false)} params={tab.params}
        connectorId={tab.connectorId ?? ''} onRun={(values) => { setSheetOpen(false); void execute(values, 0); }} />
      <ParametersEditor open={paramsOpen} parameters={tab.params as never} onClose={() => setParamsOpen(false)}
        onSave={(p) => { patchQuery(tab.id, { params: p as never, dirty: true }); setParamsOpen(false); }} />
    </div>
  );
}
