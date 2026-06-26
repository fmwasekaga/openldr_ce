import { describe, it, expect } from 'vitest';
import { buildIndex, searchDocs } from './search';
import type { DocSection } from './registry';

function section(overrides: Pick<DocSection, 'slug' | 'title' | 'content'>): DocSection {
  return {
    group: 'daily-work',
    summary: `Summary for ${overrides.title}`,
    audience: ['all-users'],
    requiredRoles: [],
    estimatedMinutes: 5,
    difficulty: 'beginner',
    relatedSlugs: [],
    screenshotNames: [],
    status: 'published',
    localeUsed: 'en',
    ...overrides,
  };
}

const sections: DocSection[] = [
  section({ slug: 'dashboard', title: 'Dashboard', content: '# Dashboard\n\nReport cards summarize the warehouse.' }),
  section({ slug: 'dhis2', title: 'DHIS2 Aggregate Reporting', content: '# DHIS2 Aggregate Reporting\n\nPush dataValueSets to a DHIS2 instance.' }),
  section({ slug: 'reports', title: 'Reports', content: '# Reports\n\nThe antibiogram shows susceptibility by organism.' }),
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
