import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportDefinition, ReportResultData } from '../types';
import { endOfDay } from '../helpers';

const params = z.object({ from: z.string().optional(), to: z.string().optional() });
type Params = z.infer<typeof params>;

const columns = [
  { key: 'facility', label: 'Facility', kind: 'string' as const },
  { key: 'tested', label: 'Tested', kind: 'number' as const },
  { key: 'resistant', label: 'Resistant', kind: 'number' as const },
];

function emptyResult(): ReportResultData {
  return { columns, rows: [], chart: { type: 'bar', x: 'facility', y: 'resistant' } };
}

/**
 * AMR resistance counts in WIDE format: one row per facility, with `tested` (all AST results) and
 * `resistant` (R results) as numeric metric columns. Unlike `amr-resistance` (long format, one row
 * per antibiotic, no facility dimension), this shape fits the DHIS2 aggregate mapping model — a
 * per-row org-unit column (`facility`) plus metric columns that map to dataElements — so the
 * sample DHIS2 push actually produces dataValues. Facility = the patient's managing_organization.
 */
export const amrFacilitySummary: ReportDefinition<Params> = {
  id: 'amr-facility-summary',
  name: 'AMR Resistance by Facility',
  description: 'Tested vs resistant AST-result counts per facility (wide format for DHIS2 aggregate push).',
  params,
  category: 'amr',
  parameters: [{ id: 'dateRange', label: 'Date range', type: 'daterange', required: false }],
  summaryMetrics: [
    { id: 'facilities', label: 'Facilities', type: 'count' },
    { id: 'tested', label: 'Tested', type: 'sum', column: 'tested' },
  ],
  async run(db: Kysely<ExternalSchema>, p: Params): Promise<ReportResultData> {
    let q = db
      .selectFrom('observations')
      .where('interpretation_code', 'in', ['S', 'I', 'R'])
      .select(['interpretation_code', 'subject_ref']);
    if (p.from) q = q.where('effective_date_time', '>=', p.from);
    if (p.to) q = q.where('effective_date_time', '<=', endOfDay(p.to));
    const obs = await q.execute();
    if (obs.length === 0) return emptyResult();

    const patientIds = [
      ...new Set(
        obs.map((o) => o.subject_ref).filter((s): s is string => !!s).map((s) => s.replace(/^Patient\//, '')),
      ),
    ];
    const patients = patientIds.length
      ? await db.selectFrom('patients').select(['id', 'managing_organization']).where('id', 'in', patientIds).execute()
      : [];
    const facilityById = new Map(patients.map((pt) => [pt.id, pt.managing_organization]));

    // Aggregate per facility. Observations whose patient has no facility can't be attributed to an
    // org unit, so they're dropped here (they'd otherwise have an empty `facility` and skip at push).
    const byFacility = new Map<string, { tested: number; resistant: number }>();
    for (const o of obs) {
      const pid = o.subject_ref ? o.subject_ref.replace(/^Patient\//, '') : null;
      const facility = pid ? facilityById.get(pid) ?? null : null;
      if (!facility) continue;
      const cur = byFacility.get(facility) ?? { tested: 0, resistant: 0 };
      cur.tested += 1;
      if (o.interpretation_code === 'R') cur.resistant += 1;
      byFacility.set(facility, cur);
    }
    const rows = [...byFacility.entries()]
      .map(([facility, c]) => ({ facility, tested: c.tested, resistant: c.resistant }))
      .sort((a, b) => a.facility.localeCompare(b.facility));
    return { columns, rows, chart: { type: 'bar', x: 'facility', y: 'resistant' } };
  },
};
