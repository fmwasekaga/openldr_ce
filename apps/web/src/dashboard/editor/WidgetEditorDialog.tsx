import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorView } from '@codemirror/view';
import { sql as sqlLang } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { basicSetup } from 'codemirror';
import { Play, MoreHorizontal, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  listModels,
  runWidgetQuery,
  type QueryModel,
  type DashboardFilterDef,
  type WidgetConfig,
  type WidgetQuery,
  type ReportResult,
} from '../../api';
import { renderWidget } from '../widgets';

const WIDGET_TYPES: { value: string; label: string }[] = [
  { value: 'kpi', label: 'Number' },
  { value: 'line-chart', label: 'Line' },
  { value: 'bar-chart', label: 'Bar' },
  { value: 'area-chart', label: 'Area' },
  { value: 'row-chart', label: 'Row' },
  { value: 'pie-chart', label: 'Pie' },
  { value: 'scatter-plot', label: 'Scatter' },
  { value: 'funnel', label: 'Funnel' },
  { value: 'progress-bar', label: 'Progress' },
  { value: 'gauge', label: 'Gauge' },
  { value: 'table', label: 'Table' },
  { value: 'traffic-light', label: 'Traffic Light' },
];

type Visual = Record<string, unknown>;

function extractVariables(s: string): string[] {
  const m = s.match(/\{\{(\w+)\}\}/g);
  return m ? [...new Set(m.map((x) => x.slice(2, -2)))] : [];
}

/** Replace {{var}} with a quoted test value (or NULL) so a parameterised query can preview. */
function substituteVars(s: string, vals: Record<string, string>): string {
  return s.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    const v = vals[name];
    return v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
  });
}

/** Label-over-control row for the config panel. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ColumnSelect({ label, value, columns, onChange }: { label: string; value: string; columns: string[]; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {columns.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function ConfigPanel({
  widgetType,
  columns,
  visual,
  onVisualChange,
  xKey,
  yKey,
}: {
  widgetType: string;
  columns: string[];
  visual: Visual;
  onVisualChange: (v: Visual) => void;
  xKey: string;
  yKey: string;
}) {
  const hasXY = ['bar-chart', 'row-chart', 'line-chart', 'area-chart', 'pie-chart', 'funnel', 'scatter-plot'].includes(widgetType);
  const valueOnly = ['kpi', 'traffic-light', 'progress-bar', 'gauge'].includes(widgetType);
  const hasThresholds = widgetType === 'traffic-light' || widgetType === 'gauge';
  const num = (k: string, d: number) => (visual[k] != null ? Number(visual[k]) : d);
  return (
    <div className="space-y-3">
      {hasXY && (
        <>
          <ColumnSelect
            label={widgetType === 'scatter-plot' ? 'X Column' : 'Category Column'}
            value={xKey}
            columns={columns}
            onChange={(v) => onVisualChange({ ...visual, xAxisKey: v })}
          />
          <ColumnSelect
            label={widgetType === 'scatter-plot' ? 'Y Column' : 'Value Column'}
            value={yKey}
            columns={columns}
            onChange={(v) => onVisualChange({ ...visual, yAxisKey: v })}
          />
        </>
      )}
      {valueOnly && (
        <ColumnSelect label="Value Column" value={yKey} columns={columns} onChange={(v) => onVisualChange({ ...visual, yAxisKey: v })} />
      )}
      {widgetType === 'pie-chart' && (
        <Field label="Inner radius (0 = pie, >0 = donut)">
          <Input type="number" className="h-8 text-xs" value={num('innerRadius', 0)} min={0} max={80} onChange={(e) => onVisualChange({ ...visual, innerRadius: Number(e.target.value) })} />
        </Field>
      )}
      {widgetType === 'progress-bar' && (
        <Field label="Goal value">
          <Input type="number" className="h-8 text-xs" value={num('goalValue', 100)} onChange={(e) => onVisualChange({ ...visual, goalValue: Number(e.target.value) })} />
        </Field>
      )}
      {widgetType === 'gauge' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Min">
            <Input type="number" className="h-8 text-xs" value={num('minValue', 0)} onChange={(e) => onVisualChange({ ...visual, minValue: Number(e.target.value) })} />
          </Field>
          <Field label="Max">
            <Input type="number" className="h-8 text-xs" value={num('maxValue', 100)} onChange={(e) => onVisualChange({ ...visual, maxValue: Number(e.target.value) })} />
          </Field>
        </div>
      )}
      {hasThresholds && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Green ≥">
            <Input type="number" className="h-8 text-xs" value={num('greenThreshold', widgetType === 'gauge' ? 75 : 90)} onChange={(e) => onVisualChange({ ...visual, greenThreshold: Number(e.target.value) })} />
          </Field>
          <Field label="Amber ≥">
            <Input type="number" className="h-8 text-xs" value={num('amberThreshold', widgetType === 'gauge' ? 50 : 75)} onChange={(e) => onVisualChange({ ...visual, amberThreshold: Number(e.target.value) })} />
          </Field>
        </div>
      )}
      {['bar-chart', 'row-chart', 'line-chart', 'area-chart', 'scatter-plot', 'progress-bar'].includes(widgetType) && (
        <Field label="Color">
          <Input type="color" className="h-8 w-full" value={String(visual.color ?? '#4682b4')} onChange={(e) => onVisualChange({ ...visual, color: e.target.value })} />
        </Field>
      )}
      {valueOnly && (
        <Field label="Suffix">
          <Input className="h-8 text-xs" value={String(visual.suffix ?? '')} placeholder='e.g. "%"' onChange={(e) => onVisualChange({ ...visual, suffix: e.target.value || undefined })} />
        </Field>
      )}
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <svg className="absolute inset-0 h-full w-full stroke-foreground/10" fill="none" aria-hidden="true">
        <defs>
          <pattern id="emptyHatch" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M-3 13 15-5M-5 5l18-18M-1 21 17 3" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#emptyHatch)" stroke="none" />
      </svg>
      <span className="relative text-xs text-muted-foreground">{text}</span>
    </div>
  );
}

export function WidgetEditorDialog({
  open,
  initial,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sqlEnabled = true,
  dashboardFilters = [],
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  initial?: WidgetConfig;
  sqlEnabled?: boolean;
  dashboardFilters?: DashboardFilterDef[];
  onClose: () => void;
  onSave: (w: WidgetConfig) => void;
  onDelete?: () => void;
}) {
  const initialSql = initial?.query.mode === 'sql' ? initial.query.sql : 'select 1 as value';
  const initialBindings = (initial?.query.mode === 'sql' && initial.query.variableBindings) || {};

  const [title, setTitle] = useState(initial?.title ?? 'New widget');
  const [type, setType] = useState(initial?.type ?? 'kpi');
  const [sqlText, setSqlText] = useState(initialSql);
  const [visual, setVisual] = useState<Visual>(initial?.visual ?? {});
  const [bindings, setBindings] = useState<Record<string, string>>(initialBindings);
  const [testValues, setTestValues] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ReportResult>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [models, setModels] = useState<QueryModel[]>([]);
  const [showCharts, setShowCharts] = useState(false);
  const [showTables, setShowTables] = useState(false);
  const [showVariables, setShowVariables] = useState(false);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);

  const view = useRef<EditorView>();
  const sqlRef = useRef(sqlText);
  sqlRef.current = sqlText;

  useEffect(() => {
    listModels().then(setModels).catch(() => {});
  }, []);

  // CodeMirror init via a callback ref. A top-level [] effect runs before Radix's
  // Dialog portal attaches the editor node, so the node is null there; a callback ref
  // fires exactly when the node mounts/unmounts.
  const onEditorMount = useCallback((node: HTMLDivElement | null) => {
    if (node && !view.current) {
      try {
        view.current = new EditorView({
          parent: node,
          doc: sqlRef.current,
          extensions: [
            basicSetup,
            sqlLang(),
            oneDark,
            EditorView.updateListener.of((u) => {
              if (u.docChanged) setSqlText(u.state.doc.toString());
            }),
            EditorView.theme({ '&': { height: '100%', fontSize: '13px' }, '.cm-scroller': { overflow: 'auto' } }),
          ],
        });
      } catch {
        /* jsdom lacks layout APIs CodeMirror needs; the sr-only textarea covers tests */
      }
    } else if (!node && view.current) {
      view.current.destroy();
      view.current = undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = () => {
    // Substitute {{var}} test values client-side so a parameterised query can preview.
    const q: WidgetQuery = { mode: 'sql', sql: substituteVars(sqlRef.current, testValues), variableBindings: bindings };
    setRunning(true);
    runWidgetQuery(q)
      .then((r) => {
        setPreview(r);
        setError(undefined);
        // Default axis keys to the first columns so the chart renders for arbitrary SQL.
        const cols = r.columns.map((c) => c.key);
        setVisual((v) => ({ ...v, xAxisKey: v.xAxisKey ?? cols[0], yAxisKey: v.yAxisKey ?? cols[1] ?? cols[0] }));
      })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setRunning(false));
  };

  // Run once on open if editing an existing widget.
  useEffect(() => {
    if (initial?.query.mode === 'sql') run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    const id = initial?.id ?? (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `w-${Math.round(performance.now())}`);
    const query: WidgetQuery = { mode: 'sql', sql: sqlText, variableBindings: bindings };
    onSave({ id, type, title, query, refreshIntervalSec: initial?.refreshIntervalSec ?? 0, visual });
  };

  const columns = preview?.columns.map((c) => c.key) ?? [];
  const xKey = String(visual.xAxisKey ?? columns[0] ?? 'label');
  const yKey = String(visual.yAxisKey ?? columns[1] ?? 'value');
  const errorMsg = error;
  const variables = extractVariables(sqlText);
  const previewConfig: WidgetConfig = { id: 'preview', type, title, query: { mode: 'sql', sql: sqlText }, refreshIntervalSec: 0, visual };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex h-[92vh] w-[95vw] max-w-[95vw] flex-col gap-0 p-0">
        {/* Header: editable title + actions */}
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <DialogTitle asChild>
            <input
              aria-label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-80 border-0 bg-transparent px-0 text-base font-semibold text-foreground outline-none focus:border-b focus:border-primary"
            />
          </DialogTitle>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body: 4 sections (editor | preview / results | config) */}
        <div className="flex min-h-0 flex-1 flex-col gap-0 p-3">
          {/* Top half */}
          <div className="flex min-h-0 h-1/2 gap-3">
            {/* editor + action bar */}
            <div className="flex min-w-0 flex-[3] flex-col rounded-t-md border border-border">
              {variables.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
                  {variables.map((v) => {
                    const bound = !!bindings[v];
                    return (
                      <button
                        key={v}
                        onClick={() => setShowVariables(true)}
                        className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] transition-colors ${bound ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground'}`}
                      >
                        {`{{${v}}}`}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-hidden">
                <div ref={onEditorMount} className="h-full" />
                <textarea aria-label="SQL" className="sr-only" value={sqlText} onChange={(e) => setSqlText(e.target.value)} />
              </div>
              <div className="flex items-center border-t border-border px-2 py-1">
                <span className="text-[11px] tabular-nums text-muted-foreground">{(preview?.rows.length ?? 0).toLocaleString()} rows</span>
                <div className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Run query" onClick={run} disabled={running || !sqlText.trim()}>
                    <Play className={`h-3.5 w-3.5 ${running ? 'animate-pulse' : ''}`} />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Editor menu">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setShowTables(true)}>Tables</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setShowCharts(true)}>Charts</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setShowVariables(true)}>Filters</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={save}>Save</DropdownMenuItem>
                      {initial && onDelete && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDelete()}>
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
            {/* preview */}
            <div className="min-w-0 flex-[2] overflow-hidden rounded-t-md border border-border p-3">
              {errorMsg ? <div className="text-sm text-destructive">{errorMsg}</div> : preview && preview.rows.length ? renderWidget(previewConfig, preview) : <EmptyPanel text="Run a query to see preview" />}
            </div>
          </div>

          {/* Bottom half */}
          <div className="flex min-h-0 h-1/2 gap-3">
            {/* results table */}
            <div className="min-w-0 flex-[3] overflow-auto rounded-b-md border border-t-0 border-border">
              {errorMsg ? (
                <div className="p-3 text-sm text-destructive">{errorMsg}</div>
              ) : preview && preview.rows.length ? (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      {columns.map((c) => (
                        <th key={c} className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 100).map((row, i) => (
                      <tr key={i} className="border-t border-border/50">
                        {columns.map((c) => (
                          <td key={c} className="px-2 py-1 text-foreground">
                            {String(row[c] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyPanel text="Run a query to see results" />
              )}
            </div>
            {/* config */}
            <div className="min-w-0 flex-[2] overflow-y-auto rounded-b-md border border-t-0 border-border p-3">
              {columns.length > 0 ? (
                <ConfigPanel widgetType={type} columns={columns} visual={visual} onVisualChange={setVisual} xKey={xKey} yKey={yKey} />
              ) : (
                <EmptyPanel text="Run a query to configure chart options" />
              )}
            </div>
          </div>
        </div>

        {/* Charts sheet — visualization type picker */}
        <Sheet open={showCharts} onOpenChange={setShowCharts}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Visualization Type</SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-2 gap-2">
              {WIDGET_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => {
                    setType(t.value);
                    setShowCharts(false);
                  }}
                  className={`rounded-md border p-3 text-xs transition-colors ${type === t.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </SheetContent>
        </Sheet>

        {/* Tables sheet — model/schema browser */}
        <Sheet open={showTables} onOpenChange={setShowTables}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Tables</SheetTitle>
            </SheetHeader>
            <div className="space-y-1 overflow-y-auto text-sm">
              {models.map((m) => (
                <div key={m.id}>
                  <button
                    onClick={() => setExpandedTable(expandedTable === m.id ? null : m.id)}
                    className="w-full rounded px-2 py-1 text-left font-mono text-xs font-medium hover:bg-accent"
                  >
                    {expandedTable === m.id ? '▼' : '▶'} {m.id}
                  </button>
                  {expandedTable === m.id && (
                    <div className="space-y-0.5 pl-6">
                      {[...m.dimensions.map((d) => d.column), ...m.metrics.map((x) => x.column ?? x.key)].map((col, i) => (
                        <p key={`${col}-${i}`} className="font-mono text-[11px] text-muted-foreground">
                          {col}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </SheetContent>
        </Sheet>

        {/* Variables sheet — bind {{vars}} to dashboard filters */}
        <Sheet open={showVariables} onOpenChange={setShowVariables}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Variables</SheetTitle>
            </SheetHeader>
            {variables.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No {'{{variables}}'} in the query. Add a placeholder like <code className="font-mono">{'{{ward}}'}</code> to your SQL to create one.
              </p>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">Give each variable a test value to preview the query, and optionally bind it to a dashboard filter.</p>
                {variables.map((v) => (
                  <div key={v} className="space-y-1">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{`{{${v}}}`}</code>
                    <Field label="Test value (for preview)">
                      <Input
                        className="h-8 text-xs"
                        value={testValues[v] ?? ''}
                        onChange={(e) => setTestValues((t) => ({ ...t, [v]: e.target.value }))}
                        placeholder="value used when you Run"
                      />
                    </Field>
                    <Field label="Dashboard filter">
                      <Select
                        value={bindings[v] ?? '__local__'}
                        onValueChange={(val) =>
                          setBindings((b) => {
                            const next = { ...b };
                            if (val === '__local__') delete next[v];
                            else next[v] = val;
                            return next;
                          })
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__local__">Local only</SelectItem>
                          {dashboardFilters.map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                ))}
              </div>
            )}
          </SheetContent>
        </Sheet>
      </DialogContent>
    </Dialog>
  );
}
