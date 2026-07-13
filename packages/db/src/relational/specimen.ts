import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { V2SpecimensTable } from '../schema/external';
import { readSpecimenOrigin } from '@openldr/fhir';
import { provColumns, codeable, referenceId, str } from './extract';

export function projectSpecimen(r: Record<string, unknown>, prov: Provenance): Insertable<V2SpecimensTable> {
  const type = codeable(r['type']);
  const accession = (r['accessionIdentifier'] as Record<string, unknown> | undefined)?.['value'];
  const collected = (r['collection'] as Record<string, unknown> | undefined)?.['collectedDateTime'];
  return {
    id: String(r['id']),
    patient_id: referenceId(r['subject']),
    received_time: str(r['receivedTime']) ?? str(collected),
    accession: str(accession),
    status: str(r['status']),
    type_code: type.code,
    type_text: type.text,
    origin: readSpecimenOrigin(r),
    ...provColumns(prov),
  };
}
