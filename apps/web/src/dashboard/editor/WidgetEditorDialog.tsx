import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Play } from 'lucide-react';
import { listModels, runWidgetQuery, type QueryModel, type WidgetConfig, type WidgetQuery, type ReportResult } from '../../api';
import { BuilderForm } from './BuilderForm';
import { SqlForm } from './SqlForm';
import { renderWidget } from '../widgets';
import { TableWidget } from '../widgets/TableWidget';

const TYPES = ['kpi', 'line-chart', 'bar-chart', 'area-chart', 'row-chart', 'pie-chart', 'scatter-plot', 'funnel', 'progress-bar', 'gauge', 'table', 'traffic-light'];
const emptyBuilder = (model: string): WidgetQuery => ({ mode: 'builder', model, metric: { key: 'count', agg: 'count' }, filters: [] });

export function WidgetEditorDialog({
  open,
  initial,
  sqlEnabled,
  onClose,
  onSave,
}: {
  open: boolean;
  initial?: WidgetConfig;
  sqlEnabled: boolean;
  onClose: () => void;
  onSave: (w: WidgetConfig) => void;
}) {
  const [models, setModels] = useState<QueryModel[]>([]);
  const [title, setTitle] = useState(initial?.title ?? 'New widget');
  const [type, setType] = useState(initial?.type ?? 'kpi');
  const [tab, setTab] = useState<'builder' | 'sql'>(initial?.query.mode ?? 'builder');
  const [query, setQuery] = useState<WidgetQuery>(initial?.query ?? emptyBuilder('service_requests'));
  const [preview, setPreview] = useState<ReportResult>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);

  const runQuery = (q: WidgetQuery) => {
    setRunning(true);
    runWidgetQuery(q)
      .then((r) => {
        setPreview(r);
        setError(undefined);
      })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setRunning(false));
  };

  useEffect(() => {
    listModels()
      .then((m) => {
        setModels(m);
        if (!initial && query.mode === 'builder' && !m.find((x) => x.id === query.model)) setQuery(emptyBuilder(m[0]?.id ?? 'service_requests'));
      })
      .catch((e) => setError(String(e.message ?? e)));
    // Editing an existing SQL widget: run once so the preview/results populate.
    if (initial?.query.mode === 'sql') runQuery(initial.query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Builder mode auto-runs on each discrete change; SQL runs only on explicit Run.
  useEffect(() => {
    if (query.mode !== 'builder') return;
    const t = setTimeout(() => runQuery(query), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query)]);

  const save = () => {
    const id = initial?.id ?? (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `w-${Math.round(performance.now())}`);
    onSave({ id, type, title, query, refreshIntervalSec: initial?.refreshIntervalSec ?? 0, visual: initial?.visual ?? {} });
  };

  const previewConfig: WidgetConfig = { id: 'preview', type, title, query, refreshIntervalSec: 0, visual: {} };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex h-[92vh] w-[95vw] max-w-[95vw] flex-col p-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <DialogTitle className="text-base font-semibold">{initial ? 'Edit widget' : 'Add widget'}</DialogTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={save}>
              Save
            </Button>
          </div>
        </div>

        {/* Top half: query editor (left) + chart preview (right) */}
        <div className="flex h-1/2 min-h-0 gap-3 p-3">
          <div className="flex min-w-0 flex-[3] flex-col rounded-md border border-border">
            <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
              {sqlEnabled ? (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={tab === 'builder' ? 'default' : 'ghost'}
                    onClick={() => {
                      const q = emptyBuilder(models[0]?.id ?? 'service_requests');
                      setTab('builder');
                      setQuery(q);
                    }}
                  >
                    Builder
                  </Button>
                  <Button
                    size="sm"
                    variant={tab === 'sql' ? 'default' : 'ghost'}
                    onClick={() => {
                      const q: WidgetQuery = { mode: 'sql', sql: 'select 1 as value' };
                      setTab('sql');
                      setQuery(q);
                      runQuery(q);
                    }}
                  >
                    SQL
                  </Button>
                </div>
              ) : (
                <span className="text-sm font-medium">Query</span>
              )}
              <div className="ml-auto flex items-center gap-2">
                {preview && <span className="text-[11px] tabular-nums text-muted-foreground">{preview.rows.length.toLocaleString()} rows</span>}
                <Button size="sm" variant="outline" onClick={() => runQuery(query)} disabled={running}>
                  <Play className="mr-1 h-3.5 w-3.5" />
                  Run
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {tab === 'builder' && query.mode === 'builder' && <BuilderForm models={models} value={query} onChange={setQuery} />}
              {tab === 'sql' && query.mode === 'sql' && <SqlForm value={query} onChange={setQuery} />}
            </div>
          </div>
          <div className="flex min-w-0 flex-[2] flex-col rounded-md border border-border p-3">
            <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Preview</div>
            <div className="min-h-0 flex-1">
              {error ? (
                <div className="text-sm text-destructive">{error}</div>
              ) : preview ? (
                renderWidget(previewConfig, preview)
              ) : (
                <div className="text-sm text-muted-foreground">Run a query to preview.</div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom half: results table (left) + config (right) */}
        <div className="flex h-1/2 min-h-0 gap-3 px-3 pb-3">
          <div className="flex min-w-0 flex-[3] flex-col overflow-auto rounded-md border border-border">
            {preview && preview.rows.length ? (
              <TableWidget result={preview} />
            ) : (
              <div className="p-3 text-sm text-muted-foreground">Run a query to see results.</div>
            )}
          </div>
          <div className="flex min-w-0 flex-[2] flex-col gap-3 overflow-y-auto rounded-md border border-border p-3">
            <label className="text-sm">
              Title
              <Input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
            </label>
            <label className="text-sm">
              Visualization
              <Select value={type} onValueChange={setType}>
                <SelectTrigger aria-label="Visualization" className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
