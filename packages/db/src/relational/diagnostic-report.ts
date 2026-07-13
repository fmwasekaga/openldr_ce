import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { V2DiagnosticReportsTable } from '../schema/external';
import { provColumns, codeable, referenceId, str } from '../flatten/extract';

export function projectDiagnosticReport(r: Record<string, unknown>, prov: Provenance): Insertable<V2DiagnosticReportsTable> {
  const code = codeable(r['code']);
  return {
    id: String(r['id']),
    patient_id: referenceId(r['subject']),
    status: str(r['status']),
    code_code: code.code,
    code_text: code.text,
    issued: str(r['issued']),
    effective: str(r['effectiveDateTime']),
    conclusion: str(r['conclusion']),
    ...provColumns(prov),
  };
}
