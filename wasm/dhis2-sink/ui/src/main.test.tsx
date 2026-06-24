import { fireEvent, render, screen } from '@testing-library/preact';
import { createMockOpenldr } from '@openldr/plugin-ui-sdk';
import { App } from './App';

beforeEach(() => {
  // The mock resolves every host op with empty defaults regardless of
  // capabilities, so the default screens mount + settle without erroring.
  (window as unknown as { openldr: unknown }).openldr = createMockOpenldr({ pluginId: 'dhis2-sink' });
});

describe('dhis2-sink shell', () => {
  it('renders the top-nav with all five tabs', () => {
    render(<App />);
    expect(screen.getByTestId('dhis2-nav')).toBeTruthy();
    for (const tab of ['nav-dashboard', 'nav-mappings', 'nav-schedules', 'nav-orgUnits', 'nav-pushes']) {
      expect(screen.getByTestId(tab)).toBeTruthy();
    }
  });

  it('mounts the Dashboard screen by default', async () => {
    render(<App />);
    // The Dashboard finishes its first load → the Pull metadata button appears.
    expect(await screen.findByTestId('dhis2-pull-metadata')).toBeTruthy();
    expect(screen.getByTestId('dhis2-dashboard')).toBeTruthy();
  });

  it('switches to the Mappings screen when the Mappings tab is clicked', async () => {
    render(<App />);
    await screen.findByTestId('dhis2-pull-metadata');
    fireEvent.click(screen.getByTestId('nav-mappings'));
    expect(await screen.findByTestId('dhis2-mappings-page')).toBeTruthy();
  });
});
