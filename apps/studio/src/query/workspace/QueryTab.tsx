// apps/studio/src/query/workspace/QueryTab.tsx
import { useEffect, useState } from 'react';
import { Play, Save, SlidersHorizontal } from 'lucide-react';
import { queryApi, type ConnectorRef, type RunResult } from '../api';
import { useQueryStore, type QueryTab as QueryTabModel } from '../store';
import { SqlEditor } from './SqlEditor';
import { ResultsGrid } from './ResultsGrid';
import { RunParamsSheet } from '../params/RunParamsSheet';
import { ParametersEditor } from '../../reports-builder/ParametersEditor';

export function QueryTab({ tab }: { tab: QueryTabModel }): JSX.Element {
  const patchQuery = useQueryStore((s) => s.patchQuery);
  const [connectors, setConnectors] = useState<ConnectorRef[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [editorFrac, setEditorFrac] = useState(0.5);

  useEffect(() => { queryApi.connectors().then(setConnectors); }, []);

  const execute = async (values: Record<string, unknown>) => {
    setError(null);
    try {
      const r = await queryApi.run({ connectorId: tab.connectorId ?? '', sql: tab.sql, params: tab.params, values });
      setResult(r);
    } catch (e) { setError((e as Error).message); }
  };

  const onRun = () => { if (tab.params.length > 0) setSheetOpen(true); else void execute({}); };

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
    <div className="flex h-full flex-col">
      <div className="flex flex-col" style={{ height: `${editorFrac * 100}%` }}>
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
        <div className="min-h-0 flex-1 border-y border-border">
          <SqlEditor value={tab.sql} onChange={(v) => patchQuery(tab.id, { sql: v, dirty: true })} onRun={onRun} />
        </div>
      </div>
      <div className="h-1 cursor-row-resize bg-border" onMouseDown={(e) => {
        const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
        const move = (ev: MouseEvent) => setEditorFrac(Math.max(0.2, Math.min(0.8, (ev.clientY - box.top) / box.height)));
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
      }} />
      <div className="min-h-0 flex-1">
        {error ? <div className="p-3 text-xs text-destructive">{error}</div>
          : <>
              {result && <div className="px-3 py-1 text-xs text-muted-foreground">{result.rowCount} rows · {result.ms}ms</div>}
              <ResultsGrid result={result} />
            </>}
      </div>
      <RunParamsSheet open={sheetOpen} onClose={() => setSheetOpen(false)} params={tab.params}
        connectorId={tab.connectorId ?? ''} onRun={(values) => { setSheetOpen(false); void execute(values); }} />
      <ParametersEditor open={paramsOpen} parameters={tab.params as never} onClose={() => setParamsOpen(false)}
        onSave={(p) => { patchQuery(tab.id, { params: p as never, dirty: true }); setParamsOpen(false); }} />
    </div>
  );
}
