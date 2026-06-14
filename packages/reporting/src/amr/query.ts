import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import { endOfDay } from '../helpers';
import type { RawAstObs, RawOrgObs, RawPatient, RawSpecimen } from './types';

export interface AmrWindow { from?: string; to?: string }
export interface AmrData { org: RawOrgObs[]; ast: RawAstObs[]; specimens: RawSpecimen[]; patients: RawPatient[] }

export async function fetchAmrData(db: Kysely<ExternalSchema>, w: AmrWindow): Promise<AmrData> {
  const orgRows = await db.selectFrom('observations').where('code_code', '=', '634-6')
    .select(['id', 'subject_ref', 'specimen_ref', 'value_code', 'value_text', 'effective_date_time']).execute();
  const astRows = await db.selectFrom('observations').where('interpretation_code', 'in', ['S', 'I', 'R'])
    .select(['id', 'subject_ref', 'specimen_ref', 'code_text', 'interpretation_code', 'effective_date_time']).execute();
  const specRows = await db.selectFrom('specimens').select(['id', 'type_code', 'received_time', 'origin']).execute();
  const patRows = await db.selectFrom('patients').select(['id', 'gender', 'birth_date']).execute();

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
    org: orgRows.filter((r) => inWindow(r.effective_date_time ?? specDate(r.specimen_ref)))
      .map((r) => ({ id: r.id, subjectRef: r.subject_ref, specimenRef: r.specimen_ref, valueCode: r.value_code, valueText: r.value_text, date: r.effective_date_time })),
    ast: astRows.map((r) => ({ id: r.id, subjectRef: r.subject_ref, specimenRef: r.specimen_ref, antibiotic: r.code_text, ris: r.interpretation_code, date: r.effective_date_time })),
    specimens: specRows.map((s) => ({ id: s.id, typeCode: s.type_code, receivedTime: s.received_time, origin: s.origin })),
    patients: patRows.map((p) => ({ id: p.id, gender: p.gender, birthDate: p.birth_date })),
  };
}
