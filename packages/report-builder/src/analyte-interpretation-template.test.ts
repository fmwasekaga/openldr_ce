import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { runBuilderQuery, getModel } from '@openldr/dashboards';
import { buildAnalyteInterpretationTemplate, ANALYTE_INTERPRETATION_TEMPLATE_ID } from './analyte-interpretation-template';
import { ReportTemplateSchema } from './schema';
import { lintReportTemplate } from './lint';
import { resolveQueryParams } from './render/run-template';
import { matrixOpts, resultToMatrix } from './render/matrix-data';

function tableSource() {
  const t = buildAnalyteInterpretationTemplate();
  const block = t.rows.flatMap((r) => r.cells.map((c) => c.block)).find((b) => b.kind === 'table')!;
  return (block as { source: unknown }).source;
}

describe('analyte-interpretation crosstab template', () => {
  it('builds a schema-valid, published, lint-clean pivot table (dimension + breakdown)', () => {
    const t = buildAnalyteInterpretationTemplate();
    expect(t.id).toBe(ANALYTE_INTERPRETATION_TEMPLATE_ID);
    expect(t.status).toBe('published');
    expect(() => ReportTemplateSchema.parse(t)).not.toThrow();
    const issues = lintReportTemplate(t);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(issues.filter((i) => i.severity === 'warning')).toHaveLength(0);
    const table = t.rows.flatMap((r) => r.cells).find((c) => c.block.kind === 'table')!;
    const src = (table.block as { source: any }).source;
    expect(src.dimension).toEqual({ key: 'code_text' });
    expect(src.breakdown).toEqual({ key: 'interpretation_code' });
  });
});

describe('analyte-interpretation crosstab end-to-end (Slice E pivot acceptance)', () => {
  it('pivots per-analyte R/I/S counts into a wide matrix with 0-fill', async () => {
    const resolved = resolveQueryParams(tableSource() as never, {}); // unset range → date filters dropped
    const mem = newDb();
    mem.public.none('create table observations (code_text text, interpretation_code text, effective_date_time text)');
    mem.public.none(`insert into observations (code_text, interpretation_code) values
      ('Amp','R'),('Amp','R'),('Amp','S'),
      ('Cip','R'),('Cip','I')`);
    const db = mem.adapters.createKysely() as unknown as import('kysely').Kysely<any>;
    const longRes = await runBuilderQuery(db, getModel('observations')!, resolved as any);
    const matrix = resultToMatrix(longRes as any, matrixOpts(tableSource() as never)!);
    // columns: the row-dim label column + one per interpretation seen (R/I/S), order-independent
    expect(new Set(matrix.columns.map((c) => c.key))).toEqual(new Set(['label', 'R', 'I', 'S']));
    const amp = matrix.rows.find((r) => r.label === 'Amp')!;
    const cip = matrix.rows.find((r) => r.label === 'Cip')!;
    expect(amp).toMatchObject({ R: 2, S: 1, I: 0 }); // 0-fill for the absent I
    expect(cip).toMatchObject({ R: 1, I: 1, S: 0 }); // 0-fill for the absent S
  });
});
