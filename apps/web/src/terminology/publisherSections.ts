import type { Publisher, CodingSystem } from '../api';

export interface PublisherSection {
  publisher: Publisher;
  systems: CodingSystem[];
}

export function publisherSections(publishers: Publisher[], systems: CodingSystem[]): PublisherSection[] {
  // Show every publisher: seeded standards are always visible (and non-deletable),
  // and custom publishers stay visible even while empty so a just-created one appears.
  return [...publishers]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((publisher) => ({ publisher, systems: systems.filter((s) => s.publisherId === publisher.id) }));
}
