import { describe, it, expect } from 'vitest';
import { toGlassRis } from './glass';
import type { Isolate } from './types';

const iso: Isolate = {
  patientId: 'p1', specimenType: 'BLOOD', origin: 'inpatient', pathogenCode: 'eco', pathogenName: 'E. coli',
  date: '2026-01-10', gender: 'female', ageBand: '25-34', results: [{ antibiotic: 'AMP', ris: 'R' }, { antibiotic: 'CIP', ris: 'S' }],
};

describe('toGlassRis', () => {
  it('emits one stratified row per pathogen/antibiotic/strata with counts + meta', () => {
    const rows = toGlassRis([iso], { country: 'SLE', year: 2026 });
    const amp = rows.find((r) => r.AntibioticCode === 'AMP')!;
    expect(amp).toMatchObject({ Iso3Country: 'SLE', Year: 2026, Specimen: 'BLOOD', PathogenCode: 'eco', Gender: 'female', AgeGroup: '25-34', Origin: 'inpatient', Resistant: 1, Intermediate: 0, Susceptible: 0, Total: 1 });
  });
});
