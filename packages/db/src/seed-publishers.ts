import { resolvePublisher } from './resolve-publisher';

export interface SeedPublisher {
  id: string;
  name: string;
  role: 'local' | 'standard' | 'external';
  matchPrefixes: string[];
  sortOrder: number;
}

// Mirrors corlix's seeded terminology_publishers ('Your Lab' was later renamed 'System').
export const SEED_PUBLISHERS: SeedPublisher[] = [
  { id: 'pub-system',     name: 'System',       role: 'local',    matchPrefixes: [], sortOrder: 0 },
  { id: 'pub-hl7-fhir',   name: 'HL7 FHIR',     role: 'standard', matchPrefixes: ['http://hl7.org/fhir/', 'http://terminology.hl7.org/'], sortOrder: 1 },
  { id: 'pub-loinc',      name: 'LOINC',        role: 'external', matchPrefixes: ['http://loinc.org'], sortOrder: 2 },
  { id: 'pub-snomed-ct',  name: 'SNOMED CT',    role: 'external', matchPrefixes: ['http://snomed.info/'], sortOrder: 3 },
  { id: 'pub-who-icd-10', name: 'WHO · ICD-10', role: 'external', matchPrefixes: ['http://hl7.org/fhir/sid/icd-10'], sortOrder: 4 },
  { id: 'pub-who-icd-11', name: 'WHO · ICD-11', role: 'external', matchPrefixes: ['http://id.who.int/icd/', 'http://hl7.org/fhir/sid/icd-11'], sortOrder: 5 },
];

/** Longest-prefix publisher id for a canonical url; falls back to the 'System' (local) publisher. */
export function resolveSeedPublisherId(url: string): string {
  return resolvePublisher(url, SEED_PUBLISHERS.map((p) => ({ id: p.id, matchPrefixes: p.matchPrefixes })))?.id ?? 'pub-system';
}
