import { create } from 'zustand';
import type { Dashboard, WidgetConfig, LayoutItem } from '../api';

const DEFAULT_SIZES: Record<string, { w: number; h: number }> = {
  kpi: { w: 3, h: 2 }, 'traffic-light': { w: 3, h: 2 }, 'progress-bar': { w: 3, h: 2 }, gauge: { w: 3, h: 3 },
  'pie-chart': { w: 4, h: 4 }, funnel: { w: 4, h: 4 },
  'bar-chart': { w: 6, h: 4 }, 'line-chart': { w: 6, h: 4 }, 'area-chart': { w: 6, h: 4 },
  'row-chart': { w: 6, h: 4 }, 'scatter-plot': { w: 6, h: 4 }, table: { w: 6, h: 4 },
};

interface State {
  current: Dashboard | null; editing: boolean; dirty: boolean;
  setCurrent(d: Dashboard | null): void; setEditing(v: boolean): void; markClean(): void;
  addWidget(w: WidgetConfig): void; updateWidget(w: WidgetConfig): void; removeWidget(id: string): void;
  setLayout(layout: LayoutItem[]): void; rename(name: string): void;
}

export const useDashboardStore = create<State>((set) => ({
  current: null, editing: false, dirty: false,
  setCurrent: (d) => set({ current: d, dirty: false }),
  setEditing: (v) => set({ editing: v }),
  markClean: () => set({ dirty: false }),
  addWidget: (w) => set((s) => {
    if (!s.current) return s;
    const size = DEFAULT_SIZES[w.type] ?? { w: 4, h: 3 };
    const y = s.current.layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    return { current: { ...s.current, widgets: [...s.current.widgets, w], layout: [...s.current.layout, { i: w.id, x: 0, y, ...size }] }, dirty: true };
  }),
  updateWidget: (w) => set((s) => s.current ? { current: { ...s.current, widgets: s.current.widgets.map((x) => x.id === w.id ? w : x) }, dirty: true } : s),
  removeWidget: (id) => set((s) => s.current ? { current: { ...s.current, widgets: s.current.widgets.filter((x) => x.id !== id), layout: s.current.layout.filter((l) => l.i !== id) }, dirty: true } : s),
  setLayout: (layout) => set((s) => s.current ? { current: { ...s.current, layout }, dirty: true } : s),
  rename: (name) => set((s) => s.current ? { current: { ...s.current, name }, dirty: true } : s),
}));
