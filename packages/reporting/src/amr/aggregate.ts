import type { Isolate } from './types';

export interface RisRow { specimenType: string; pathogen: string; antibiotic: string; tested: number; r: number; i: number; s: number; percentR: number }

function pct(r: number, tested: number): number { return tested === 0 ? 0 : Math.round((r / tested) * 1000) / 10; }

export function aggregateRIS(isolates: Isolate[]): RisRow[] {
  const map = new Map<string, RisRow>();
  for (const iso of isolates) {
    for (const res of iso.results) {
      const key = `${iso.specimenType}|${iso.pathogenCode}|${res.antibiotic}`;
      const row = map.get(key) ?? { specimenType: iso.specimenType, pathogen: iso.pathogenCode, antibiotic: res.antibiotic, tested: 0, r: 0, i: 0, s: 0, percentR: 0 };
      row.tested++;
      if (res.ris === 'R') row.r++; else if (res.ris === 'I') row.i++; else row.s++;
      map.set(key, row);
    }
  }
  const out = [...map.values()];
  for (const row of out) row.percentR = pct(row.r, row.tested);
  out.sort((a, b) => a.specimenType.localeCompare(b.specimenType) || a.pathogen.localeCompare(b.pathogen) || a.antibiotic.localeCompare(b.antibiotic));
  return out;
}

export interface AntibiogramRow { pathogen: string; byAntibiotic: Record<string, { tested: number; percentR: number }> }

/** Pathogen x antibiotic %R matrix, collapsing specimen types per (pathogen, antibiotic). */
export function antibiogram(isolates: Isolate[]): AntibiogramRow[] {
  const counts = new Map<string, Map<string, { tested: number; r: number }>>();
  for (const iso of isolates) {
    const byAb = counts.get(iso.pathogenCode) ?? new Map<string, { tested: number; r: number }>();
    for (const res of iso.results) {
      const c = byAb.get(res.antibiotic) ?? { tested: 0, r: 0 };
      c.tested++; if (res.ris === 'R') c.r++;
      byAb.set(res.antibiotic, c);
    }
    counts.set(iso.pathogenCode, byAb);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([pathogen, byAb]) => ({
    pathogen,
    byAntibiotic: Object.fromEntries([...byAb.entries()].map(([ab, c]) => [ab, { tested: c.tested, percentR: pct(c.r, c.tested) }])),
  }));
}
