// apps/studio/src/query/workspace/QueryTab.tsx
import { useEffect, useState, type ReactNode } from 'react';
import { Play, Save, SlidersHorizontal, Info, CheckCircle2, AlertCircle } from 'lucide-react';
import { queryApi, type ConnectorRef, type RunResult } from '../api';
import { useQueryStore, type QueryTab as QueryTabModel } from '../store';
import { SqlEditor } from './SqlEditor';
import { ResultsGrid } from './ResultsGrid';
import { RunParamsSheet } from '../params/RunParamsSheet';
import { ParametersEditor } from '../../reports-builder/ParametersEditor';
import { TablePagination } from '@/components/ui/table-pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type RunStatus = 'idle' | 'ok' | 'error';

function StatusIcon({ status, message }: { status: RunStatus; message: string }): JSX.Element {
  const icon = status === 'ok'
    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
    : status === 'error'
      ? <AlertCircle className="h-4 w-4 text-destructive" />
      : <Info className="h-4 w-4 text-muted-foreground" />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center" aria-label="run status" role="status">{icon}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-sm break-words">{message}</TooltipContent>
    </Tooltip>
  );
}

/** Ghost icon-only button with a tooltip label. */
function IconButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick(): void }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button aria-label={label} onClick={onClick}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function Sep(): JSX.Element {
  return <div className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

export function QueryTab({ tab }: { tab: QueryTabModel }): JSX.Element {
  const patchQuery = useQueryStore((s) => s.patchQuery);
  const [connectors, setConnectors] = useState<ConnectorRef[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [status, setStatus] = useState<RunStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [editorFrac, setEditorFrac] = useState(0.5);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [lastValues, setLastValues] = useState<Record<string, unknown>>({});

  useEffect(() => { queryApi.connectors().then(setConnectors); }, []);

  const execute = async (values: Record<string, unknown>, p = 0, size = pageSize) => {
    if (!tab.connectorId) { setStatus('error'); setError('Select a connector first.'); return; }
    if (!tab.sql.trim()) { setStatus('error'); setError('Write a query in the editor, then Run.'); return; }
    setError(null); setLastValues(values); setPage(p);
    try {
      const r = await queryApi.run({ connectorId: tab.connectorId, sql: tab.sql, params: tab.params, values, limit: size, offset: p * size });
      setResult(r); setStatus('ok');
    } catch (e) { setStatus('error'); setError((e as Error).message); }
  };

  const onRun = () => { if (tab.params.length > 0) setSheetOpen(true); else void execute({}, 0); };

  const save = async () => {
    const input = { name: tab.title, connectorId: tab.connectorId ?? '', sql: tab.sql, params: tab.params };
    try {
      if (tab.customQueryId) await queryApi.update(tab.customQueryId, input);
      else { const { id } = await queryApi.create(input); patchQuery(tab.id, { customQueryId: id }); }
      patchQuery(tab.id, { dirty: false });
    } catch (e) { setStatus('error'); setError((e as Error).message); }
  };

  const statusMessage = status === 'ok'
    ? `Ran successfully — ${result?.rowCount ?? 0} rows.`
    : status === 'error'
      ? (error ?? 'Query failed.')
      : 'Write a query in the editor, then Run.';

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex min-w-0 flex-col" style={{ height: `${editorFrac * 100}%` }}>
        <TooltipProvider delayDuration={150}>
          <div className="flex items-center gap-2 px-3 py-2">
            <StatusIcon status={status} message={statusMessage} />
            <Select value={tab.connectorId ?? ''} onValueChange={(v) => patchQuery(tab.id, { connectorId: v, dirty: true })}>
              <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="Select a connector…" /></SelectTrigger>
              <SelectContent>
                {connectors.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex-1" />
            <IconButton icon={<SlidersHorizontal className="h-4 w-4" />} label="Parameters" onClick={() => setParamsOpen(true)} />
            <Sep />
            <IconButton icon={<Save className="h-4 w-4" />} label="Save" onClick={save} />
            <Sep />
            <IconButton icon={<Play className="h-4 w-4" />} label="Run" onClick={onRun} />
          </div>
        </TooltipProvider>
        <div className="min-h-0 min-w-0 flex-1 border-y border-border">
          <SqlEditor value={tab.sql} onChange={(v) => { patchQuery(tab.id, { sql: v, dirty: true }); setStatus('idle'); }} onRun={onRun} />
        </div>
      </div>
      <div className="h-1 cursor-row-resize bg-border" onMouseDown={(e) => {
        const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
        const move = (ev: MouseEvent) => setEditorFrac(Math.max(0.2, Math.min(0.8, (ev.clientY - box.top) / box.height)));
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
      }} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
      </div>
      <RunParamsSheet open={sheetOpen} onClose={() => setSheetOpen(false)} params={tab.params}
        connectorId={tab.connectorId ?? ''} onRun={(values) => { setSheetOpen(false); void execute(values, 0); }} />
      <ParametersEditor open={paramsOpen} parameters={tab.params as never} onClose={() => setParamsOpen(false)}
        onSave={(p) => { patchQuery(tab.id, { params: p as never, dirty: true }); setParamsOpen(false); }} />
    </div>
  );
}
