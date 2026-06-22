import { describe, it, expect } from 'vitest';
import { reportCatalog, getReport, reportSummaries } from './catalog';

describe('catalog', () => {
  it('exposes the seven reports', () => {
    expect(reportCatalog().map((r) => r.id).sort()).toEqual(['amr-antibiogram', 'amr-first-isolate-summary', 'amr-glass-ris', 'amr-resistance', 'patient-demographics', 'test-volume', 'turnaround-time']);
  });
  it('getReport finds and misses', () => {
    expect(getReport('amr-resistance')?.name).toBe('AMR Resistance Rate');
    expect(getReport('nope')).toBeUndefined();
  });
  it('amr params reject wrong-typed input but accept empty', () => {
    expect(getReport('amr-resistance')!.params.safeParse({}).success).toBe(true);
    expect(getReport('amr-resistance')!.params.safeParse({ from: 5 }).success).toBe(false);
  });
  it('reportSummaries returns id+name+description', () => {
    expect(reportSummaries()[0]).toHaveProperty('description');
  });
});

describe('report catalog metadata', () => {
  it('every report declares a category and parameter list', () => {
    for (const def of reportCatalog()) {
      expect(['amr', 'operational', 'quality', 'regulatory']).toContain(def.category);
      expect(Array.isArray(def.parameters)).toBe(true);
      for (const p of def.parameters) {
        expect(['daterange', 'select', 'text']).toContain(p.type);
        if (p.type === 'select') expect(typeof p.optionsKey).toBe('string');
      }
    }
  });

  it('summary metrics reference columns the report can produce', () => {
    const amr = reportCatalog().find((r) => r.id === 'amr-resistance')!;
    const cols = ['antibiotic', 'tested', 'r', 'i', 's', 'percentR'];
    for (const m of amr.summaryMetrics ?? []) {
      if (m.column) expect(cols).toContain(m.column);
    }
  });

  it('reportSummaries() exposes the enriched metadata', () => {
    const s = reportSummaries().find((r) => r.id === 'test-volume')!;
    expect(s.category).toBe('operational');
    expect(s.parameters.some((p) => p.type === 'daterange')).toBe(true);
  });

  it('reports with a facility select expose an options resolver', () => {
    const withFacility = reportCatalog().filter((r) => r.parameters.some((p) => p.optionsKey === 'facility'));
    for (const def of withFacility) expect(typeof def.options).toBe('function');
  });
});
