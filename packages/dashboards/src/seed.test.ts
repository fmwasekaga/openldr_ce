import { describe, it, expect } from 'vitest';
import { DEFAULT_DASHBOARD, seedDefaultDashboard, collectVettedSqlTemplates, isSqlExecutionAllowed } from './seed';
import { SAMPLE_DASHBOARD } from './samples';
import { DashboardSchema, type Dashboard } from './types';
import { getModel } from './models/registry';

describe('DEFAULT_DASHBOARD', () => {
  it('is a valid dashboard whose widgets reference real models', () => {
    const d = DashboardSchema.parse(DEFAULT_DASHBOARD);
    expect(d.isDefault).toBe(true);
    for (const w of d.widgets) {
      if (w.query.mode === 'builder') expect(getModel(w.query.model)).toBeDefined();
    }
    expect(d.layout.length).toBe(d.widgets.length);
  });
});

describe('SAMPLE_DASHBOARD', () => {
  it('is a valid "default" dashboard with sql widgets', () => {
    expect(SAMPLE_DASHBOARD.id).toBe('default');
    expect(SAMPLE_DASHBOARD.isDefault).toBe(true);
    expect(SAMPLE_DASHBOARD.name).toBe('Lab Overview (Sample)');
    expect(SAMPLE_DASHBOARD.widgets.every((w) => w.query.mode === 'sql')).toBe(true);
  });

  it('declares the period variable as date-range (not text) on every widget that uses it', () => {
    const periodWidgets = SAMPLE_DASHBOARD.widgets.filter(
      (w) => w.query.mode === 'sql' && w.query.sql.includes('{{period_from}}'),
    );
    expect(periodWidgets.length).toBeGreaterThan(0);
    for (const w of periodWidgets) {
      const vars = w.query.mode === 'sql' ? w.query.variables : undefined;
      expect(vars?.period?.type).toBe('date-range');
    }
  });
});

describe('seedDefaultDashboard', () => {
  function fakeStore() {
    const rows: Dashboard[] = [];
    return {
      rows,
      get: async (id: string) => rows.find((d) => d.id === id),
      create: async (d: Dashboard) => { if (!rows.some((x) => x.id === d.id)) rows.push(d); return d; },
      update: async (id: string, d: Dashboard) => {
        const idx = rows.findIndex((x) => x.id === id);
        const next = { ...d, id };
        if (idx >= 0) rows[idx] = next; else rows.push(next);
        return next;
      },
    };
  }

  it('inserts the sample when absent', async () => {
    const s = fakeStore();
    expect(await seedDefaultDashboard(s)).toBe(1);
    expect(s.rows.map((d) => d.id)).toEqual(['default']);
  });

  it('no-ops when the stored "default" dashboard already matches the current sample', async () => {
    const s = fakeStore();
    await seedDefaultDashboard(s);
    expect(await seedDefaultDashboard(s)).toBe(0);
    expect(s.rows).toHaveLength(1);
  });

  it('creates the sample when absent', async () => {
    const rows = new Map<string, Dashboard>();
    const store = {
      get: async (id: string) => rows.get(id),
      create: async (d: Dashboard) => { rows.set(d.id, d); return d; },
      update: async (id: string, d: Dashboard) => { rows.set(id, { ...d, id }); return d; },
    };
    expect(await seedDefaultDashboard(store)).toBe(1);
    expect(rows.get('default')).toBeTruthy();
  });

  it('refreshes the sample when the stored content differs (managed-overwrite)', async () => {
    const stale = { ...SAMPLE_DASHBOARD, widgets: [] } as Dashboard;
    const rows = new Map<string, Dashboard>([['default', stale]]);
    const store = {
      get: async (id: string) => rows.get(id),
      create: async (d: Dashboard) => { rows.set(d.id, d); return d; },
      update: async (id: string, d: Dashboard) => { rows.set(id, { ...d, id }); return d; },
    };
    expect(await seedDefaultDashboard(store)).toBe(1);
    expect(rows.get('default')!.widgets.length).toBe(SAMPLE_DASHBOARD.widgets.length);
  });

  it('is a no-op when the stored sample already matches (idempotent)', async () => {
    const rows = new Map<string, Dashboard>([['default', SAMPLE_DASHBOARD]]);
    let updates = 0;
    const store = {
      get: async (id: string) => rows.get(id),
      create: async (d: Dashboard) => { rows.set(d.id, d); return d; },
      update: async (id: string, d: Dashboard) => { updates++; rows.set(id, { ...d, id }); return d; },
    };
    expect(await seedDefaultDashboard(store)).toBe(0);
    expect(updates).toBe(0);
  });
});

describe('vetted SQL execution', () => {
  it('collects trimmed sql from stored sql widgets plus first-party filter optionsSql', () => {
    const set = collectVettedSqlTemplates([SAMPLE_DASHBOARD, DEFAULT_DASHBOARD]);
    const sampleOptionsSql = SAMPLE_DASHBOARD.filters.filter((f) => f.optionsSql).length;
    // Sample: every sql widget + each filter's optionsSql. DEFAULT_DASHBOARD is all builder, filters [] → none.
    expect(set.size).toBe(SAMPLE_DASHBOARD.widgets.length + sampleOptionsSql);
    expect(set.has(String((SAMPLE_DASHBOARD.widgets[0].query as { sql: string }).sql).trim())).toBe(true);
  });

  it('collects optionsSql from dashboard filters (first-party filter dropdowns execute with the flag off)', () => {
    const filter = SAMPLE_DASHBOARD.filters.find((f) => f.optionsSql);
    expect(filter?.optionsSql).toBeTruthy();
    const vetted = collectVettedSqlTemplates([SAMPLE_DASHBOARD]);
    expect(vetted.has(filter!.optionsSql!.trim())).toBe(true);
    expect(isSqlExecutionAllowed(false, filter!.optionsSql!, vetted)).toBe(true);
  });

  it('collects optionsSql from a widget sql-query variable', () => {
    const dash: Dashboard = DashboardSchema.parse({
      id: 'd-var', name: 'Var', isDefault: false, refreshIntervalSec: 0, filters: [],
      widgets: [{
        id: 'w1', type: 'kpi', title: 'W1', refreshIntervalSec: 0, visual: {},
        query: {
          mode: 'sql', sql: 'SELECT 1 AS value',
          variables: { site: { type: 'text', label: 'Site', optionsSql: 'SELECT DISTINCT name FROM organizations ORDER BY name' } },
        },
      }],
      layout: [{ i: 'w1', x: 0, y: 0, w: 3, h: 2 }],
    });
    const vetted = collectVettedSqlTemplates([dash]);
    expect(vetted.has('SELECT DISTINCT name FROM organizations ORDER BY name')).toBe(true);
  });

  it('allows any sql when the flag is on', () => {
    expect(isSqlExecutionAllowed(true, 'select 42', new Set())).toBe(true);
  });

  it('with the flag off, allows only a template that matches the vetted set (trim-insensitive)', () => {
    const vetted = collectVettedSqlTemplates([SAMPLE_DASHBOARD]);
    const template = String((SAMPLE_DASHBOARD.widgets[0].query as { sql: string }).sql);
    expect(isSqlExecutionAllowed(false, `  ${template}  `, vetted)).toBe(true);
    expect(isSqlExecutionAllowed(false, 'select * from users', vetted)).toBe(false);
  });
});
