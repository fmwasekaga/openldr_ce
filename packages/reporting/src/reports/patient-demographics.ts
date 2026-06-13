import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportDefinition, ReportResultData } from '../types';
import { ageBand } from '../helpers';

const params = z.object({ facility: z.string().optional(), asOf: z.string().optional() });
type Params = z.infer<typeof params>;

const ORDER = ['0-4', '5-14', '15-24', '25-49', '50+', 'unknown'];

export const patientDemographics: ReportDefinition<Params> = {
  id: 'patient-demographics',
  name: 'Patient Demographics',
  description: 'Patient counts by age band and gender.',
  params,
  async run(db: Kysely<ExternalSchema>, p: Params): Promise<ReportResultData> {
    let q = db.selectFrom('patients').select(['gender', 'birth_date']);
    if (p.facility) q = q.where('managing_organization', '=', p.facility);
    const patients = await q.execute();
    const ref = p.asOf ?? '2026-01-01T00:00:00Z';
    const counts = new Map<string, { band: string; total: number; male: number; female: number; other: number }>();
    for (const pt of patients) {
      const band = ageBand(pt.birth_date, ref);
      const e = counts.get(band) ?? { band, total: 0, male: 0, female: 0, other: 0 };
      e.total++;
      if (pt.gender === 'male') e.male++;
      else if (pt.gender === 'female') e.female++;
      else e.other++;
      counts.set(band, e);
    }
    const rows = ORDER.filter((b) => counts.has(b)).map((b) => counts.get(b)!);
    return {
      columns: [
        { key: 'band', label: 'Age band', kind: 'string' },
        { key: 'total', label: 'Total', kind: 'number' },
        { key: 'male', label: 'Male', kind: 'number' },
        { key: 'female', label: 'Female', kind: 'number' },
        { key: 'other', label: 'Other/unknown', kind: 'number' },
      ],
      rows,
      chart: { type: 'pie', label: 'band', value: 'total' },
    };
  },
};
