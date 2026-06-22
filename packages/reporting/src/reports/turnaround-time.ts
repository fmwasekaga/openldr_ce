import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportDefinition, ReportResultData } from '../types';
import { hoursBetween, endOfDay, facilityOptions } from '../helpers';

const params = z.object({ from: z.string().optional(), to: z.string().optional(), facility: z.string().optional() });
type Params = z.infer<typeof params>;

export const turnaroundTime: ReportDefinition<Params> = {
  id: 'turnaround-time',
  name: 'Specimen Turnaround Time',
  description: 'Average hours from specimen received to report issued, by test.',
  params,
  category: 'operational',
  parameters: [
    { id: 'dateRange', label: 'Date range', type: 'daterange', required: false },
    { id: 'facility', label: 'Facility', type: 'select', required: false, optionsKey: 'facility' },
  ],
  summaryMetrics: [
    { id: 'avgHours', label: 'Avg hours', type: 'avg', column: 'avgHours' },
    { id: 'reports', label: 'Reports', type: 'sum', column: 'count' },
  ],
  options: facilityOptions,
  async run(db: Kysely<ExternalSchema>, p: Params): Promise<ReportResultData> {
    // No report->specimen link exists in the flat schema, so pair each report with
    // its patient's earliest specimen receipt. Two queries + JS pairing (one row per
    // report, no cross-join).
    let subjectRefs: string[] | null = null;
    if (p.facility) {
      const ids = await db.selectFrom('patients').select('id').where('managing_organization', '=', p.facility).execute();
      subjectRefs = ids.map((r) => `Patient/${r.id}`);
      if (subjectRefs.length === 0) return shape([]);
    }

    let rq = db.selectFrom('diagnostic_reports').select(['code_text as test', 'subject_ref', 'issued']);
    if (p.from) rq = rq.where('issued', '>=', p.from);
    if (p.to) rq = rq.where('issued', '<=', endOfDay(p.to));
    if (subjectRefs) rq = rq.where('subject_ref', 'in', subjectRefs);
    const reports = await rq.execute();

    const specs = await db.selectFrom('specimens').select(['subject_ref', 'received_time']).execute();
    const earliest = new Map<string, string>();
    for (const s of specs) {
      if (!s.subject_ref || !s.received_time) continue;
      const cur = earliest.get(s.subject_ref);
      if (!cur || s.received_time < cur) earliest.set(s.subject_ref, s.received_time);
    }

    const byTest = new Map<string, { test: string; n: number; sum: number; min: number; max: number }>();
    for (const r of reports) {
      const received = r.subject_ref ? earliest.get(r.subject_ref) ?? null : null;
      const h = hoursBetween(received, r.issued);
      if (h === null) continue;
      const test = r.test ?? '(unknown)';
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
    return shape(rows, overallAvg);
  },
};

function shape(rows: Record<string, unknown>[], overallAvg = 0): ReportResultData {
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
}
