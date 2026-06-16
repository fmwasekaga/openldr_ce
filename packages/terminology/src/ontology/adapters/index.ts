import { loincAdapter } from './loinc';
import { rxnormAdapter } from './rxnorm';
import { snomedAdapter } from './snomed';
import type { DetectedDistribution, OntologyAdapter } from '../types';

export const adapters: OntologyAdapter[] = [loincAdapter, snomedAdapter, rxnormAdapter];

export function detectAdapter(folderPath: string): { adapter: OntologyAdapter; dist: DetectedDistribution } | null {
  for (const adapter of adapters) {
    const dist = adapter.detect(folderPath);
    if (dist) return { adapter, dist };
  }
  return null;
}
