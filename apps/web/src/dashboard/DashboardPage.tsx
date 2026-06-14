import { useEffect, useRef, useState } from 'react';
import { AppShell } from '../shell/AppShell';
import { Button } from '@/components/ui/button';
import { Plus, Pencil, Save, SlidersHorizontal } from 'lucide-react';
import { listDashboards, createDashboard, saveDashboard, fetchClientConfig, type Dashboard } from '../api';
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
  const { current, editing, dirty, setCurrent, setEditing, markClean, addWidget } = useDashboardStore();
  const [all, setAll] = useState<Dashboard[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [editorOpen, setEditorOpen] = useState(false);
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
    <AppShell title="Dashboard">
      <div className="ui-scope">
        {error && <div className="mb-3 text-sm text-destructive">{error}</div>}
        <div className="mb-4 flex items-center justify-between">
          <select
            aria-label="Dashboard"
            className="rounded border border-border bg-background p-2"
            value={current.id}
            onChange={(e) => setCurrent(all.find((d) => d.id === e.target.value)!)}
          >
            {all.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            {editing && (
              <Button size="sm" variant="outline" onClick={() => setFilterEditorOpen(true)}>
                <SlidersHorizontal className="mr-1 h-4 w-4" />
                Filters
              </Button>
            )}
            {editing && (
              <Button size="sm" variant="outline" onClick={() => setEditorOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                Widget
              </Button>
            )}
            {editing ? (
              <Button
                size="sm"
                onClick={() => {
                  if (current)
                    saveDashboard(current).then(() => {
                      markClean();
                      setEditing(false);
                    });
                }}
              >
                <Save className="mr-1 h-4 w-4" />
                Done
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="mr-1 h-4 w-4" />
                Edit
              </Button>
            )}
          </div>
        </div>
        <DashboardFilterBar filters={current.filters} values={values} onChange={setValues} />
        <DashboardGrid filterValues={values} onEdit={() => setEditorOpen(true)} />
      </div>
      {editorOpen && (
        <WidgetEditorDialog
          open
          sqlEnabled={sqlEnabled}
          onClose={() => setEditorOpen(false)}
          onSave={(w) => {
            addWidget(w);
            setEditorOpen(false);
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
