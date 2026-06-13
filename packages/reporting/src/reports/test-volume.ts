import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportDefinition, ReportResultData } from '../types';
import { monthKey } from '../helpers';

const params = z.object({ from: z.string().optional(), to: z.string().optional(), facility: z.string().optional() });
type Params = z.infer<typeof params>;

export const testVolume: ReportDefinition<Params> = {
  id: 'test-volume',
  name: 'Test Volume Over Time',
  description: 'Count of service requests by test and month.',
  params,
  async run(db: Kysely<ExternalSchema>, p: Params): Promise<ReportResultData> {
    let q = db.selectFrom('service_requests').select(['code_text', 'authored_on']);
    if (p.from) q = q.where('authored_on', '>=', p.from);
    if (p.to) q = q.where('authored_on', '<=', p.to);
    const reqs = await q.execute();
    const counts = new Map<string, number>();
    for (const r of reqs) {
      const key = `${monthKey(r.authored_on)} ${r.code_text ?? '(unknown)'}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const rows = [...counts.entries()]
      .map(([k, count]) => {
        const [month, test] = k.split(' ');
        return { month, test, count };
      })
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
