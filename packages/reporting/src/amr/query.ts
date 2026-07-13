import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import { endOfDay } from '../helpers';
import type { RawAstObs, RawOrgObs, RawPatient, RawSpecimen } from './types';

export interface AmrWindow { from?: string; to?: string }
export interface AmrData { org: RawOrgObs[]; ast: RawAstObs[]; specimens: RawSpecimen[]; patients: RawPatient[] }

const genderFromSex = (sex: string | null): string =>
  sex === 'M' ? 'male' : sex === 'F' ? 'female' : sex === 'O' ? 'other' : 'unknown';

export async function fetchAmrData(db: Kysely<ExternalSchema>, w: AmrWindow): Promise<AmrData> {
  const orgRows = await db.selectFrom('v2_lab_results').where('observation_code', '=', '634-6')
    .select(['id', 'patient_id', 'specimen_id', 'coded_value', 'text_value', 'result_timestamp']).execute();
  const astRows = await db.selectFrom('v2_lab_results').where('abnormal_flag', 'in', ['S', 'I', 'R'])
    .select(['id', 'patient_id', 'specimen_id', 'observation_desc', 'abnormal_flag', 'result_timestamp']).execute();
  const specRows = await db.selectFrom('v2_specimens').select(['id', 'type_code', 'received_time', 'origin']).execute();
  const patRows = await db.selectFrom('v2_patients').select(['id', 'sex', 'date_of_birth']).execute();

  const specById = new Map(specRows.map((s) => [s.id, s]));
  const specDate = (ref: string | null): string | null => {
    const sid = ref ? ref.replace(/^[^/]+\//, '') : null;
    return sid ? (specById.get(sid)?.received_time ?? null) : null;
  };
  const inWindow = (d: string | null): boolean => {
    if (!w.from && !w.to) return true;
    if (!d) return true; // dateless retained (sort last downstream)
    if (w.from && d < w.from) return false;
    if (w.to && d > endOfDay(w.to)) return false;
    return true;
  };

  return {
    org: orgRows.filter((r) => inWindow(r.result_timestamp ?? specDate(r.specimen_id)))
      .map((r) => ({ id: r.id, subjectRef: r.patient_id, specimenRef: r.specimen_id, valueCode: r.coded_value, valueText: r.text_value, date: r.result_timestamp })),
    ast: astRows.map((r) => ({ id: r.id, subjectRef: r.patient_id, specimenRef: r.specimen_id, antibiotic: r.observation_desc, ris: r.abnormal_flag, date: r.result_timestamp })),
    specimens: specRows.map((s) => ({ id: s.id, typeCode: s.type_code, receivedTime: s.received_time, origin: s.origin })),
    patients: patRows.map((p) => ({ id: p.id, gender: genderFromSex(p.sex), birthDate: p.date_of_birth })),
  };
}
