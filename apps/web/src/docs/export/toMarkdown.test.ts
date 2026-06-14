import { describe, it, expect } from 'vitest';
import { sectionToMarkdown, manualToMarkdown } from './toMarkdown';
import type { DocSection } from '../registry';

const a: DocSection = { slug: 'overview', title: 'Overview', content: '# Overview\n\nBody A', localeUsed: 'en' };
const b: DocSection = { slug: 'dhis2', title: 'DHIS2', content: '# DHIS2\n\nBody B', localeUsed: 'en' };

describe('toMarkdown', () => {
  it('returns the section content for a single section', () => {
    expect(sectionToMarkdown(a)).toBe('# Overview\n\nBody A');
  });
  it('concatenates all sections separated by a rule', () => {
    const md = manualToMarkdown([a, b]);
    expect(md).toContain('# Overview');
    expect(md).toContain('# DHIS2');
    expect(md).toContain('\n\n---\n\n');
    expect(md.indexOf('Overview')).toBeLessThan(md.indexOf('DHIS2'));
  });
});
