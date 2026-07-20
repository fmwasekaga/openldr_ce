import { render, screen } from '@testing-library/react';
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
    expect(screen.getByRole('link', { name: /get started/i })).toHaveAttribute('href', '#install');
    expect(screen.getByRole('link', { name: /read the docs/i })).toHaveAttribute('href', '/docs');
    expect(screen.getByRole('img', { name: 'OpenLDR dashboard overview' })).toBeInTheDocument();
  });
});
