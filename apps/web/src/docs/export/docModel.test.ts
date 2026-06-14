import { describe, it, expect } from 'vitest';
import { parseBlocks } from './docModel';

describe('parseBlocks', () => {
  it('parses headings with level and plain text', () => {
    expect(parseBlocks('# Title')).toEqual([{ type: 'heading', level: 1, text: 'Title' }]);
    expect(parseBlocks('## Sub')).toEqual([{ type: 'heading', level: 2, text: 'Sub' }]);
  });

  it('parses a paragraph, stripping inline emphasis and keeping link text', () => {
    expect(parseBlocks('Some **bold** and [a link](https://x).')).toEqual([
      { type: 'paragraph', text: 'Some bold and a link.' },
    ]);
  });

  it('parses an unordered list', () => {
    expect(parseBlocks('- one\n- two')).toEqual([
      { type: 'list', ordered: false, items: ['one', 'two'] },
    ]);
  });

  it('parses a fenced code block', () => {
    expect(parseBlocks('```\npnpm install\n```')).toEqual([
      { type: 'code', text: 'pnpm install' },
    ]);
  });

  it('parses an image to its basename + alt', () => {
    expect(parseBlocks('![Dashboard](dashboard.png)')).toEqual([
      { type: 'image', src: 'dashboard.png', alt: 'Dashboard' },
    ]);
  });

  it('parses a blockquote', () => {
    expect(parseBlocks('> note here')).toEqual([
      { type: 'blockquote', text: 'note here' },
    ]);
  });
});
