// apps/studio/src/query/workspace/TableTab.tsx
import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { queryApi, type RunResult } from '../api';
import { useQueryStore, type TableTab as TableTabModel, type DatasetTab } from '../store';
import { ResultsGrid } from './ResultsGrid';
import { SqlEditor } from './SqlEditor';
import { TablePagination } from '@/components/ui/table-pagination';

export function TableTab({ tab }: { tab: TableTabModel | DatasetTab }): JSX.Element {
  const patchTable = useQueryStore((s) => s.patchTable);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  // Dataset rows omit `ms`; table runs include it — the common shape (without `ms`) is what the grid needs.
  const [result, setResult] = useState<Omit<RunResult, 'ms'> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runToken, setRunToken] = useState(0);
  const [editorFrac, setEditorFrac] = useState(0.4);

  const isTable = tab.kind === 'table';
  // Hold the current SQL in a ref so typing in the editor doesn't re-fetch on every keystroke;
  // the grid re-runs only on Run (runToken), page or page-size change.
  const sqlRef = useRef('');
  if (isTable) sqlRef.current = tab.sql;

  // Reset to the first page when switching to a different table/dataset.
  useEffect(() => { setPage(0); }, [tab.id]);

  useEffect(() => {
    let alive = true;
    setError(null);
    const onErr = (e: unknown) => { if (alive) setError((e as Error).message); };
    if (tab.kind === 'dataset') {
      queryApi.datasetRows(tab.name).then((r) => { if (alive) setResult(r); }).catch(onErr);
    } else {
      queryApi.run({ connectorId: tab.connectorId, sql: sqlRef.current, limit: pageSize, offset: page * pageSize })
        .then((r) => { if (alive) setResult(r); }).catch(onErr);
    }
    return () => { alive = false; };
  }, [tab.id, tab.kind, page, pageSize, runToken]);

  const run = () => { setPage(0); setRunToken((x) => x + 1); };

  return (
    <div className="flex h-full min-w-0 flex-col">
      {isTable && tab.showSql && (
        <>
          <div className="flex min-w-0 flex-col" style={{ height: `${editorFrac * 100}%` }}>
            <div className="flex items-center gap-2 px-3 py-2">
              <button className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground" onClick={run}>
                <Play className="h-3.5 w-3.5" /> Run
              </button>
            </div>
            <div className="min-h-0 min-w-0 flex-1 border-y border-border">
              <SqlEditor value={tab.sql} onChange={(v) => patchTable(tab.id, { sql: v })} onRun={run} />
            </div>
          </div>
          <div className="h-1 cursor-row-resize bg-border" onMouseDown={(e) => {
            const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
            const move = (ev: MouseEvent) => setEditorFrac(Math.max(0.2, Math.min(0.8, (ev.clientY - box.top) / box.height)));
            const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
            window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
          }} />
        </>
      )}
      <div className="min-h-0 min-w-0 flex-1">
        {error ? <div className="p-3 text-xs text-destructive">{error}</div> : <ResultsGrid result={result} />}
      </div>
      {isTable && !error && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          total={result?.total ?? result?.rowCount ?? 0}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
        />
      )}
    </div>
  );
}
