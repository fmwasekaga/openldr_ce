import type { ConceptRecord, ConceptQuery, MapElement, TranslateQuery } from '@openldr/db';
import type { ValueSet } from '@openldr/fhir';

export interface ConceptSource {
  getConcept(system: string, code: string): Promise<ConceptRecord | null>;
  findConcepts(q: ConceptQuery): Promise<ConceptRecord[]>;
  countConcepts(q: Omit<ConceptQuery, 'limit' | 'offset'>): Promise<number>;
  getResourceByUrl(url: string): Promise<unknown | null>;
  translate(q: TranslateQuery): Promise<MapElement[]>;
}

export function valueSetOf(resource: unknown): ValueSet | null {
  const r = resource as { resourceType?: string } | null;
  return r && r.resourceType === 'ValueSet' ? (r as ValueSet) : null;
}
