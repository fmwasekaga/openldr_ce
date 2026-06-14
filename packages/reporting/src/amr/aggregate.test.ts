import { describe, it, expect } from 'vitest';
import { aggregateRIS, antibiogram } from './aggregate';
import type { Isolate } from './types';

const iso = (patientId: string, ris: 'R' | 'I' | 'S'): Isolate => ({
  patientId, specimenType: 'BLOOD', origin: 'unknown', pathogenCode: 'eco', pathogenName: 'E. coli',
  date: '2026-01-10', gender: 'female', ageBand: '25-34', results: [{ antibiotic: 'AMP', ris }],
});

describe('aggregateRIS', () => {
  it('counts R/I/S and %R with I in the denominator', () => {
    const rows = aggregateRIS([iso('p1', 'R'), iso('p2', 'R'), iso('p3', 'I'), iso('p4', 'S')]);
    const amp = rows.find((r) => r.antibiotic === 'AMP')!;
    expect(amp).toMatchObject({ specimenType: 'BLOOD', pathogen: 'eco', tested: 4, r: 2, i: 1, s: 1 });
    expect(amp.percentR).toBe(50); // 2/4
  });
});

describe('antibiogram', () => {
  it('builds a pathogen x antibiotic %R matrix with N', () => {
    const m = antibiogram([iso('p1', 'R'), iso('p2', 'S')]);
    expect(m[0].pathogen).toBe('eco');
    expect(m[0].byAntibiotic.AMP).toEqual({ tested: 2, percentR: 50 });
  });
});
