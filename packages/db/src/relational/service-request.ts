import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { LabRequestsTable } from '../schema/external';
import { provColumns, firstIdentifier, codeable, referenceId, str } from './extract';

export function projectServiceRequest(r: Record<string, unknown>, prov: Provenance): Insertable<LabRequestsTable> {
  const idn = firstIdentifier(r);
  const code = codeable(r['code']);
  return {
    id: String(r['id']),
    request_id: idn.value,
    patient_id: referenceId(r['subject']),
    panel_code: code.code,
    panel_system: code.system,
    panel_desc: code.text,
    status: str(r['status']),
    priority: str(r['priority']),
    authored_at: str(r['authoredOn']),
    ...provColumns(prov),
  };
}
