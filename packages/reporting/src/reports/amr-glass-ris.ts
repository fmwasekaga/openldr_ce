import { z } from 'zod';
import type { ZodType } from 'zod';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportDefinition, ReportResultData } from '../types';
import { fetchAmrData } from '../amr/query';
import { buildIsolates, firstIsolate } from '../amr/isolates';
import { toGlassRis } from '../amr/glass';

const params = z.object({ from: z.string().optional(), to: z.string().optional(), country: z.string().default('XXX'), year: z.coerce.number().default(0) });
type Params = z.infer<typeof params>;

export const amrGlassRis: ReportDefinition<Params> = {
  id: 'amr-glass-ris',
  name: 'AMR GLASS RIS (stratified)',
  description: 'First-isolate R/I/S counts stratified by specimen, pathogen, antibiotic, gender, age group, origin (GLASS submission shape).',
  params: params as ZodType<Params>,
  async run(db: Kysely<ExternalSchema>, p: Params): Promise<ReportResultData> {
    const data = await fetchAmrData(db, p);
    const rows = toGlassRis(firstIsolate(buildIsolates(data.org, data.ast, data.specimens, data.patients)), { country: p.country, year: p.year });
    return {
      columns: [
        { key: 'Specimen', label: 'Specimen', kind: 'string' }, { key: 'PathogenCode', label: 'Pathogen', kind: 'string' },
        { key: 'AntibioticCode', label: 'Antibiotic', kind: 'string' }, { key: 'Gender', label: 'Gender', kind: 'string' },
        { key: 'AgeGroup', label: 'Age', kind: 'string' }, { key: 'Origin', label: 'Origin', kind: 'string' },
        { key: 'Resistant', label: 'R', kind: 'number' }, { key: 'Intermediate', label: 'I', kind: 'number' },
        { key: 'Susceptible', label: 'S', kind: 'number' }, { key: 'Total', label: 'Total', kind: 'number' },
      ],
      rows: rows as unknown as Record<string, unknown>[],
      chart: { type: 'stat', value: String(rows.length), label: 'strata' },
    };
  },
};
