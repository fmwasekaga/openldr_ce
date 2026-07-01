import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReadmeMarkdown } from './ReadmeMarkdown';

describe('ReadmeMarkdown', () => {
  it('renders headings and paragraphs', () => {
    render(<ReadmeMarkdown content={'# Title\n\nsome **text**'} />);
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy();
  });
  it('renders a data:image, drops a javascript: image', () => {
    render(<ReadmeMarkdown content={'![ok](data:image/png;base64,iVBORw0KGgo=)\n\n![bad](javascript:alert(1))'} />);
    const imgs = screen.queryAllByRole('img');
    expect(imgs.some((i) => (i as HTMLImageElement).src.startsWith('data:image/'))).toBe(true);
    expect(imgs.some((i) => (i as HTMLImageElement).src.startsWith('javascript:'))).toBe(false);
  });
  it('opens links in a new tab safely', () => {
    render(<ReadmeMarkdown content={'[x](https://example.org)'} />);
    const a = screen.getByRole('link', { name: 'x' }) as HTMLAnchorElement;
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
  });
});
