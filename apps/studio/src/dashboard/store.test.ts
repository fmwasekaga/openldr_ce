import { describe, it, expect, beforeEach } from 'vitest';
import { useDashboardStore } from './store';

const blank = { id: 'd', ownerId: null, name: 'D', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: false };

beforeEach(() => useDashboardStore.setState({ current: structuredClone(blank), editing: false, dirty: false }));

describe('dashboard store', () => {
  it('adds a widget and marks dirty', () => {
    useDashboardStore.getState().addWidget({ id: 'w1', type: 'kpi', title: 'X', refreshIntervalSec: 0, visual: {}, query: { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] } });
    expect(useDashboardStore.getState().current!.widgets.length).toBe(1);
    expect(useDashboardStore.getState().current!.layout.length).toBe(1);
    expect(useDashboardStore.getState().dirty).toBe(true);
  });
  it('removes a widget and its layout item', () => {
    const s = useDashboardStore.getState();
    s.addWidget({ id: 'w1', type: 'kpi', title: 'X', refreshIntervalSec: 0, visual: {}, query: { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] } });
    s.removeWidget('w1');
    expect(useDashboardStore.getState().current!.widgets.length).toBe(0);
    expect(useDashboardStore.getState().current!.layout.length).toBe(0);
  });
  it('updates layout', () => {
    useDashboardStore.getState().setLayout([{ i: 'w1', x: 1, y: 2, w: 3, h: 4 }]);
    expect(useDashboardStore.getState().current!.layout[0].x).toBe(1);
  });
});
