import { describe, it, expect } from 'vitest';
import { listStarters, getStarterTemplate, STARTER_IDS } from './index';
import { ReportTemplateSchema } from '../schema';
import { lintReportTemplate } from '../lint';

describe('starter registry', () => {
  it('lists all starters in order, blank first', () => {
    const metas = listStarters();
    expect(metas.map((m) => m.id)).toEqual(['blank', 'amr-resistance', 'test-volume', 'patient-demographics', 'specimen-results']);
    expect(metas[0]).toMatchObject({ id: 'blank', category: 'general' });
    for (const m of metas) expect(typeof m.category).toBe('string');
  });

  it('every starter builds a schema-valid, draft, lint-clean template', () => {
    for (const id of STARTER_IDS) {
      const t = getStarterTemplate(id);
      expect(() => ReportTemplateSchema.parse(t)).not.toThrow();
      expect(t.status).toBe('draft');
      const issues = lintReportTemplate(t);
      const errors = issues.filter((i) => i.severity === 'error');
      // `blank` is intentionally a zero-rows canvas (see the dedicated test below), so
      // lint's `empty-report` warning ("Report has no data blocks") is expected there —
      // it is not a defect in the starter. Every other starter must be fully warning-free.
      const warnings = issues.filter((i) => i.severity === 'warning' && !(id === 'blank' && i.code === 'empty-report'));
      expect(errors, `${id} errors: ${JSON.stringify(errors)}`).toHaveLength(0);
      expect(warnings, `${id} warnings: ${JSON.stringify(warnings)}`).toHaveLength(0);
    }
  });

  it('blank is an empty-rows template', () => {
    expect(getStarterTemplate('blank').rows).toHaveLength(0);
  });

  it('the amr-resistance starter reuses the resistance table (observations)', () => {
    const t = getStarterTemplate('amr-resistance');
    const table = t.rows.flatMap((r) => r.cells).find((c) => c.block.kind === 'table');
    expect(table?.block).toMatchObject({ kind: 'table' });
  });

  it('throws on an unknown starter id', () => {
    expect(() => getStarterTemplate('nope' as never)).toThrow();
  });
});
