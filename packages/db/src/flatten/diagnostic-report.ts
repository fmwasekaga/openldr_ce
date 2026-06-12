import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { DiagnosticReportsTable } from '../schema/external';
import { provColumns, firstIdentifier, codeable, reference, str } from './extract';

export function flattenDiagnosticReport(r: Record<string, unknown>, prov: Provenance): Insertable<DiagnosticReportsTable> {
  const idn = firstIdentifier(r);
  const code = codeable(r['code']);
  return {
    id: String(r['id']),
    identifier_value: idn.value,
    status: str(r['status']),
    code_code: code.code,
    code_text: code.text,
    subject_ref: reference(r['subject']),
    effective_date_time: str(r['effectiveDateTime']),
    issued: str(r['issued']),
    conclusion: str(r['conclusion']),
    ...provColumns(prov),
  };
}
