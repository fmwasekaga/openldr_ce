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
import { Plus, Pencil, Check, SlidersHorizontal, MoreHorizontal } from 'lucide-react';
import { listDashboards, createDashboard, saveDashboard, fetchClientConfig, type Dashboard, type WidgetConfig } from '../api';
import { useDashboardStore } from './store';
import { DashboardGrid } from './DashboardGrid';
import { DashboardFilterBar } from './filters/DashboardFilterBar';
import { DashboardFilterEditor } from './filters/DashboardFilterEditor';
import { WidgetEditorDialog } from './editor/WidgetEditorDialog';

const DEFAULT_SEED: Dashboard = {
  id: 'default',
  ownerId: null,
  name: 'Overview',
  refreshIntervalSec: 0,
  isDefault: true,
  filters: [],
  widgets: [
    {
      id: 'w-orders',
      type: 'kpi',
      title: 'Total Orders',
      refreshIntervalSec: 0,
      visual: {},
      query: {
        mode: 'builder',
        model: 'service_requests',
        metric: { key: 'count', label: 'Orders', agg: 'count' },
        filters: [],
      },
    },
    {
      id: 'w-trend',
      type: 'line-chart',
      title: 'Orders by Month',
      refreshIntervalSec: 0,
      visual: { xAxisKey: 'label', yAxisKey: 'value' },
      query: {
        mode: 'builder',
        model: 'service_requests',
        metric: { key: 'count', label: 'Orders', agg: 'count' },
        dimension: { key: 'authored_on', grain: 'month' },
        filters: [],
      },
    },
    {
      id: 'w-cat',
      type: 'bar-chart',
      title: 'Orders by Test',
      refreshIntervalSec: 0,
      visual: { xAxisKey: 'label', yAxisKey: 'value' },
      query: {
        mode: 'builder',
        model: 'service_requests',
        metric: { key: 'count', label: 'Orders', agg: 'count' },
        dimension: { key: 'code_text' },
        filters: [],
      },
    },
  ],
  layout: [
    { i: 'w-orders', x: 0, y: 0, w: 3, h: 2 },
    { i: 'w-trend', x: 3, y: 0, w: 6, h: 4 },
    { i: 'w-cat', x: 0, y: 2, w: 6, h: 4 },
  ],
};

export function DashboardPage() {
  const { current, editing, dirty, setCurrent, setEditing, markClean, addWidget, updateWidget } = useDashboardStore();
  const [all, setAll] = useState<Dashboard[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState<WidgetConfig | undefined>(undefined);
  const [filterEditorOpen, setFilterEditorOpen] = useState(false);
  const [sqlEnabled, setSqlEnabled] = useState(false);
  const [error, setError] = useState<string>();
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    fetchClientConfig()
      .then((c) => setSqlEnabled(c.dashboardSqlEnabled))
      .catch(() => {});
  }, []);

  useEffect(() => {
    listDashboards()
      .then(async (list) => {
        if (list.length === 0) {
          const seeded = await createDashboard(DEFAULT_SEED);
          list = [seeded];
        }
        setAll(list);
        setCurrent(list[0]);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

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
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Separator />
        {current.filters.length > 0 && (
          <div className="px-4 pt-3">
            <DashboardFilterBar filters={current.filters} values={values} onChange={setValues} />
          </div>
        )}
        <div className={cn('flex-1', editing && 'dash-edit-bg')}>
          <DashboardGrid
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
