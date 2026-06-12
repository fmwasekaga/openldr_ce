import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { SpecimensTable } from '../schema/external';
import { provColumns, firstIdentifier, codeable, reference, str } from './extract';

export function flattenSpecimen(r: Record<string, unknown>, prov: Provenance): Insertable<SpecimensTable> {
  const idn = firstIdentifier(r);
  const type = codeable(r['type']);
  const accession = (r['accessionIdentifier'] as Record<string, unknown> | undefined)?.['value'];
  const parent = (r['parent'] as Record<string, unknown>[] | undefined)?.[0];
  return {
    id: String(r['id']),
    identifier_value: idn.value,
    accession: str(accession),
    status: str(r['status']),
    type_code: type.code,
    type_text: type.text,
    subject_ref: reference(r['subject']),
    parent_ref: reference(parent),
    received_time: str(r['receivedTime']),
    ...provColumns(prov),
  };
}
