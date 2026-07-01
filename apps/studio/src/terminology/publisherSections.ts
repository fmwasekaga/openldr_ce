import type { Publisher, CodingSystem, ValueSetSummary } from '../api';

export interface PublisherSection {
  publisher: Publisher;
  systems: CodingSystem[];
  valueSets: ValueSetSummary[];
}

export function publisherSections(publishers: Publisher[], systems: CodingSystem[], valueSets: ValueSetSummary[] = []): PublisherSection[] {
  // Show every publisher: seeded standards are always visible (and non-deletable),
  // and custom publishers stay visible even while empty so a just-created one appears.
  return [...publishers]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((publisher) => ({
      publisher,
      systems: systems.filter((s) => s.publisherId === publisher.id),
      valueSets: valueSets.filter((v) => v.publisherId === publisher.id),
    }));
}
