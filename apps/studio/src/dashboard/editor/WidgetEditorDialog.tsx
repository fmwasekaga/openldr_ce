import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { sql as sqlLang } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { basicSetup } from 'codemirror';
import { Play, MoreHorizontal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
// Browser-safe subpath: recognize-sql.ts + the pure model registry only. The package root ('.')
// also exports compile.ts/store.ts (kysely + @openldr/db) and must stay server-only — see
// apps/studio/src/dashboard/template.ts for the established rule.
import { recognizeSql } from '@openldr/dashboards/pure';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DatePicker } from '@/components/ui/date-picker';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { StripedEmpty } from '@/components/ui/striped-empty';
import {
  listModels,
  runWidgetQuery,
  compileBuilderToSql,
  type QueryModel,
  type DashboardFilterDef,
  type WidgetConfig,
  type WidgetQuery,
  type WidgetVariableDef,
  type ReportResult,
} from '../../api';
import { renderWidget } from '../widgets';
import { resolveValues, applyTemplate } from '../template';
import { BuilderForm } from './BuilderForm';
import { buildSaveQuery, shouldRestoreEjected, type BuilderQuery } from './builderForm.model';

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

/** Collapse _from/_to of a date-range variable into its logical parent. */
function extractLogicalVariables(s: string, defs: Record<string, WidgetVariableDef>): string[] {
  const logical = new Set<string>();
  for (const v of extractVariables(s)) {
    if (v.endsWith('_from') || v.endsWith('_to')) {
      const base = v.replace(/_(from|to)$/, '');
      if (defs[base]?.type === 'date-range') {
        logical.add(base);
        continue;
      }
    }
    logical.add(v);
  }
  return [...logical];
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Label-left / control-right row for the variable config grid. */
function VarRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <Label className="self-center whitespace-nowrap text-xs text-muted-foreground">{label}</Label>
      <div className="min-w-0">{children}</div>
    </>
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
          <ColumnSelect label={widgetType === 'scatter-plot' ? 'X Column' : 'Category Column'} value={xKey} columns={columns} onChange={(v) => onVisualChange({ ...visual, xAxisKey: v })} />
          <ColumnSelect label={widgetType === 'scatter-plot' ? 'Y Column' : 'Value Column'} value={yKey} columns={columns} onChange={(v) => onVisualChange({ ...visual, yAxisKey: v })} />
        </>
      )}
      {valueOnly && <ColumnSelect label="Value Column" value={yKey} columns={columns} onChange={(v) => onVisualChange({ ...visual, yAxisKey: v })} />}
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
  return <StripedEmpty>{text}</StripedEmpty>;
}

export function WidgetEditorDialog({
  open,
  initial,
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
  const { t } = useTranslation();
  const initialSql = initial?.query.mode === 'sql' ? initial.query.sql : 'select 1 as value';
  const initialBindings = (initial?.query.mode === 'sql' && initial.query.variableBindings) || {};
  const initialDefs = (initial?.query.mode === 'sql' && initial.query.variables) || {};

  const [title, setTitle] = useState(initial?.title ?? 'New widget');
  const [type, setType] = useState(initial?.type ?? 'kpi');
  const [sqlText, setSqlText] = useState(initialSql);
  const [mode, setMode] = useState<'builder' | 'sql'>(initial?.query.mode ?? 'builder');
  const [builderQuery, setBuilderQuery] = useState<BuilderQuery>(
    initial?.query.mode === 'builder'
      ? initial.query
      : { mode: 'builder', model: 'service_requests', metric: { key: 'count', label: 'Count', agg: 'count' }, filters: [] },
  );
  const [visual, setVisual] = useState<Visual>(initial?.visual ?? {});
  const [bindings, setBindings] = useState<Record<string, string>>(initialBindings);
  const [varDefs, setVarDefs] = useState<Record<string, WidgetVariableDef>>(initialDefs);
  // SQL -> Builder import guard: set when the current sqlText can't be recognized as a builder
  // query (see toBuilder below). Disables the Builder toggle and shows the refusal reason inline
  // until the SQL changes.
  const [builderBlockedReason, setBuilderBlockedReason] = useState<string | undefined>();
  // Builder -> SQL eject: true once the user has switched away from the builder in this dialog
  // session, so the "JS-side shaping isn't in this SQL" banner shows above the editor.
  const [ejectedFromBuilder, setEjectedFromBuilder] = useState(false);
  // The exact compiled SQL text last written into the editor by an eject (toSql). Lets toBuilder
  // tell a plain round-trip (SQL untouched since eject -> restore builderQuery losslessly) apart
  // from a hand-edited eject (SQL changed -> must re-recognize, never silently discard the edit).
  // See shouldRestoreEjected in builderForm.model.ts.
  const [lastEjectedSql, setLastEjectedSql] = useState<string | undefined>();
  const [testValues, setTestValues] = useState<Record<string, unknown>>({});
  const [dynamicVarOptions, setDynamicVarOptions] = useState<Record<string, string[]>>({});
  const [preview, setPreview] = useState<ReportResult>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [models, setModels] = useState<QueryModel[]>([]);
  const [showCharts, setShowCharts] = useState(false);
  const [showTables, setShowTables] = useState(false);
  const [showVariables, setShowVariables] = useState(false);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);

  // When SQL authoring is disabled, the SQL text is read-only: the user can preview and tweak
  // chart/table/config, but cannot change the (vetted) query. Editing SQL requires the flag on.
  const sqlReadOnly = !sqlEnabled;

  const view = useRef<EditorView>();
  const sqlRef = useRef(sqlText);
  sqlRef.current = sqlText;
  const testValuesRef = useRef(testValues);
  testValuesRef.current = testValues;
  const sqlReadOnlyRef = useRef(sqlReadOnly);
  sqlReadOnlyRef.current = sqlReadOnly;

  useEffect(() => {
    listModels()
      .then((m) => {
        setModels(m);
        // Seed the builder default's model/metric once the real model list arrives, but only
        // when this is still an unedited guess (the guessed model id isn't one of the loaded
        // models) — an existing builder-mode widget, or one the user has already touched, is
        // left alone.
        setBuilderQuery((q) => (m.some((x) => x.id === q.model) ? q : { ...q, model: m[0]?.id ?? q.model, metric: m[0]?.metrics[0] ?? q.metric }));
      })
      .catch(() => {});
  }, []);

  // Load dynamic options for variables that define an optionsSql query.
  useEffect(() => {
    const toLoad = Object.entries(varDefs).filter(([, d]) => d.optionsSql);
    if (toLoad.length === 0) return;
    let alive = true;
    (async () => {
      const results: Record<string, string[]> = {};
      for (const [name, def] of toLoad) {
        try {
          const r = await runWidgetQuery({ mode: 'sql', sql: def.optionsSql! });
          if (r.rows.length) {
            const key = r.columns[0]?.key ?? Object.keys(r.rows[0])[0];
            results[name] = r.rows.map((row) => String(row[key] ?? ''));
          }
        } catch {
          /* ignore */
        }
      }
      if (alive) setDynamicVarOptions(results);
    })();
    return () => {
      alive = false;
    };
  }, [JSON.stringify(varDefs)]);

  // CodeMirror init via a callback ref (Radix's Dialog portal attaches the node after the
  // parent's effect runs, so a top-level [] effect sees a null ref).
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
            // Read-only (flag off): block edits and hide the caret; preview/config stay usable.
            EditorState.readOnly.of(sqlReadOnlyRef.current),
            EditorView.editable.of(!sqlReadOnlyRef.current),
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

  // Keep the CodeMirror view in sync when `sqlText` changes programmatically — chiefly the async
  // Builder→SQL eject, whose compiled SQL resolves AFTER the editor has already mounted (with the
  // old doc). Guard on the current doc so the user's own keystrokes (view → setSqlText via the
  // update listener) don't re-dispatch and loop.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== sqlText) v.dispatch({ changes: { from: 0, to: cur.length, insert: sqlText } });
  }, [sqlText]);

  // Stored (vetted) SQL template for this widget, if editing an existing sql-mode widget.
  const storedTemplate = initial?.query.mode === 'sql' ? initial.query.sql : undefined;

  const run = () => {
    let q: WidgetQuery;
    if (sqlReadOnlyRef.current && storedTemplate != null) {
      // Flag off: SQL is read-only, so `sqlText` equals the persisted template. Send the STORED
      // template verbatim plus resolved test `values` and let the server substitute + vet it —
      // the exact same path the live widget uses — so an unchanged widget previews successfully.
      const values: Record<string, string | number | null | { from: string; to: string }> = {};
      for (const [name, val] of Object.entries(testValuesRef.current)) {
        values[name] = (val ?? null) as string | number | null | { from: string; to: string };
      }
      q = { mode: 'sql', sql: storedTemplate, variableBindings: bindings, values };
    } else {
      // Flag on (authoring): substitute client-side; raw SQL execution is permitted.
      const resolved = resolveValues(testValuesRef.current);
      q = { mode: 'sql', sql: applyTemplate(sqlRef.current, resolved), variableBindings: bindings };
    }
    setRunning(true);
    runWidgetQuery(q)
      .then((r) => {
        setPreview(r);
        setError(undefined);
        const cols = r.columns.map((c) => c.key);
        setVisual((v) => ({ ...v, xAxisKey: v.xAxisKey ?? cols[0], yAxisKey: v.yAxisKey ?? cols[1] ?? cols[0] }));
      })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setRunning(false));
  };

  useEffect(() => {
    if (initial?.query.mode === 'sql') run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Builder-mode preview: run the builder query live whenever it (or the mode) changes.
  useEffect(() => {
    if (mode !== 'builder') return;
    setRunning(true);
    runWidgetQuery(builderQuery)
      .then((r) => {
        setPreview(r);
        setError(undefined);
        const cols = r.columns.map((c) => c.key);
        setVisual((v) => ({ ...v, xAxisKey: v.xAxisKey ?? cols[0], yAxisKey: v.yAxisKey ?? cols[1] ?? cols[0] }));
      })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setRunning(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, JSON.stringify(builderQuery)]);

  // Editing the SQL invalidates any prior "can't show this in the builder" refusal — re-check on
  // the next toBuilder click rather than leaving a stale block in place.
  useEffect(() => {
    setBuilderBlockedReason(undefined);
  }, [sqlText]);

  // SQL -> Builder: recognize the current SQL text as a builder query. If the SQL is exactly what
  // the last Builder -> SQL eject produced (untouched since), the in-memory builderQuery is still
  // authoritative (round-trips exactly, and the compiled eject SQL isn't recognizable anyway) —
  // skip re-parsing. Otherwise (never ejected, or the SQL was hand-edited since) re-recognize so
  // an edit is never silently discarded.
  const toBuilder = () => {
    if (shouldRestoreEjected(mode, sqlText, lastEjectedSql)) {
      setBuilderBlockedReason(undefined);
      setMode('builder');
      return;
    }
    const r = recognizeSql(sqlText);
    if (r.ok) {
      setBuilderQuery(r.query as unknown as BuilderQuery);
      setBuilderBlockedReason(undefined);
      setMode('builder');
    } else {
      setBuilderBlockedReason(r.reason);
      toast.error(`${t('widgetEditor.cannotShowInBuilder')}: ${r.reason}`);
    }
  };

  // Builder -> SQL (eject): fill the editor with the builder query compiled to SQL text and show
  // the "JS-side shaping isn't in this SQL" banner. A compile failure is silently ignored — the
  // editor just keeps whatever SQL text it already had.
  const toSql = () => {
    if (mode === 'builder') {
      setEjectedFromBuilder(true);
      compileBuilderToSql(builderQuery)
        .then((sql) => {
          setSqlText(sql);
          setLastEjectedSql(sql);
        })
        .catch(() => {});
    }
    setMode('sql');
  };

  const save = () => {
    const id = initial?.id ?? (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `w-${Math.round(performance.now())}`);
    const query = buildSaveQuery(mode, builderQuery, sqlText, bindings, varDefs);
    onSave({ id, type, title, query, refreshIntervalSec: initial?.refreshIntervalSec ?? 0, visual });
  };

  const columns = preview?.columns.map((c) => c.key) ?? [];
  const xKey = String(visual.xAxisKey ?? columns[0] ?? 'label');
  const yKey = String(visual.yAxisKey ?? columns[1] ?? 'value');
  const errorMsg = error;
  const detectedVars = extractLogicalVariables(sqlText, varDefs);
  const previewConfig: WidgetConfig = { id: 'preview', type, title, query: { mode: 'sql', sql: sqlText }, refreshIntervalSec: 0, visual };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex h-[92vh] w-[95vw] max-w-[95vw] flex-col gap-0 p-0">
        {/* Header */}
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

        {/* Body: 4 sections */}
        <div className="flex min-h-0 flex-1 flex-col gap-0 p-3">
          <div className="flex min-h-0 h-1/2 gap-3">
            <div className="flex min-w-0 flex-[3] flex-col rounded-t-md border border-border">
              {detectedVars.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
                  {detectedVars.map((v) => {
                    const def = varDefs[v];
                    const configured = !!def;
                    return (
                      <button
                        key={v}
                        onClick={() => setShowVariables(true)}
                        className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] transition-colors ${configured ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground'}`}
                      >
                        <span>{`{{${v}}}`}</span>
                        <span className={`text-[9px] uppercase ${configured ? 'text-primary/70' : 'text-muted-foreground/60'}`}>{def?.type ?? '?'}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-auto">
                {mode === 'builder' ? (
                  <BuilderForm models={models} value={builderQuery} dashboardFilters={dashboardFilters} onChange={setBuilderQuery} />
                ) : (
                  <>
                    {ejectedFromBuilder && (
                      <div className="border-b border-border bg-muted px-2 py-1 text-[11px] text-muted-foreground">{t('widgetEditor.ejectBanner')}</div>
                    )}
                    <div ref={onEditorMount} className="h-full" />
                    <textarea aria-label="SQL" className="sr-only" readOnly={sqlReadOnly} value={sqlText} onChange={(e) => setSqlText(e.target.value)} />
                  </>
                )}
              </div>
              <div className="flex items-center border-t border-border px-2 py-1">
                <div className="mr-2 inline-flex overflow-hidden rounded border border-border text-[11px]">
                  <button
                    type="button"
                    aria-pressed={mode === 'builder'}
                    onClick={toBuilder}
                    disabled={!!builderBlockedReason}
                    title={builderBlockedReason}
                    className={`disabled:cursor-not-allowed disabled:opacity-50 ${mode === 'builder' ? 'bg-primary px-2 py-0.5 text-primary-foreground' : 'px-2 py-0.5 text-muted-foreground'}`}
                  >
                    {t('widgetEditor.modeBuilder')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === 'sql'}
                    onClick={toSql}
                    className={mode === 'sql' ? 'bg-primary px-2 py-0.5 text-primary-foreground' : 'px-2 py-0.5 text-muted-foreground'}
                  >
                    {t('widgetEditor.modeSql')}
                  </button>
                </div>
                {builderBlockedReason && (
                  <span role="alert" className="mr-2 max-w-[28ch] truncate text-[11px] text-destructive" title={builderBlockedReason}>
                    {builderBlockedReason}
                  </span>
                )}
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
            <div className="min-w-0 flex-[2] overflow-hidden rounded-t-md border border-border p-3">
              {errorMsg ? <div className="text-sm text-destructive">{errorMsg}</div> : preview && preview.rows.length ? renderWidget(previewConfig, preview) : <EmptyPanel text="Run a query to see preview" />}
            </div>
          </div>

          <div className="flex min-h-0 h-1/2 gap-3">
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
            <div className="min-w-0 flex-[2] overflow-y-auto rounded-b-md border border-t-0 border-border p-3">
              {columns.length > 0 ? (
                <ConfigPanel widgetType={type} columns={columns} visual={visual} onVisualChange={setVisual} xKey={xKey} yKey={yKey} />
              ) : (
                <EmptyPanel text="Run a query to configure chart options" />
              )}
            </div>
          </div>
        </div>

        {/* Charts sheet */}
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

        {/* Tables sheet */}
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

        {/* Variables sheet (corlix parity) */}
        <Sheet open={showVariables} onOpenChange={setShowVariables}>
          <SheetContent className="flex w-[440px] max-w-[90vw] flex-col px-0 sm:w-[440px]">
            <SheetHeader className="px-6">
              <SheetTitle>Variables</SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-6">
              {detectedVars.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No {'{{variables}}'} detected. Add a placeholder like <code className="font-mono">{'{{ward}}'}</code> to your SQL to create one.
                </p>
              ) : (
                detectedVars.map((v) => {
                  const def = varDefs[v] ?? { type: 'text' as const, label: v };
                  const boundFilterId = bindings[v];
                  const updateDef = (patch: Partial<WidgetVariableDef>) => setVarDefs((d) => ({ ...d, [v]: { ...def, ...patch } }));
                  return (
                    <div key={v}>
                      <div className="-mx-6 border-b border-border" />
                      <div className="flex items-center py-3">
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{`{{${v}}}`}</code>
                      </div>
                      <div className="-mx-6 border-b border-border" />
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3 py-4">
                        <VarRow label="Type">
                          <Select value={def.type} onValueChange={(t) => updateDef({ type: t as WidgetVariableDef['type'] })}>
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="text">Text</SelectItem>
                              <SelectItem value="number">Number</SelectItem>
                              <SelectItem value="date">Date</SelectItem>
                              <SelectItem value="date-range">Date Range</SelectItem>
                            </SelectContent>
                          </Select>
                        </VarRow>

                        <VarRow label="Label">
                          <Input value={def.label} onChange={(e) => updateDef({ label: e.target.value })} className="h-7 text-xs" placeholder="Display name" />
                        </VarRow>

                        {def.type === 'text' && (
                          <>
                            <VarRow label="Options">
                              <Input
                                value={def.options?.join(', ') ?? ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  updateDef({ options: val ? val.split(',').map((s) => s.trim()).filter(Boolean) : undefined });
                                }}
                                className="h-7 text-xs"
                                placeholder="e.g. OPD, ICU, Emergency"
                              />
                            </VarRow>
                            <VarRow label="Options SQL">
                              <Input
                                value={def.optionsSql ?? ''}
                                onChange={(e) => updateDef({ optionsSql: e.target.value || undefined })}
                                className="h-7 font-mono text-xs"
                                placeholder="SELECT DISTINCT ward FROM ..."
                              />
                            </VarRow>
                          </>
                        )}

                        <VarRow label="Dashboard Filter">
                          <Select
                            value={boundFilterId ?? '__local__'}
                            onValueChange={(val) =>
                              setBindings((b) => {
                                const next = { ...b };
                                if (val && val !== '__local__') next[v] = val;
                                else delete next[v];
                                return next;
                              })
                            }
                          >
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__local__">Local only</SelectItem>
                              {dashboardFilters.map((f) => (
                                <SelectItem key={f.id} value={f.id}>
                                  {f.label} ({f.id})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </VarRow>

                        <div className="col-span-2 -mx-6 border-b border-border" />

                        <VarRow label="Test Value">
                          {def.type === 'date-range' ? (
                            <DateRangePicker
                              value={(testValues[v] as { from: string; to: string } | null) ?? null}
                              onChange={(val) => setTestValues((p) => ({ ...p, [v]: val }))}
                              placeholder="Pick date range"
                              className="h-7 w-full text-xs"
                            />
                          ) : def.type === 'date' ? (
                            <DatePicker
                              value={(testValues[v] as string) ?? null}
                              onChange={(val) => setTestValues((p) => ({ ...p, [v]: val }))}
                              placeholder="Pick a date"
                              className="h-7 text-xs"
                            />
                          ) : def.type === 'number' ? (
                            <Input
                              type="number"
                              value={testValues[v] != null ? String(testValues[v]) : ''}
                              onChange={(e) => setTestValues((p) => ({ ...p, [v]: e.target.value ? Number(e.target.value) : null }))}
                              className="h-7 text-xs"
                              placeholder="Enter test value"
                            />
                          ) : (def.options?.length ?? 0) > 0 || (dynamicVarOptions[v]?.length ?? 0) > 0 ? (
                            <Select value={(testValues[v] as string) ?? '__all__'} onValueChange={(val) => setTestValues((p) => ({ ...p, [v]: val === '__all__' ? null : val }))}>
                              <SelectTrigger className="h-7 text-xs">
                                <SelectValue placeholder="All" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__all__">All</SelectItem>
                                {(def.options ?? dynamicVarOptions[v] ?? []).map((o) => (
                                  <SelectItem key={o} value={o}>
                                    {o}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              value={(testValues[v] as string) ?? ''}
                              onChange={(e) => setTestValues((p) => ({ ...p, [v]: e.target.value || null }))}
                              className="h-7 text-xs"
                              placeholder="Enter test value"
                            />
                          )}
                        </VarRow>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {detectedVars.length > 0 && (
              <div className="border-t border-border px-6 pt-3">
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => setTestValues({})}>
                  Clear Test Values
                </Button>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </DialogContent>
    </Dialog>
  );
}
