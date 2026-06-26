import { describe, expect, it } from 'vitest';
import { buildIndex, searchDocs } from './search';
import type { DocSection } from './registry';

function section(overrides: Partial<DocSection> & Pick<DocSection, 'slug' | 'title' | 'content'>): DocSection {
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
  section({
    slug: 'dashboard',
    title: 'Dashboard',
    content: '# Dashboard\n\nReport cards summarize the warehouse.',
  }),
  section({
    slug: 'reports',
    title: 'Reports',
    content: '# Reports\n\nThe antibiogram shows susceptibility by organism.',
  }),
  section({
    slug: 'workflows',
    title: 'Automation Builder',
    summary: 'Create and run workflows from the web interface.',
    audience: ['lab-managers', 'administrators'],
    content: '# Automation Builder\n\nArrange nodes, test steps, and publish results.',
  }),
  section({
    slug: 'users',
    title: 'Users and Roles',
    summary: 'Manage accounts, roles, and access problems.',
    audience: ['administrators'],
    requiredRoles: ['lab_admin'],
    content: '# Users and Roles\n\nFix permission denied errors by checking assigned roles.',
  }),
];

describe('docs search', () => {
  it('ranks a title match first', () => {
    const hits = searchDocs(buildIndex(sections), 'dashboard');
    expect(hits[0].slug).toBe('dashboard');
  });

  it('finds a body-only term and returns a snippet containing it', () => {
    const hits = searchDocs(buildIndex(sections), 'antibiogram');
    expect(hits.map((hit) => hit.slug)).toContain('reports');
    const hit = hits.find((candidate) => candidate.slug === 'reports')!;
    expect(hit.snippet.toLowerCase()).toContain('antibiogram');
  });

  it('uses troubleshooting body text for permission searches', () => {
    expect(searchDocs(buildIndex(sections), 'permission denied')[0].slug).toBe('users');
  });

  it('uses task summaries for outcome-oriented searches', () => {
    expect(searchDocs(buildIndex(sections), 'create workflow')[0].slug).toBe('workflows');
  });

  it('uses required roles for administrator searches', () => {
    expect(searchDocs(buildIndex(sections), 'lab_admin')[0].slug).toBe('users');
  });

  it('does not return retired DHIS2 documentation', () => {
    expect(searchDocs(buildIndex(sections), 'dhis2')).toEqual([]);
  });

  it('returns nothing for an empty query', () => {
    expect(searchDocs(buildIndex(sections), '   ')).toEqual([]);
  });
});
