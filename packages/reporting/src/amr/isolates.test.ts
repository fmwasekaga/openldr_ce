import { describe, it, expect } from 'vitest';
import { buildIsolates, firstIsolate, ageBandGlass } from './isolates';
import type { RawAstObs, RawOrgObs, RawPatient, RawSpecimen } from './types';

const patients: RawPatient[] = [{ id: 'p1', gender: 'female', birthDate: '1990-01-01' }];
const specimens: RawSpecimen[] = [
  { id: 'sp1', typeCode: 'BLOOD', receivedTime: '2026-01-10', origin: 'inpatient' },
  { id: 'sp2', typeCode: 'BLOOD', receivedTime: '2026-02-15', origin: null },
];
const org: RawOrgObs[] = [
  { id: 'o1', subjectRef: 'Patient/p1', specimenRef: 'Specimen/sp1', valueCode: 'eco', valueText: 'E. coli', date: null },
  { id: 'o2', subjectRef: 'Patient/p1', specimenRef: 'Specimen/sp2', valueCode: 'eco', valueText: 'E. coli', date: null },
];
const ast: RawAstObs[] = [
  { id: 'a1', subjectRef: 'Patient/p1', specimenRef: 'Specimen/sp1', antibiotic: 'AMP', ris: 'R', date: null },
  { id: 'a2', subjectRef: 'Patient/p1', specimenRef: 'Specimen/sp2', antibiotic: 'AMP', ris: 'S', date: null },
];

describe('buildIsolates', () => {
  it('assembles isolates with pathogen, specimen, patient, date, origin', () => {
    const iso = buildIsolates(org, ast, specimens, patients);
    expect(iso).toHaveLength(2);
    expect(iso[0]).toMatchObject({ patientId: 'p1', specimenType: 'BLOOD', origin: 'inpatient', pathogenCode: 'eco', date: '2026-01-10', gender: 'female' });
    expect(iso[0].results).toEqual([{ antibiotic: 'AMP', ris: 'R' }]);
    expect(iso[1].origin).toBe('unknown'); // null origin -> unknown
  });
});

describe('firstIsolate', () => {
  it('keeps the earliest isolate per patient+pathogen+specimen-type', () => {
    const iso = buildIsolates(org, ast, specimens, patients);
    const first = firstIsolate(iso);
    expect(first).toHaveLength(1);
    expect(first[0].date).toBe('2026-01-10'); // the earlier of the two E. coli BLOOD isolates
    expect(first[0].results[0].ris).toBe('R');
  });
});

describe('ageBandGlass', () => {
  it('maps ages to GLASS bands', () => {
    expect(ageBandGlass('2025-06-01', '2026-01-01')).toBe('0');
    expect(ageBandGlass('2022-01-01', '2026-01-01')).toBe('1-4');
    expect(ageBandGlass('1990-01-01', '2026-01-01')).toBe('35-44');
    expect(ageBandGlass('1950-01-01', '2026-01-01')).toBe('65+');
    expect(ageBandGlass(null, '2026-01-01')).toBe('unknown');
  });
});
