import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('./screenshots', () => ({
  resolveImg: (src: string) => (src === 'dashboard.png' ? '/assets/dashboard.png' : null),
}));

import { DocMarkdown } from './DocMarkdown';

describe('DocMarkdown', () => {
  it('renders a resolved screenshot image', () => {
    render(<DocMarkdown content={'# Title\n\n![Dash](dashboard.png)'} />);
    const img = screen.getByAltText('Dash') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/assets/dashboard.png');
  });

  it('omits an unresolved image', () => {
    render(<DocMarkdown content={'![Missing](missing.png)'} />);
    expect(screen.queryByAltText('Missing')).toBeNull();
  });

  it('opens external links in a new tab', () => {
    render(<DocMarkdown content={'[site](https://example.org)'} />);
    const a = screen.getByRole('link', { name: 'site' });
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('renders gfm strikethrough', () => {
    const { container } = render(<DocMarkdown content={'~~gone~~'} />);
    expect(container.querySelector('del')).not.toBeNull();
  });
});
