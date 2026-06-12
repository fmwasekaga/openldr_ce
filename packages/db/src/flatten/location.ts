import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { LocationsTable } from '../schema/external';
import { provColumns, firstIdentifier, codeable, reference, str } from './extract';

export function flattenLocation(r: Record<string, unknown>, prov: Provenance): Insertable<LocationsTable> {
  const idn = firstIdentifier(r);
  const type = codeable((r['type'] as unknown[] | undefined)?.[0]);
  return {
    id: String(r['id']),
    identifier_value: idn.value,
    status: str(r['status']),
    name: str(r['name']),
    type_text: type.text,
    managing_organization: reference(r['managingOrganization']),
    part_of_ref: reference(r['partOf']),
    ...provColumns(prov),
  };
}
