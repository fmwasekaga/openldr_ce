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
      .selectFrom('observations')
      .where('interpretation_code', 'in', ['S', 'I', 'R'])
      .where('effective_date_time', '>=', window.from)
      .where('effective_date_time', '<=', endOfDay(window.to))
      .select(['id', 'code_text', 'interpretation_code', 'effective_date_time', 'subject_ref'])
      .execute();
    if (obs.length === 0) return { rows: [] };
    const patientIds = [
      ...new Set(
        obs.map((o) => o.subject_ref).filter((s): s is string => !!s).map((s) => s.replace(/^Patient\//, '')),
      ),
    ];
    const patients = patientIds.length
      ? await db.selectFrom('patients').select(['id', 'managing_organization']).where('id', 'in', patientIds).execute()
      : [];
    const facilityById = new Map(patients.map((p) => [p.id, p.managing_organization]));
    const rows = obs.map((o) => ({
      id: o.id,
      facility: o.subject_ref ? facilityById.get(o.subject_ref.replace(/^Patient\//, '')) ?? null : null,
      eventDate: o.effective_date_time,
      antibiotic: o.code_text,
      result: o.interpretation_code,
    }));
    return { rows };
  },
};
