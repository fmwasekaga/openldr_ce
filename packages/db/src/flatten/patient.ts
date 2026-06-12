import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { PatientsTable } from '../schema/external';
import { provColumns, firstIdentifier, reference, str } from './extract';

export function flattenPatient(r: Record<string, unknown>, prov: Provenance): Insertable<PatientsTable> {
  const idn = firstIdentifier(r);
  const name = (r['name'] as Record<string, unknown>[] | undefined)?.[0];
  return {
    id: String(r['id']),
    identifier_system: idn.system,
    identifier_value: idn.value,
    family_name: str(name?.['family']),
    given_name: str((name?.['given'] as string[] | undefined)?.[0]),
    gender: str(r['gender']),
    birth_date: str(r['birthDate']),
    managing_organization: reference(r['managingOrganization']),
    ...provColumns(prov),
  };
}
