import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('./screenshots', () => ({
  resolveImg: (src: string) => (src === 'dashboard.png' ? '/assets/dashboard.png' : null),
}));

import { DocMarkdown } from './DocMarkdown';

describe('DocMarkdown', () => {
  it('renders a resolved screenshot as a zoom thumbnail and calls onImageClick', () => {
    const onImageClick = vi.fn();
    render(<DocMarkdown content={'# Title\n\n![Dash](dashboard.png)'} onImageClick={onImageClick} />);
    const img = screen.getByAltText('Dash') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/assets/dashboard.png');
    fireEvent.click(screen.getByRole('button', { name: /zoom/i }));
    expect(onImageClick).toHaveBeenCalledWith({ url: '/assets/dashboard.png', alt: 'Dash' });
  });

  it('shows an unavailable placeholder for an unresolved image', () => {
    render(<DocMarkdown content={'![Missing](missing.png)'} onImageClick={() => {}} />);
    expect(screen.queryByAltText('Missing')).toBeNull();
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });

  it('opens external links in a new tab', () => {
    render(<DocMarkdown content={'[site](https://example.org)'} onImageClick={() => {}} />);
    const a = screen.getByRole('link', { name: 'site' });
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('renders gfm strikethrough', () => {
    const { container } = render(<DocMarkdown content={'~~gone~~'} onImageClick={() => {}} />);
    expect(container.querySelector('del')).not.toBeNull();
  });
});
