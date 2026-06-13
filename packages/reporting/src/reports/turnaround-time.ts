import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportDefinition, ReportResultData } from '../types';
import { hoursBetween } from '../helpers';

const params = z.object({ from: z.string().optional(), to: z.string().optional(), facility: z.string().optional() });
type Params = z.infer<typeof params>;

export const turnaroundTime: ReportDefinition<Params> = {
  id: 'turnaround-time',
  name: 'Specimen Turnaround Time',
  description: 'Average hours from specimen received to report issued, by test.',
  params,
  async run(db: Kysely<ExternalSchema>, p: Params): Promise<ReportResultData> {
    let q = db
      .selectFrom('diagnostic_reports as dr')
      .innerJoin('specimens as sp', 'sp.subject_ref', 'dr.subject_ref')
      .select(['dr.code_text as test', 'sp.received_time as received', 'dr.issued as issued']);
    if (p.from) q = q.where('dr.issued', '>=', p.from);
    if (p.to) q = q.where('dr.issued', '<=', p.to);
    const joined = await q.execute();
    const byTest = new Map<string, { test: string; n: number; sum: number; min: number; max: number }>();
    for (const row of joined) {
      const h = hoursBetween(row.received, row.issued);
      if (h === null) continue;
      const test = row.test ?? '(unknown)';
      const e = byTest.get(test) ?? { test, n: 0, sum: 0, min: h, max: h };
      e.n++;
      e.sum += h;
      e.min = Math.min(e.min, h);
      e.max = Math.max(e.max, h);
      byTest.set(test, e);
    }
    const rows = [...byTest.values()].map((e) => ({ test: e.test, count: e.n, avgHours: Math.round((e.sum / e.n) * 10) / 10, minHours: e.min, maxHours: e.max }));
    rows.sort((a, b) => b.avgHours - a.avgHours);
    const overallN = rows.reduce((s, r) => s + r.count, 0);
    const overallAvg = overallN === 0 ? 0 : Math.round((rows.reduce((s, r) => s + r.avgHours * r.count, 0) / overallN) * 10) / 10;
    return {
      columns: [
        { key: 'test', label: 'Test', kind: 'string' },
        { key: 'count', label: 'Reports', kind: 'number' },
        { key: 'avgHours', label: 'Avg hours', kind: 'number' },
        { key: 'minHours', label: 'Min', kind: 'number' },
        { key: 'maxHours', label: 'Max', kind: 'number' },
      ],
      rows,
      chart: { type: 'stat', value: String(overallAvg), label: 'Overall avg hours' },
    };
  },
};
