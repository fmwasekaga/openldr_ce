import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportDefinition, ReportResultData } from '../types';
import { fetchAmrData } from '../amr/query';
import { buildIsolates, firstIsolate } from '../amr/isolates';
import { aggregateRIS } from '../amr/aggregate';

const params = z.object({ from: z.string().optional(), to: z.string().optional() });
type Params = z.infer<typeof params>;

export const amrFirstIsolateSummary: ReportDefinition<Params> = {
  id: 'amr-first-isolate-summary',
  name: 'AMR First-Isolate Resistance Summary',
  description: 'R/I/S counts and %R by specimen type, pathogen, and antibiotic (first isolate per patient).',
  params,
  category: 'amr',
  parameters: [{ id: 'dateRange', label: 'Date range', type: 'daterange', required: false }],
  summaryMetrics: [{ id: 'avgR', label: 'Avg %R', type: 'avg', column: 'percentR' }],
  async run(db: Kysely<ExternalSchema>, p: Params): Promise<ReportResultData> {
    const data = await fetchAmrData(db, p);
    const rows = aggregateRIS(firstIsolate(buildIsolates(data.org, data.ast, data.specimens, data.patients)));
    return {
      columns: [
        { key: 'specimenType', label: 'Specimen', kind: 'string' },
        { key: 'pathogen', label: 'Pathogen', kind: 'string' },
        { key: 'antibiotic', label: 'Antibiotic', kind: 'string' },
        { key: 'tested', label: 'Tested', kind: 'number' },
        { key: 'r', label: 'R', kind: 'number' },
        { key: 'i', label: 'I', kind: 'number' },
        { key: 's', label: 'S', kind: 'number' },
        { key: 'percentR', label: '%R', kind: 'percent' },
      ],
      rows: rows as unknown as Record<string, unknown>[],
      chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
    };
  },
};
