import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Lightbox } from './Lightbox';

describe('Lightbox', () => {
  it('renders nothing when image is null', () => {
    render(<Lightbox image={null} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('shows the image when open', () => {
    render(<Lightbox image={{ url: '/assets/dashboard.png', alt: 'Dash' }} onClose={() => {}} />);
    const img = screen.getByAltText('Dash') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/assets/dashboard.png');
  });
  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<Lightbox image={{ url: '/assets/x.png', alt: 'X' }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
