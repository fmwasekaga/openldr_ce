import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listModels, runWidgetQuery, type QueryModel, type WidgetConfig, type WidgetQuery, type ReportResult } from '../../api';
import { BuilderForm } from './BuilderForm';
import { SqlForm } from './SqlForm';
import { renderWidget } from '../widgets';

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

  useEffect(() => {
    listModels()
      .then((m) => {
        setModels(m);
        if (!initial && query.mode === 'builder' && !m.find((x) => x.id === query.model)) setQuery(emptyBuilder(m[0]?.id ?? 'service_requests'));
      })
      .catch((e) => setError(String(e.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      runWidgetQuery(query)
        .then((r) => {
          setPreview(r);
          setError(undefined);
        })
        .catch((e) => setError(String(e.message ?? e)));
    }, 400);
    return () => clearTimeout(t);
  }, [JSON.stringify(query)]);

  const save = () => {
    const id = initial?.id ?? (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `w-${Math.round(performance.now())}`);
    onSave({ id, type, title, query, refreshIntervalSec: initial?.refreshIntervalSec ?? 0, visual: initial?.visual ?? {} });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[64rem] max-w-[95vw] p-6">
        <div className="mb-4">
          <DialogTitle className="text-lg font-semibold">{initial ? 'Edit widget' : 'Add widget'}</DialogTitle>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div className="flex flex-col gap-3">
            <label className="text-sm">
              Title
              <Input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
            </label>
            <label className="text-sm">
              Visualization
              <select
                aria-label="Visualization"
                className="mt-1 w-full rounded border border-border bg-background p-2"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            {sqlEnabled && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={tab === 'builder' ? 'default' : 'outline'}
                  onClick={() => {
                    setTab('builder');
                    setQuery(emptyBuilder(models[0]?.id ?? 'service_requests'));
                  }}
                >
                  Builder
                </Button>
                <Button
                  size="sm"
                  variant={tab === 'sql' ? 'default' : 'outline'}
                  onClick={() => {
                    setTab('sql');
                    setQuery({ mode: 'sql', sql: 'select 1 as value' });
                  }}
                >
                  SQL
                </Button>
              </div>
            )}
            {tab === 'builder' && query.mode === 'builder' && <BuilderForm models={models} value={query} onChange={setQuery} />}
            {tab === 'sql' && query.mode === 'sql' && <SqlForm value={query} onChange={setQuery} />}
          </div>
          <div className="flex min-h-[300px] flex-col rounded-lg border border-border p-3">
            <div className="mb-2 text-sm text-muted-foreground">Preview</div>
            {error ? (
              <div className="text-sm text-destructive">{error}</div>
            ) : preview ? (
              <div className="flex-1">{renderWidget({ id: 'preview', type, title, query, refreshIntervalSec: 0, visual: {} }, preview)}</div>
            ) : (
              <div className="text-sm text-muted-foreground">Loading…</div>
            )}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
