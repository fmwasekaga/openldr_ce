import { describe, it, expect } from 'vitest';
import { buildIndex, searchDocs } from './search';
import type { DocSection } from './registry';

const sections: DocSection[] = [
  { slug: 'dashboard', title: 'Dashboard', content: '# Dashboard\n\nReport cards summarize the warehouse.', localeUsed: 'en' },
  { slug: 'dhis2', title: 'DHIS2 Aggregate Reporting', content: '# DHIS2 Aggregate Reporting\n\nPush dataValueSets to a DHIS2 instance.', localeUsed: 'en' },
  { slug: 'reports', title: 'Reports', content: '# Reports\n\nThe antibiogram shows susceptibility by organism.', localeUsed: 'en' },
];

describe('docs search', () => {
  it('ranks a title match first', () => {
    const hits = searchDocs(buildIndex(sections), 'dashboard');
    expect(hits[0].slug).toBe('dashboard');
  });

  it('finds a body-only term and returns a snippet containing it', () => {
    const hits = searchDocs(buildIndex(sections), 'antibiogram');
    expect(hits.map((h) => h.slug)).toContain('reports');
    const hit = hits.find((h) => h.slug === 'reports')!;
    expect(hit.snippet.toLowerCase()).toContain('antibiogram');
  });

  it('returns nothing for an empty query', () => {
    expect(searchDocs(buildIndex(sections), '   ')).toEqual([]);
  });
});
