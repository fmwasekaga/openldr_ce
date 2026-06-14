import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportColumn, ReportDefinition, ReportResultData } from '../types';
import { fetchAmrData } from '../amr/query';
import { buildIsolates, firstIsolate } from '../amr/isolates';
import { antibiogram } from '../amr/aggregate';

const params = z.object({ from: z.string().optional(), to: z.string().optional() });
type Params = z.infer<typeof params>;

export const amrAntibiogram: ReportDefinition<Params> = {
  id: 'amr-antibiogram',
  name: 'AMR Cumulative Antibiogram',
  description: 'First-isolate %R matrix of pathogen x antibiotic (cell = %R with N tested).',
  params,
  async run(db: Kysely<ExternalSchema>, p: Params): Promise<ReportResultData> {
    const data = await fetchAmrData(db, p);
    const matrix = antibiogram(firstIsolate(buildIsolates(data.org, data.ast, data.specimens, data.patients)));
    const antibiotics = [...new Set(matrix.flatMap((m) => Object.keys(m.byAntibiotic)))].sort();
    const columns: ReportColumn[] = [{ key: 'pathogen', label: 'Pathogen', kind: 'string' }, ...antibiotics.map((a) => ({ key: a, label: a, kind: 'string' as const }))];
    const rows = matrix.map((m) => {
      const row: Record<string, unknown> = { pathogen: m.pathogen };
      for (const a of antibiotics) {
        const cell = m.byAntibiotic[a];
        row[a] = cell ? `${cell.percentR}% (${cell.tested})` : '';
      }
      return row;
    });
    return { columns, rows, chart: { type: 'stat', value: String(matrix.length), label: 'pathogens' } };
  },
};
