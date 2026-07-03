import { useEffect, useRef, useState } from 'react';
import { AppShell } from '../shell/AppShell';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/cn';
import { Plus, Pencil, Check, SlidersHorizontal, MoreHorizontal, Download, Upload, RefreshCw } from 'lucide-react';
import { listDashboards, createDashboard, saveDashboard, fetchClientConfig, type Dashboard, type DashboardFilterDef, type WidgetConfig } from '../api';
import { useDashboardStore } from './store';
import { DashboardGrid } from './DashboardGrid';
import { DashboardFilterBar } from './filters/DashboardFilterBar';
import { DashboardFilterEditor } from './filters/DashboardFilterEditor';
import { exportDashboard, importDashboard } from './io';
import { WidgetEditorDialog } from './editor/WidgetEditorDialog';

function defaultsFor(filters: DashboardFilterDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of filters) {
    if (f.type === 'date-range') {
      if (f.defaultRange?.from || f.defaultRange?.to) out[f.id] = f.defaultRange;
    } else if (f.defaultValue != null && f.defaultValue !== '') {
      out[f.id] = f.defaultValue;
    }
  }
  return out;
}

export function DashboardPage() {
  const { current, editing, dirty, setCurrent, setEditing, markClean, addWidget, updateWidget, removeWidget } = useDashboardStore();
  const [all, setAll] = useState<Dashboard[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState<WidgetConfig | undefined>(undefined);
  const [filterEditorOpen, setFilterEditorOpen] = useState(false);
  const [sqlEnabled, setSqlEnabled] = useState(false);
  const [error, setError] = useState<string>();
  // Bumping this remounts the widget grid, which re-runs every widget's query — a refresh.
  const [refreshKey, setRefreshKey] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const fileInput = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    if (!current) return;
    const blob = new Blob([exportDashboard(current)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${current.name.replace(/[^a-z0-9-_]+/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importAndSelect = async (raw: unknown) => {
    try {
      const imported = importDashboard(raw, all.map((d) => d.name));
      const created = await createDashboard(imported);
      setAll((prev) => [...prev, created]);
      setCurrent(created);
    } catch (e) {
      setError(`Import failed: ${String((e as Error).message ?? e)}`);
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      await importAndSelect(JSON.parse(await file.text()));
    } catch (e) {
      setError(`Import failed: ${String((e as Error).message ?? e)}`);
    }
  };

  useEffect(() => {
    fetchClientConfig()
      .then((c) => setSqlEnabled(c.dashboardSqlEnabled))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // The vetted sample dashboard is server-seeded (id `default`), so we no longer POST a seed
    // from the client. If the list is genuinely empty (seed didn't run), the page falls through
    // to its empty/loading state gracefully instead of authoring a dashboard here.
    listDashboards()
      .then((list) => {
        setAll(list);
        if (list.length > 0) setCurrent(list[0]);
        else setError('No dashboards found.');
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  // Seed filter values from each filter's default whenever the active dashboard or its
  // filter set changes, so SQL widgets render with the default-bound values on first load.
  useEffect(() => {
    if (!current) return;
    setValues(defaultsFor(current.filters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, JSON.stringify(current?.filters)]);

  // Debounced auto-save while editing.
  useEffect(() => {
    if (!editing || !dirty || !current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveDashboard(current)
        .then(() => markClean())
        .catch((e) => setError(String(e.message ?? e)));
    }, 1500);
    return () => clearTimeout(saveTimer.current);
  }, [editing, dirty, current]);

  if (!current) {
    return (
      <AppShell title="Dashboard">
        <div className="ui-scope p-4 text-sm text-muted-foreground">{error ?? 'Loading…'}</div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Dashboard" fullBleed>
      <div className="ui-scope flex min-h-full flex-col overflow-y-auto">
        {error && <div className="px-4 pt-3 text-sm text-destructive">{error}</div>}
        <div className="flex items-center justify-between px-4 py-3">
          <Select value={current.id} onValueChange={(id) => setCurrent(all.find((d) => d.id === id)!)}>
            <SelectTrigger aria-label="Dashboard" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {all.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Refresh"
            title="Refresh"
            className="h-8 w-8 text-muted-foreground"
            onClick={() => setRefreshKey((k) => k + 1)}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Dashboard menu" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {editing ? (
                <>
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditingWidget(undefined);
                      setEditorOpen(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add widget
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setFilterEditorOpen(true)}>
                    <SlidersHorizontal className="mr-2 h-4 w-4" />
                    Edit filters
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      if (current)
                        saveDashboard(current).then(() => {
                          markClean();
                          setEditing(false);
                        });
                    }}
                  >
                    <Check className="mr-2 h-4 w-4" />
                    Done
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleExport}>
                <Download className="mr-2 h-4 w-4" />
                Export dashboard
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
                <Upload className="mr-2 h-4 w-4" />
                Import dashboard…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportFile(f);
              e.target.value = '';
            }}
          />
        </div>
        <Separator />
        {current.filters.length > 0 && (
          <>
            <div className="px-4 py-3">
              <DashboardFilterBar filters={current.filters} values={values} onChange={setValues} />
            </div>
            <Separator />
          </>
        )}
        <div className={cn('flex-1', editing && 'dash-edit-bg')}>
          <DashboardGrid
            key={refreshKey}
            filterValues={values}
            onEdit={(id) => {
              setEditingWidget(current.widgets.find((w) => w.id === id));
              setEditorOpen(true);
            }}
          />
        </div>
      </div>
      {editorOpen && (
        <WidgetEditorDialog
          open
          initial={editingWidget}
          sqlEnabled={sqlEnabled}
          dashboardFilters={current.filters}
          onClose={() => {
            setEditorOpen(false);
            setEditingWidget(undefined);
          }}
          onSave={(w) => {
            if (editingWidget) updateWidget(w);
            else addWidget(w);
            setEditorOpen(false);
            setEditingWidget(undefined);
          }}
          onDelete={
            editingWidget
              ? () => {
                  removeWidget(editingWidget.id);
                  setEditorOpen(false);
                  setEditingWidget(undefined);
                }
              : undefined
          }
        />
      )}
      {filterEditorOpen && current && (
        <DashboardFilterEditor
          open
          filters={current.filters}
          onClose={() => setFilterEditorOpen(false)}
          onSave={(f) => setCurrent({ ...current, filters: f })}
        />
      )}
    </AppShell>
  );
}
