import { parse } from 'csv-parse/sync';
import type { ConceptRecord } from '@openldr/db';

export const TERMS_CSV_TEMPLATE = 'code,display,shortName,class,unit,status\n';

/** Parse a terms CSV (code,display,shortName,class,unit,status) into ConceptRecord[]
 *  for one coding system. Blank-code rows are skipped; extra columns go to properties. */
export function parseTermsCsv(csv: string, systemUrl: string): ConceptRecord[] {
  const records = parse(csv, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  return records
    .filter((r) => (r.code ?? '').trim())
    .map((r) => {
      const props: Record<string, unknown> = {};
      if (r.shortName) props.shortName = r.shortName;
      if (r.class) props.class = r.class;
      if (r.unit) props.unit = r.unit;
      return {
        system: systemUrl,
        code: r.code.trim(),
        display: r.display?.trim() || null,
        status: r.status?.trim() || 'ACTIVE',
        properties: Object.keys(props).length ? props : null,
      };
    });
}
