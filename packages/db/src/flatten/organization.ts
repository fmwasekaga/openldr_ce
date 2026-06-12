import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { OrganizationsTable } from '../schema/external';
import { provColumns, firstIdentifier, codeable, reference, str } from './extract';

export function flattenOrganization(r: Record<string, unknown>, prov: Provenance): Insertable<OrganizationsTable> {
  const idn = firstIdentifier(r);
  const type = codeable((r['type'] as unknown[] | undefined)?.[0]);
  return {
    id: String(r['id']),
    identifier_value: idn.value,
    name: str(r['name']),
    type_text: type.text,
    part_of_ref: reference(r['partOf']),
    ...provColumns(prov),
  };
}
