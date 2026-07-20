import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';

vi.mock('@/components/ScreenshotFrame', () => ({
  ScreenshotFrame: ({ alt }: { alt: string }) => <img src="/mock.png" alt={alt} />,
}));

describe('App routes', () => {
  it('renders the screenshot-led landing route', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'OpenLDR' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The pieces you need, shown directly.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Install OpenLDR in one line/i })).toBeInTheDocument();
  });
});
