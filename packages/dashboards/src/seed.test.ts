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
    };
  }

  it('inserts the sample when absent', async () => {
    const s = fakeStore();
    expect(await seedDefaultDashboard(s)).toBe(1);
    expect(s.rows.map((d) => d.id)).toEqual(['default']);
  });

  it('no-ops when a dashboard with id "default" already exists', async () => {
    const s = fakeStore();
    await seedDefaultDashboard(s);
    expect(await seedDefaultDashboard(s)).toBe(0);
    expect(s.rows).toHaveLength(1);
  });
});

describe('vetted SQL execution', () => {
  it('collects trimmed sql templates from stored sql widgets only', () => {
    const set = collectVettedSqlTemplates([SAMPLE_DASHBOARD, DEFAULT_DASHBOARD]);
    // The sample's 13 sql widgets are collected; DEFAULT_DASHBOARD is all builder → none.
    expect(set.size).toBe(SAMPLE_DASHBOARD.widgets.length);
    expect(set.has(String((SAMPLE_DASHBOARD.widgets[0].query as { sql: string }).sql).trim())).toBe(true);
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
