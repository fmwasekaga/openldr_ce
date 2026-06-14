import { describe, it, expect } from 'vitest';
import { resolve, list, firstHeading, DOC_ORDER, LOCALES } from './registry';

describe('docs registry', () => {
  it('resolves an English page with a title from its H1', () => {
    const s = resolve('en', 'overview');
    expect(s).not.toBeNull();
    expect(s!.title).toBe('OpenLDR Community Edition');
    expect(s!.localeUsed).toBe('en');
    expect(s!.content).toMatch(/AMR/);
  });

  it('falls back to English for an untranslated locale', () => {
    const fr = resolve('fr', 'overview');
    const en = resolve('en', 'overview');
    expect(fr).not.toBeNull();
    expect(fr!.localeUsed).toBe('en');
    expect(fr!.content).toBe(en!.content);
  });

  it('returns null for an unknown slug', () => {
    expect(resolve('en', 'nope')).toBeNull();
  });

  it('lists every ordered page, in order, with no gaps', () => {
    const sections = list('en');
    expect(sections.map((s) => s.slug)).toEqual([...DOC_ORDER]);
  });

  it('exposes the three locales', () => {
    expect(LOCALES).toEqual(['en', 'fr', 'pt']);
  });

  it('firstHeading reads the first H1 and falls back to empty', () => {
    expect(firstHeading('# Hello\n\nbody')).toBe('Hello');
    expect(firstHeading('no heading here')).toBe('');
  });
});
