import { resolvePublisher } from './resolve-publisher';

/** Derive a short system code from a canonical URL: last non-empty path segment
 * upper-cased; falls back to the host's first label; finally the whole url. */
export function deriveSystemCode(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop();
    return (seg || u.hostname.split('.')[0] || url).toUpperCase();
  } catch {
    return url.toUpperCase();
  }
}

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
  { id: 'pub-ucum',      name: 'UCUM',         role: 'external', matchPrefixes: ['http://unitsofmeasure.org'], sortOrder: 6 },
  { id: 'pub-rxnorm',    name: 'RxNorm',       role: 'external', matchPrefixes: ['http://www.nlm.nih.gov/research/umls/rxnorm'], sortOrder: 7 },
];

/** Longest-prefix publisher id for a canonical url; falls back to the 'System' (local) publisher. */
export function resolveSeedPublisherId(url: string): string {
  return resolvePublisher(url, SEED_PUBLISHERS.map((p) => ({ id: p.id, matchPrefixes: p.matchPrefixes })))?.id ?? 'pub-system';
}
