import { render, screen, within } from '@testing-library/react';
import { FeatureWalkthrough } from './FeatureWalkthrough';

vi.mock('./ScreenshotFrame', () => ({
  ScreenshotFrame: ({ alt, caption }: { alt: string; caption?: string }) => (
    <figure>
      <img src="/mock.png" alt={alt} />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  ),
}));

describe('FeatureWalkthrough', () => {
  it('renders the curated screenshot-led feature sections', () => {
    render(<FeatureWalkthrough />);

    expect(screen.getByRole('heading', { name: 'Workflows' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Forms' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Query and report design' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sync and administration' })).toBeInTheDocument();

    expect(screen.getByRole('img', { name: 'OpenLDR workflow builder' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'OpenLDR report run result' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'OpenLDR form builder' })).toBeInTheDocument();
  });

  it('keeps every feature section concise', () => {
    render(<FeatureWalkthrough />);

    for (const title of ['Workflows', 'Reports', 'Forms', 'Query and report design', 'Sync and administration']) {
      const section = screen.getByRole('region', { name: title });
      const points = within(section).getAllByRole('listitem');
      expect(points).toHaveLength(3);
    }
  });
});
