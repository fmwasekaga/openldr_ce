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

  it('resolves a translated page in its own locale (not the en fallback)', () => {
    const fr = resolve('fr', 'overview');
    const en = resolve('en', 'overview');
    expect(fr).not.toBeNull();
    expect(fr!.localeUsed).toBe('fr');
    // Genuinely French content, not the English fallback (the en→locale fallback path is
    // unreachable for DOC_ORDER slugs once every page is translated; it remains the default
    // branch in resolve() for any future untranslated page).
    expect(fr!.content).not.toBe(en!.content);
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

describe('docs locale coverage (SP-B)', () => {
  it('every slug resolves localized (not en-fallback) in every locale', () => {
    for (const locale of LOCALES) {
      for (const slug of DOC_ORDER) {
        const s = resolve(locale, slug);
        expect(s, `${locale}/${slug}`).not.toBeNull();
        expect(s!.localeUsed, `${locale}/${slug} should be localized`).toBe(locale);
      }
    }
  });

  it('lists all ordered pages in every locale', () => {
    for (const locale of LOCALES) {
      expect(list(locale).map((s) => s.slug)).toEqual([...DOC_ORDER]);
    }
  });

  it('every fr/pt doc is non-empty and starts with an H1 (truncation guard)', () => {
    for (const locale of ['fr', 'pt'] as const) {
      for (const slug of DOC_ORDER) {
        const s = resolve(locale, slug)!;
        expect(s.content.trim().length, `${locale}/${slug} empty`).toBeGreaterThan(20);
        expect(s.content.trim().startsWith('#'), `${locale}/${slug} missing H1`).toBe(true);
      }
    }
  });
});
