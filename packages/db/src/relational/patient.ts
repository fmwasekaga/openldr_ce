import type { Provenance } from '../provenance';
import type { Insertable } from 'kysely';
import type { V2PatientsTable } from '../schema/external';
import { provColumns, firstIdentifier, str, reference } from '../flatten/extract';

const SEX: Record<string, string> = { male: 'M', female: 'F', other: 'O', unknown: 'U' };

export function projectPatient(r: Record<string, unknown>, prov: Provenance): Insertable<V2PatientsTable> {
  const idn = firstIdentifier(r);
  const name = (r['name'] as Record<string, unknown>[] | undefined)?.[0];
  const telecom = (r['telecom'] as Record<string, unknown>[] | undefined) ?? [];
  const gender = str(r['gender']);
  return {
    id: String(r['id']),
    patient_guid: idn.value,
    surname: str(name?.['family']),
    firstname: str((name?.['given'] as string[] | undefined)?.[0]),
    date_of_birth: str(r['birthDate']),
    sex: gender ? (SEX[gender] ?? 'U') : null,
    national_id: null,
    phone: str(telecom.find((t) => t['system'] === 'phone')?.['value']),
    email: str(telecom.find((t) => t['system'] === 'email')?.['value']),
    managing_organization: reference(r['managingOrganization']),
    ...provColumns(prov),
  };
}
