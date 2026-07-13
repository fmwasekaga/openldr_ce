import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { V2FacilitiesTable } from '../schema/external';
import { provColumns, firstIdentifier, codeable, str } from './extract';

// Both Organization and Location project here, keyed by their own FHIR id; source_resource discriminates.
export function projectFacility(r: Record<string, unknown>, prov: Provenance): Insertable<V2FacilitiesTable> {
  const idn = firstIdentifier(r);
  const type = codeable((r['type'] as unknown[] | undefined)?.[0]);
  return {
    id: String(r['id']),
    facility_code: idn.value,
    facility_name: str(r['name']),
    facility_type: type.text,
    source_resource: str(r['resourceType']),
    ...provColumns(prov),
  };
}
