import type { Isolate, Origin, RawAstObs, RawOrgObs, RawPatient, RawSpecimen, Ris } from './types';

const GLASS_BANDS: [number, number, string][] = [
  [0, 0, '0'], [1, 4, '1-4'], [5, 14, '5-14'], [15, 24, '15-24'], [25, 34, '25-34'],
  [35, 44, '35-44'], [45, 54, '45-54'], [55, 64, '55-64'],
];

export function ageBandGlass(birthDate: string | null, refIso: string): string {
  if (!birthDate) return 'unknown';
  const b = new Date(birthDate); const ref = new Date(refIso);
  if (Number.isNaN(b.getTime()) || Number.isNaN(ref.getTime())) return 'unknown';
  let age = ref.getFullYear() - b.getFullYear();
  const m = ref.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < b.getDate())) age--;
  if (age < 0) return 'unknown';
  if (age >= 65) return '65+';
  for (const [lo, hi, label] of GLASS_BANDS) if (age >= lo && age <= hi) return label;
  return 'unknown';
}

function refId(ref: string | null): string | null {
  return ref ? ref.replace(/^[^/]+\//, '') : null;
}

function normOrigin(o: string | null): Origin {
  return o === 'inpatient' || o === 'outpatient' ? o : 'unknown';
}

export function buildIsolates(org: RawOrgObs[], ast: RawAstObs[], specimens: RawSpecimen[], patients: RawPatient[]): Isolate[] {
  const specById = new Map(specimens.map((s) => [s.id, s]));
  const patById = new Map(patients.map((p) => [p.id, p]));
  const astBySpec = new Map<string, RawAstObs[]>();
  for (const a of ast) {
    const sid = refId(a.specimenRef);
    if (!sid) continue;
    const list = astBySpec.get(sid);
    if (list) list.push(a); else astBySpec.set(sid, [a]);
  }
  const isolates: Isolate[] = [];
  for (const o of org) {
    const sid = refId(o.specimenRef);
    const pid = refId(o.subjectRef);
    if (!sid || !pid) continue;
    const spec = specById.get(sid);
    const pat = patById.get(pid);
    const specimenType = spec?.typeCode ?? '(unknown)';
    const date = o.date ?? spec?.receivedTime ?? null;
    const results = (astBySpec.get(sid) ?? [])
      .filter((a): a is RawAstObs & { antibiotic: string; ris: Ris } => a.antibiotic != null && (a.ris === 'R' || a.ris === 'I' || a.ris === 'S'))
      .map((a) => ({ antibiotic: a.antibiotic, ris: a.ris }));
    isolates.push({
      patientId: pid,
      specimenType,
      origin: normOrigin(spec?.origin ?? null),
      pathogenCode: o.valueCode ?? '(unknown)',
      pathogenName: o.valueText ?? o.valueCode ?? '(unknown)',
      date,
      gender: pat?.gender ?? 'unknown',
      ageBand: ageBandGlass(pat?.birthDate ?? null, date ?? '1970-01-01'),
      results,
    });
  }
  return isolates;
}

/** First isolate per (patient, pathogen, specimen-type): earliest by date (dateless sort last). */
export function firstIsolate(isolates: Isolate[]): Isolate[] {
  const sorted = [...isolates].sort((a, b) => {
    if (a.date === b.date) return 0;
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? -1 : 1;
  });
  const seen = new Set<string>();
  const out: Isolate[] = [];
  for (const iso of sorted) {
    const key = `${iso.patientId}|${iso.pathogenCode}|${iso.specimenType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(iso);
  }
  return out;
}
