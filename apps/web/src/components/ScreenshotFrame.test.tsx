import { render, screen } from '@testing-library/react';
import { ScreenshotFrame } from './ScreenshotFrame';

vi.mock('@/landing/screenshots', () => ({
  screenshotUrl: (name: string) => (name === 'dashboard-overview.png' ? '/assets/dashboard.png' : null),
}));

describe('ScreenshotFrame', () => {
  it('renders a real screenshot with eager loading when priority is true', () => {
    render(
      <ScreenshotFrame
        name="dashboard-overview.png"
        alt="OpenLDR dashboard overview"
        caption="Dashboard overview"
        priority
      />,
    );

    const image = screen.getByRole('img', { name: 'OpenLDR dashboard overview' });
    expect(image).toHaveAttribute('src', '/assets/dashboard.png');
    expect(image).toHaveAttribute('loading', 'eager');
    expect(screen.getByText('Dashboard overview')).toBeInTheDocument();
    expect(image.closest('figure')).toHaveClass('m-0');
  });

  it('renders a quiet unavailable state when the screenshot URL is absent', () => {
    render(<ScreenshotFrame name="sync-settings-card.png" alt="Distributed Sync settings" />);

    expect(screen.getByRole('img', { name: /screenshot unavailable: distributed sync settings/i })).toBeInTheDocument();
  });
});
