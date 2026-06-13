import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportDefinition, ReportResultData } from '../types';
import { pivotResistance, endOfDay } from '../helpers';

const params = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  facility: z.string().optional(),
});
type Params = z.infer<typeof params>;

function emptyResult(): ReportResultData {
  return {
    columns: [
      { key: 'antibiotic', label: 'Antibiotic', kind: 'string' },
      { key: 'tested', label: 'Tested', kind: 'number' },
      { key: 'r', label: 'R', kind: 'number' },
      { key: 'i', label: 'I', kind: 'number' },
      { key: 's', label: 'S', kind: 'number' },
      { key: 'percentR', label: '%R', kind: 'percent' },
    ],
    rows: [],
    chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
  };
}

export const amrResistance: ReportDefinition<Params> = {
  id: 'amr-resistance',
  name: 'AMR Resistance Rate',
  description: 'Resistant/Intermediate/Susceptible counts and %R by antibiotic.',
  params,
  async run(db: Kysely<ExternalSchema>, p: Params): Promise<ReportResultData> {
    let subjectRefs: string[] | null = null;
    if (p.facility) {
      const ids = await db.selectFrom('patients').select('id').where('managing_organization', '=', p.facility).execute();
      subjectRefs = ids.map((r) => `Patient/${r.id}`);
      if (subjectRefs.length === 0) return emptyResult();
    }
    let q = db
      .selectFrom('observations')
      .where('interpretation_code', 'in', ['S', 'I', 'R'])
      .select(['code_text as antibiotic', 'interpretation_code'])
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .groupBy(['code_text', 'interpretation_code']);
    if (p.from) q = q.where('effective_date_time', '>=', p.from);
    if (p.to) q = q.where('effective_date_time', '<=', endOfDay(p.to));
    if (subjectRefs) q = q.where('subject_ref', 'in', subjectRefs);
    const grouped = await q.execute();
    const pivoted = pivotResistance(
      grouped.map((r) => ({ antibiotic: r.antibiotic ?? '(unknown)', interpretation_code: String(r.interpretation_code), n: Number(r.n) })),
    );
    return { ...emptyResult(), rows: pivoted };
  },
};
