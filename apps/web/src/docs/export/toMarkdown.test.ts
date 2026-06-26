import { describe, it, expect } from 'vitest';
import { sectionToMarkdown, manualToMarkdown } from './toMarkdown';
import type { DocSection } from '../registry';

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

const a = section({ slug: 'overview', title: 'Overview', content: '# Overview\n\nBody A' });
const b = section({ slug: 'reports', title: 'Reports', content: '# Reports\n\nBody B' });

describe('toMarkdown', () => {
  it('returns the section content for a single section', () => {
    expect(sectionToMarkdown(a)).toBe('# Overview\n\nBody A');
  });
  it('concatenates all sections separated by a rule', () => {
    const md = manualToMarkdown([a, b]);
    expect(md).toContain('# Overview');
    expect(md).toContain('# Reports');
    expect(md).toContain('\n\n---\n\n');
    expect(md.indexOf('Overview')).toBeLessThan(md.indexOf('Reports'));
  });
});
