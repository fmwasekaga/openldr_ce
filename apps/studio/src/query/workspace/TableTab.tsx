// apps/studio/src/query/workspace/TableTab.tsx
import { useEffect, useState } from 'react';
import { Code2 } from 'lucide-react';
import { queryApi, type RunResult } from '../api';
import { useQueryStore, type TableTab as TableTabModel, type DatasetTab } from '../store';
import { ResultsGrid } from './ResultsGrid';

const PAGE = 50;

export function TableTab({ tab }: { tab: TableTabModel | DatasetTab }): JSX.Element {
  const openQueryTab = useQueryStore((s) => s.openQueryTab);
  const [page, setPage] = useState(0);
  // Dataset rows omit `ms`; table runs include it — the common shape (without `ms`) is what the grid needs.
  const [result, setResult] = useState<Omit<RunResult, 'ms'> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    const onErr = (e: unknown) => { if (alive) setError((e as Error).message); };
    if (tab.kind === 'dataset') {
      queryApi.datasetRows(tab.name).then((r) => { if (alive) setResult(r); }).catch(onErr);
    } else {
      const sql = `select * from "${tab.schema}"."${tab.table}"`;
      queryApi.run({ connectorId: tab.connectorId, sql, limit: PAGE, offset: page * PAGE }).then((r) => { if (alive) setResult(r); }).catch(onErr);
    }
    return () => { alive = false; };
  }, [tab, page]);

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Slim toolbar only for tables (the tab bar already names the table); datasets get an
          edge-to-edge grid with no header band. */}
      {tab.kind === 'table' && (
        <div className="flex items-center border-b border-border px-2 py-1">
          <button className="ml-auto flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground"
            onClick={() => openQueryTab({ connectorId: tab.connectorId, sql: `select * from "${tab.schema}"."${tab.table}"` })}>
            <Code2 className="h-3.5 w-3.5" /> SQL
          </button>
        </div>
      )}
      <div className="min-h-0 min-w-0 flex-1">
        {error ? <div className="p-3 text-xs text-destructive">{error}</div> : <ResultsGrid result={result} />}
      </div>
      {tab.kind === 'table' && (
        <div className="flex items-center gap-3 border-t border-border px-3 py-1 text-xs text-muted-foreground">
          <span>page {page + 1}</span>
          <button className="ml-auto disabled:opacity-40" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>
          <button disabled={(result?.rowCount ?? 0) < PAGE} onClick={() => setPage((p) => p + 1)}>Next ›</button>
        </div>
      )}
    </div>
  );
}
