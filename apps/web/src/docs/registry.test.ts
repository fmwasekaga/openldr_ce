import { describe, expect, it } from 'vitest';
import {
  DOC_GROUPS,
  DOC_GUIDES,
  DOC_ORDER,
  LOCALES,
  firstHeading,
  list,
  resolve,
} from './registry';

describe('docs registry', () => {
  it('defines the approved guide groups in navigation order', () => {
    expect(DOC_GROUPS.map((group) => group.id)).toEqual([
      'start',
      'daily-work',
      'data-design',
      'administration',
      'more',
    ]);
  });

  it('defines exactly the thirteen approved guides in navigation order', () => {
    expect(DOC_GUIDES.map((guide) => guide.slug)).toEqual([
      'start-here',
      'dashboard',
      'reports',
      'workflows',
      'report-pipeline',
      'forms',
      'terminology',
      'users',
      'audit',
      'settings',
      'connectors',
      'marketplace',
      'advanced-docs',
    ]);
    expect(DOC_ORDER).toEqual(DOC_GUIDES.map((guide) => guide.slug));
  });

  it('defines the approved related-guide relationships', () => {
    expect(
      Object.fromEntries(DOC_GUIDES.map((guide) => [guide.slug, guide.relatedSlugs])),
    ).toEqual({
      'start-here': ['dashboard', 'reports', 'advanced-docs'],
      dashboard: ['reports', 'workflows'],
      reports: ['dashboard', 'audit'],
      workflows: ['report-pipeline', 'reports', 'connectors', 'audit'],
      'report-pipeline': ['workflows', 'connectors', 'reports'],
      forms: ['terminology', 'marketplace'],
      terminology: ['forms', 'audit'],
      users: ['audit', 'settings'],
      audit: ['users', 'workflows'],
      settings: ['connectors', 'marketplace'],
      connectors: ['report-pipeline', 'settings', 'workflows', 'marketplace'],
      marketplace: ['settings', 'connectors', 'forms'],
      'advanced-docs': ['start-here', 'settings'],
    });
  });

  it('gives every published guide complete metadata and valid relationships', () => {
    const slugs = new Set(DOC_GUIDES.map((guide) => guide.slug));

    for (const guide of DOC_GUIDES) {
      for (const relatedSlug of guide.relatedSlugs) {
        expect(slugs.has(relatedSlug), `${guide.slug} -> ${relatedSlug}`).toBe(true);
      }
      if (guide.status === 'published') {
        expect(guide.summary.trim(), `${guide.slug} summary`).not.toBe('');
        expect(guide.audience.length, `${guide.slug} audience`).toBeGreaterThan(0);
        expect(guide.estimatedMinutes, `${guide.slug} estimated time`).toBeGreaterThan(0);
        expect(guide.difficulty, `${guide.slug} difficulty`).toBeTruthy();
      }
    }
  });

  it('resolves an English page with metadata and a title from its H1', () => {
    const section = resolve('en', 'dashboard');
    expect(section).toMatchObject({
      slug: 'dashboard',
      group: 'daily-work',
      requiredRoles: [],
      difficulty: 'beginner',
      status: 'published',
      localeUsed: 'en',
    });
    expect(section!.title).toBe(firstHeading(section!.content));
  });

  it('falls back to English markdown after metadata lookup', () => {
    const fr = resolve('fr', 'dashboard');
    const en = resolve('en', 'dashboard');
    expect(fr).toMatchObject({
      slug: 'dashboard',
      localeUsed: 'en',
    });
    expect(fr!.content).toBe(en!.content);
  });

  it('returns null for an unknown slug', () => {
    expect(resolve('en', 'nope')).toBeNull();
  });

  it('lists only authored guides in registry order', () => {
    const guideOrder = new Map(DOC_GUIDES.map((guide, index) => [guide.slug, index]));
    const slugs = list('en').map((section) => section.slug);
    expect(slugs).toContain('dashboard');
    expect(slugs).toContain('reports');
    expect(slugs).toContain('terminology');
    expect(slugs).toEqual(
      [...slugs].sort((left, right) => guideOrder.get(left)! - guideOrder.get(right)!),
    );
  });

  it('resolves every approved English guide once the web manual is authored', () => {
    expect(list('en').map((section) => section.slug)).toEqual(
      DOC_GUIDES.map((guide) => guide.slug),
    );
  });

  it('exposes the three locales', () => {
    expect(LOCALES).toEqual(['en', 'fr', 'pt']);
  });

  it('firstHeading reads the first H1 and falls back to empty', () => {
    expect(firstHeading('# Hello\n\nbody')).toBe('Hello');
    expect(firstHeading('no heading here')).toBe('');
  });

  it('excludes DHIS2 even while orphan markdown still exists', () => {
    expect(resolve('en', 'dhis2')).toBeNull();
    expect(list('en').some((section) => section.slug === 'dhis2')).toBe(false);
  });
});
