import type { Isolate } from './types';

export interface GlassRisRow {
  Iso3Country: string; Year: number; Specimen: string; PathogenCode: string; AntibioticCode: string;
  Gender: string; AgeGroup: string; Origin: string;
  Resistant: number; Intermediate: number; Susceptible: number; Total: number;
}

export function toGlassRis(isolates: Isolate[], meta: { country: string; year: number }): GlassRisRow[] {
  const map = new Map<string, GlassRisRow>();
  for (const iso of isolates) {
    for (const res of iso.results) {
      const key = [iso.specimenType, iso.pathogenCode, res.antibiotic, iso.gender, iso.ageBand, iso.origin].join('|');
      const row = map.get(key) ?? {
        Iso3Country: meta.country, Year: meta.year, Specimen: iso.specimenType, PathogenCode: iso.pathogenCode, AntibioticCode: res.antibiotic,
        Gender: iso.gender, AgeGroup: iso.ageBand, Origin: iso.origin, Resistant: 0, Intermediate: 0, Susceptible: 0, Total: 0,
      };
      if (res.ris === 'R') row.Resistant++; else if (res.ris === 'I') row.Intermediate++; else row.Susceptible++;
      row.Total++;
      map.set(key, row);
    }
  }
  return [...map.values()].sort((a, b) =>
    a.Specimen.localeCompare(b.Specimen) || a.PathogenCode.localeCompare(b.PathogenCode) || a.AntibioticCode.localeCompare(b.AntibioticCode) ||
    a.Gender.localeCompare(b.Gender) || a.AgeGroup.localeCompare(b.AgeGroup) || a.Origin.localeCompare(b.Origin));
}
