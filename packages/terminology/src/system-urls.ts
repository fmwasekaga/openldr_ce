import { LOINC_SYSTEM } from './loaders/loinc';

export type SupportedSystemType = 'loinc' | 'snomed' | 'rxnorm';

// Canonical coding-system URL per system type. loinc REUSES the loader's LOINC_SYSTEM constant so the
// distribution route and loadLoinc provably create/resolve the SAME coding-system row. snomed/rxnorm
// entries are the generic wiring for Slice 2 (their loaders should reference these too); note SNOMED's
// canonical url ('.../sct') differs from the publisher matchPrefix ('http://snomed.info/'), which is
// exactly why the URL comes from here, not the publisher.
const CANONICAL_SYSTEM_URL: Record<SupportedSystemType, string> = {
  loinc: LOINC_SYSTEM,
  snomed: 'http://snomed.info/sct',
  rxnorm: 'http://www.nlm.nih.gov/research/umls/rxnorm',
};

export function canonicalSystemUrl(systemType: string): string | null {
  return (CANONICAL_SYSTEM_URL as Record<string, string>)[systemType] ?? null;
}
