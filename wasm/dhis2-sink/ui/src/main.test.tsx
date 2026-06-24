import { render, screen, waitFor } from '@testing-library/preact';
import { createMockOpenldr } from '@openldr/plugin-ui-sdk';
import { App } from './App';

beforeEach(() => {
  (window as unknown as { openldr: unknown }).openldr = createMockOpenldr({ pluginId: 'dhis2-sink' });
});

describe('dhis2-sink ui', () => {
  it('renders the DHIS2 heading after the host handshake resolves', async () => {
    render(<App />);
    expect(await screen.findByText('DHIS2')).toBeTruthy();
  });

  it('shows the connector status once connectors.list resolves', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText('No connector configured')).toBeTruthy());
  });
});
