import type { Publisher, CodingSystem } from '../api';

export interface PublisherSection {
  publisher: Publisher;
  systems: CodingSystem[];
}

export function publisherSections(publishers: Publisher[], systems: CodingSystem[]): PublisherSection[] {
  return [...publishers]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((publisher) => ({ publisher, systems: systems.filter((s) => s.publisherId === publisher.id) }))
    .filter((s) => s.systems.length > 0 || !s.publisher.seeded);
}
