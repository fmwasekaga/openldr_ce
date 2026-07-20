import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Hero } from './Hero';

vi.mock('./ScreenshotFrame', () => ({
  ScreenshotFrame: ({ alt }: { alt: string }) => <img src="/mock-dashboard.png" alt={alt} />,
}));

describe('Hero', () => {
  it('presents OpenLDR with clear CTAs and the dashboard screenshot', () => {
    render(<Hero />, { wrapper: MemoryRouter });

    expect(screen.getByRole('heading', { name: 'OpenLDR' })).toBeInTheDocument();
    expect(screen.getByText(/self-hosted laboratory data/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /read the docs/i })).toHaveAttribute('href', '/docs');
    expect(screen.getByRole('img', { name: 'OpenLDR dashboard overview' })).toBeInTheDocument();
  });

  it('scrolls to install without changing the hash when Get started is clicked', () => {
    const scrollIntoView = vi.fn();
    const install = document.createElement('section');
    install.id = 'install';
    install.scrollIntoView = scrollIntoView;
    document.body.append(install);
    window.location.hash = '#/';

    render(<Hero />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(window.location.hash).toBe('#/');

    install.remove();
  });
});
