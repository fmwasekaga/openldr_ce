// apps/studio/src/query/workspace/TableTab.tsx
import { useEffect, useRef, useState } from 'react';
import { Play, SlidersHorizontal, Code2 } from 'lucide-react';
import { queryApi, type ConnectorRef, type RunResult } from '../api';
import { useQueryStore, type TableTab as TableTabModel, type DatasetTab } from '../store';
import { ResultsGrid } from './ResultsGrid';
import { SqlEditor } from './SqlEditor';
import { RunParamsSheet } from '../params/RunParamsSheet';
import { ParametersEditor } from '../../reports-builder/ParametersEditor';
import { TablePagination } from '@/components/ui/table-pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TooltipProvider } from '@/components/ui/tooltip';
import { StatusIcon, IconButton, Sep, type RunStatus } from './toolbar-bits';

export function TableTab({ tab }: { tab: TableTabModel | DatasetTab }): JSX.Element {
  const patchTable = useQueryStore((s) => s.patchTable);
  const [connectors, setConnectors] = useState<ConnectorRef[]>([]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  // Dataset rows omit `ms`; table runs include it — the common shape (without `ms`) is what the grid needs.
  const [result, setResult] = useState<Omit<RunResult, 'ms'> | null>(null);
  const [status, setStatus] = useState<RunStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [runToken, setRunToken] = useState(0);
  const [editorFrac, setEditorFrac] = useState(0.4);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);

  const isTable = tab.kind === 'table';
  // Hold the current SQL + param values in refs so typing doesn't re-fetch on every keystroke;
  // the grid re-runs only on Run (runToken), page, or page-size change.
  const sqlRef = useRef('');
  const valuesRef = useRef<Record<string, unknown>>({});
  if (isTable) sqlRef.current = tab.sql;

  useEffect(() => { if (isTable) queryApi.connectors().then(setConnectors); }, [isTable]);
  useEffect(() => { setPage(0); }, [tab.id]);

  useEffect(() => {
    let alive = true;
    setError(null);
    const onErr = (e: unknown) => { if (alive) { setError((e as Error).message); setStatus('error'); } };
    if (tab.kind === 'dataset') {
      queryApi.datasetRows(tab.name).then((r) => { if (alive) { setResult(r); setStatus('ok'); } }).catch(onErr);
    } else {
      queryApi.run({ connectorId: tab.connectorId, sql: sqlRef.current, params: tab.params, values: valuesRef.current, limit: pageSize, offset: page * pageSize })
        .then((r) => { if (alive) { setResult(r); setStatus('ok'); } }).catch(onErr);
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.kind, page, pageSize, runToken]);

  const rerun = () => { setPage(0); setRunToken((x) => x + 1); };
  const run = () => {
    if (!isTable) return;
    if (tab.params.length > 0) { setSheetOpen(true); return; }
    valuesRef.current = {};
    rerun();
  };

  const statusMessage = status === 'ok'
    ? `Ran successfully — ${result?.rowCount ?? 0} rows.`
    : status === 'error'
      ? (error ?? 'Query failed.')
      : 'Browsing the table. Toggle SQL to edit the query, then Run.';

  return (
    <div className="flex h-full min-w-0 flex-col">
      {isTable && (
        <TooltipProvider delayDuration={150}>
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <StatusIcon status={status} message={statusMessage} />
            <Select value={tab.connectorId} onValueChange={(v) => { patchTable(tab.id, { connectorId: v }); rerun(); }}>
              <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="Select a connector…" /></SelectTrigger>
              <SelectContent>
                {connectors.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex-1" />
            <IconButton icon={<SlidersHorizontal className="h-4 w-4" />} label="Parameters" onClick={() => setParamsOpen(true)} />
            <Sep />
            <IconButton icon={<Code2 className="h-4 w-4" />} label="SQL" active={tab.showSql} onClick={() => patchTable(tab.id, { showSql: !tab.showSql })} />
            <Sep />
            <IconButton icon={<Play className="h-4 w-4" />} label="Run" onClick={run} />
          </div>
        </TooltipProvider>
      )}

      {isTable && tab.showSql && (
        <>
          <div className="min-h-0 min-w-0 border-b border-border" style={{ height: `${editorFrac * 100}%` }}>
            <SqlEditor value={tab.sql} onChange={(v) => { patchTable(tab.id, { sql: v }); setStatus('idle'); }} onRun={run} />
          </div>
          <div className="h-1 cursor-row-resize bg-border" onMouseDown={(e) => {
            const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
            const move = (ev: MouseEvent) => setEditorFrac(Math.max(0.2, Math.min(0.8, (ev.clientY - box.top) / box.height)));
            const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
            window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
          }} />
        </>
      )}

      <div className="min-h-0 min-w-0 flex-1"><ResultsGrid result={result} /></div>

      {isTable && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          total={result?.total ?? result?.rowCount ?? 0}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
        />
      )}

      {isTable && (
        <>
          <RunParamsSheet open={sheetOpen} onClose={() => setSheetOpen(false)} params={tab.params}
            connectorId={tab.connectorId} onRun={(values) => { setSheetOpen(false); valuesRef.current = values; rerun(); }} />
          <ParametersEditor open={paramsOpen} parameters={tab.params as never} onClose={() => setParamsOpen(false)}
            onSave={(p) => { patchTable(tab.id, { params: p as never }); setParamsOpen(false); }} />
        </>
      )}
    </div>
  );
}
