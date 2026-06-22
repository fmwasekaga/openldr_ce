import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportDefinition, ReportResultData } from '../types';
import { monthKey, endOfDay, facilityOptions } from '../helpers';

const params = z.object({ from: z.string().optional(), to: z.string().optional(), facility: z.string().optional() });
type Params = z.infer<typeof params>;

export const testVolume: ReportDefinition<Params> = {
  id: 'test-volume',
  name: 'Test Volume Over Time',
  description: 'Count of service requests by test and month.',
  params,
  category: 'operational',
  parameters: [
    { id: 'dateRange', label: 'Date range', type: 'daterange', required: false },
    { id: 'facility', label: 'Facility', type: 'select', required: false, optionsKey: 'facility' },
  ],
  summaryMetrics: [{ id: 'total', label: 'Total tests', type: 'sum', column: 'count' }],
  options: facilityOptions,
  async run(db: Kysely<ExternalSchema>, p: Params): Promise<ReportResultData> {
    let q = db.selectFrom('service_requests').select(['code_text', 'authored_on']);
    if (p.from) q = q.where('authored_on', '>=', p.from);
    if (p.to) q = q.where('authored_on', '<=', endOfDay(p.to));
    const reqs = await q.execute();
    // Count by month -> test. A nested map avoids round-tripping through a
    // space-joined string key, which would truncate multi-word test names
    // (e.g. "Blood culture") at their first space on the way back out.
    const counts = new Map<string, Map<string, number>>();
    for (const r of reqs) {
      const month = monthKey(r.authored_on);
      const test = r.code_text ?? '(unknown)';
      let byTest = counts.get(month);
      if (!byTest) {
        byTest = new Map();
        counts.set(month, byTest);
      }
      byTest.set(test, (byTest.get(test) ?? 0) + 1);
    }
    const rows = [...counts.entries()]
      .flatMap(([month, byTest]) => [...byTest.entries()].map(([test, count]) => ({ month, test, count })))
      .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.test.localeCompare(b.test)));
    return {
      columns: [
        { key: 'month', label: 'Month', kind: 'string' },
        { key: 'test', label: 'Test', kind: 'string' },
        { key: 'count', label: 'Count', kind: 'number' },
      ],
      rows,
      chart: { type: 'line', x: 'month', y: 'count', series: 'test' },
    };
  },
};
