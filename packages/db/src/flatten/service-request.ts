import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { ServiceRequestsTable } from '../schema/external';
import { provColumns, firstIdentifier, codeable, reference, str } from './extract';

export function flattenServiceRequest(r: Record<string, unknown>, prov: Provenance): Insertable<ServiceRequestsTable> {
  const idn = firstIdentifier(r);
  const code = codeable(r['code']);
  return {
    id: String(r['id']),
    identifier_value: idn.value,
    status: str(r['status']),
    intent: str(r['intent']),
    priority: str(r['priority']),
    code_code: code.code,
    code_text: code.text,
    subject_ref: reference(r['subject']),
    authored_on: str(r['authoredOn']),
    ...provColumns(prov),
  };
}
