import type { Dashboard } from './types';

export const DEFAULT_DASHBOARD: Dashboard = {
  id: 'default', ownerId: null, name: 'Overview', refreshIntervalSec: 0, isDefault: true,
  filters: [],
  widgets: [
    { id: 'w-orders', type: 'kpi', title: 'Total Orders', refreshIntervalSec: 0, visual: {},
      query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', label: 'Orders', agg: 'count' }, filters: [] } },
    { id: 'w-trend', type: 'line-chart', title: 'Orders by Month', refreshIntervalSec: 0, visual: { xAxisKey: 'label', yAxisKey: 'value' },
      query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', label: 'Orders', agg: 'count' }, dimension: { key: 'authored_on', grain: 'month' }, filters: [] } },
    { id: 'w-cat', type: 'bar-chart', title: 'Orders by Test', refreshIntervalSec: 0, visual: { xAxisKey: 'label', yAxisKey: 'value' },
      query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', label: 'Orders', agg: 'count' }, dimension: { key: 'code_text' }, filters: [] } },
  ],
  layout: [
    { i: 'w-orders', x: 0, y: 0, w: 3, h: 2 },
    { i: 'w-trend', x: 3, y: 0, w: 6, h: 4 },
    { i: 'w-cat', x: 0, y: 2, w: 6, h: 4 },
  ],
};
