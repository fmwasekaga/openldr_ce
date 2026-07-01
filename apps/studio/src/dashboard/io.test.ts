import { describe, it, expect } from 'vitest';
import { uniqueName, importDashboard, exportDashboard } from './io';
import type { Dashboard } from '../api';

describe('uniqueName', () => {
  it('returns the name unchanged when there is no collision', () => {
    expect(uniqueName('General', ['Overview'])).toBe('General');
  });
  it('appends (2) on the first collision', () => {
    expect(uniqueName('General', ['General'])).toBe('General (2)');
  });
  it('increments to the next free suffix', () => {
    expect(uniqueName('General', ['General', 'General (2)'])).toBe('General (3)');
  });
});

describe('importDashboard', () => {
  const corlix = {
    name: 'General',
    layout: [{ i: 'w1', x: 0, y: 0, w: 3, h: 1 }],
    widgets: [
      {
        id: 'w1',
        type: 'kpi',
        title: 'Orders',
        dataSourceId: 'custom-sql',
        params: {
          sql: 'SELECT COUNT(*) as value FROM orders [[AND ward = {{ward}}]]',
          variables: { ward: { type: 'text', label: 'Ward' } },
          variableBindings: { ward: 'ward' },
        },
        refreshIntervalSec: 60,
        visual: { yAxisKey: 'value' },
      },
    ],
    filters: [{ id: 'ward', label: 'Ward', type: 'text', optionsSql: 'SELECT DISTINCT ward FROM orders' }],
  };

  it('transforms corlix dataSourceId/params into a sql query', () => {
    const d = importDashboard(corlix, []);
    const w = d.widgets[0];
    expect(w.query).toEqual({
      mode: 'sql',
      sql: 'SELECT COUNT(*) as value FROM orders [[AND ward = {{ward}}]]',
      variables: { ward: { type: 'text', label: 'Ward' } },
      variableBindings: { ward: 'ward' },
    });
    expect((w as unknown as Record<string, unknown>).dataSourceId).toBeUndefined();
    expect((w as unknown as Record<string, unknown>).params).toBeUndefined();
  });

  it('assigns a fresh id, is never default, and keeps filters/layout', () => {
    const d = importDashboard(corlix, []);
    expect(d.id).toMatch(/.+/);
    expect(d.isDefault).toBe(false);
    expect(d.ownerId).toBeNull();
    expect(d.layout).toHaveLength(1);
    expect(d.filters[0].id).toBe('ward');
  });

  it('dedupes the name against existing dashboards', () => {
    expect(importDashboard(corlix, ['General']).name).toBe('General (2)');
  });

  it('keeps an already-native sql widget query as-is', () => {
    const native = {
      name: 'Native',
      layout: [],
      widgets: [{ id: 'a', type: 'kpi', title: 'X', query: { mode: 'sql', sql: 'SELECT 1 as value' }, refreshIntervalSec: 0, visual: {} }],
      filters: [],
    };
    expect(importDashboard(native, []).widgets[0].query).toEqual({ mode: 'sql', sql: 'SELECT 1 as value' });
  });
});

describe('exportDashboard', () => {
  it('serializes a portable subset without id/ownerId', () => {
    const d: Dashboard = {
      id: 'x', ownerId: 'u1', name: 'General', layout: [{ i: 'w1', x: 0, y: 0, w: 3, h: 1 }],
      widgets: [{ id: 'w1', type: 'kpi', title: 'Orders', query: { mode: 'sql', sql: 'SELECT 1 as value' }, refreshIntervalSec: 0, visual: {} }],
      filters: [], refreshIntervalSec: 0, isDefault: true,
    };
    const out = JSON.parse(exportDashboard(d));
    expect(out).toEqual({
      name: 'General',
      layout: [{ i: 'w1', x: 0, y: 0, w: 3, h: 1 }],
      widgets: [{ id: 'w1', type: 'kpi', title: 'Orders', query: { mode: 'sql', sql: 'SELECT 1 as value' }, refreshIntervalSec: 0, visual: {} }],
      filters: [],
      refreshIntervalSec: 0,
    });
    expect(out.id).toBeUndefined();
    expect(out.ownerId).toBeUndefined();
  });
});
