import type { EventSource } from '../eventsource-types';
import { endOfDay } from '../helpers';

export const amrIsolates: EventSource = {
  id: 'amr-isolates',
  name: 'AMR isolates (per AST result)',
  columns: [
    { key: 'id', label: 'Isolate ID' },
    { key: 'facility', label: 'Facility' },
    { key: 'eventDate', label: 'Event date' },
    { key: 'antibiotic', label: 'Antibiotic' },
    { key: 'result', label: 'Result (S/I/R)' },
  ],
  async run(db, window) {
    const obs = await db
      .selectFrom('lab_results')
      .where('abnormal_flag', 'in', ['S', 'I', 'R'])
      .where('result_timestamp', '>=', window.from)
      .where('result_timestamp', '<=', endOfDay(window.to))
      .select(['id', 'observation_desc', 'abnormal_flag', 'result_timestamp', 'patient_id'])
      .execute();
    if (obs.length === 0) return { rows: [] };
    const patientIds = [...new Set(obs.map((o) => o.patient_id).filter((s): s is string => !!s))];
    const patients = patientIds.length
      ? await db.selectFrom('patients').select(['id', 'managing_organization']).where('id', 'in', patientIds).execute()
      : [];
    const facilityById = new Map(patients.map((p) => [p.id, p.managing_organization]));
    const rows = obs.map((o) => ({
      id: o.id,
      facility: o.patient_id ? facilityById.get(o.patient_id) ?? null : null,
      eventDate: o.result_timestamp,
      antibiotic: o.observation_desc,
      result: o.abnormal_flag,
    }));
    return { rows };
  },
};
