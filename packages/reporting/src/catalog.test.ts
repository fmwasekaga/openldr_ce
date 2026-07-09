import { describe, it, expect } from 'vitest';
import { reportCatalog, getReport, reportSummaries } from './catalog';

describe('catalog', () => {
  it('exposes amr-antibiogram (the last catalog report; the other 7 are data-driven — see Slice S5)', () => {
    expect(reportCatalog().map((r) => r.id).sort()).toEqual(['amr-antibiogram']);
  });
  it('getReport finds and misses', () => {
    expect(getReport('amr-antibiogram')?.name).toBe('AMR Cumulative Antibiogram');
    expect(getReport('nope')).toBeUndefined();
  });
  it('amr params accept empty', () => {
    expect(getReport('amr-antibiogram')!.params.safeParse({}).success).toBe(true);
  });
  it('reportSummaries returns id+name+description', () => {
    expect(reportSummaries()[0]).toHaveProperty('description');
  });
  it('marks catalog reports with source "catalog"', () => {
    expect(reportSummaries().every((s) => s.source === 'catalog')).toBe(true);
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

  it('reportSummaries() exposes the enriched metadata', () => {
    const s = reportSummaries().find((r) => r.id === 'amr-antibiogram')!;
    expect(s.category).toBe('amr');
    expect(s.parameters.some((p) => p.type === 'daterange')).toBe(true);
  });

  it('reports with a facility select expose an options resolver', () => {
    const withFacility = reportCatalog().filter((r) => r.parameters.some((p) => p.optionsKey === 'facility'));
    for (const def of withFacility) expect(typeof def.options).toBe('function');
  });
});
