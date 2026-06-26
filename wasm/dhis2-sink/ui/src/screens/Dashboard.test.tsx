import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { createMockOpenldr } from '@openldr/plugin-ui-sdk';
import { Dashboard } from './Dashboard';

function mountMock() {
  const o = createMockOpenldr({ pluginId: 'dhis2-sink', capabilities: ['host:connectors'] });
  o.connectors.list = async () => [
    { id: 'c1', name: 'DHIS2 demo', enabled: true, allowedHost: 'play.dhis2.org' },
  ] as unknown[];
  o.storage.get = async (c: string, k: string) =>
    c === 'metadataCache' && k === 'latest'
      ? { metadata: { dataElements: [1, 2], orgUnits: [1], categoryOptionCombos: [], programs: [] }, pulledAt: '2024-01-01T00:00:00Z' }
      : null;
  o.storage.list = async (c: string) => {
    if (c === 'pushes')
      return [{ collection: 'pushes', key: 'p1', doc: { id: 'p1', kind: 'aggregate', status: 'OK', period: '202401', at: '2024-01-01T00:00:00Z' } }];
    if (c === 'mappings')
      return [{ collection: 'mappings', key: 'm1', doc: {} }, { collection: 'mappings', key: 'm2', doc: {} }];
    return [];
  };
  o.connectors.metadata = async () => ({ dataElements: [1, 2, 3], orgUnits: [1], categoryOptionCombos: [], programs: [], programStages: [1, 2] });
  const put = vi.fn(o.storage.put);
  o.storage.put = put as typeof o.storage.put;
  const metadata = vi.fn(o.connectors.metadata);
  o.connectors.metadata = metadata as typeof o.connectors.metadata;
  (window as unknown as { openldr: unknown }).openldr = o;
  return { o, put, metadata };
}

describe('dhis2-sink Dashboard', () => {
  it('renders the configured connector with name + host', async () => {
    mountMock();
    render(<Dashboard />);
    expect(await screen.findByText('DHIS2 demo')).toBeTruthy();
    expect(screen.getByText('play.dhis2.org')).toBeTruthy();
    expect(screen.getByText('Configured')).toBeTruthy();
  });

  it('shows cached metadata counts on load', async () => {
    mountMock();
    render(<Dashboard />);
    const counts = await screen.findByTestId('metadata-counts');
    // dataElements = 2 from the cached metadata arrays
    expect(counts.textContent).toContain('Data elements');
    await waitFor(() => expect(counts.textContent).toContain('2'));
  });

  it('renders the overview counts and the recent push row', async () => {
    mountMock();
    render(<Dashboard />);
    expect(await screen.findByTestId('recent-pushes')).toBeTruthy();
    expect(screen.getByText('OK')).toBeTruthy();
    expect(screen.getByText('aggregate · 202401')).toBeTruthy();
    // mappings count = 2
    expect(screen.getByText('Mappings:').parentElement?.textContent).toContain('2');
  });

  it('pulls metadata: calls connectors.metadata + storage.put and updates counts', async () => {
    const { put, metadata } = mountMock();
    render(<Dashboard />);
    const btn = await screen.findByTestId('dhis2-pull-metadata');
    fireEvent.click(btn);
    await waitFor(() => expect(metadata).toHaveBeenCalledWith('c1'));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('metadataCache', 'latest', expect.objectContaining({ metadata: expect.any(Object), pulledAt: expect.any(String) })),
    );
    // Program stages becomes 2 after the pull (was absent → 0 in the cache),
    // and data elements becomes 3 (was 2 in the cache).
    const counts = await screen.findByTestId('metadata-counts');
    const valueFor = (label: string) =>
      [...counts.querySelectorAll('div')].find((d) => d.querySelector('dt')?.textContent === label)?.querySelector('dd')?.textContent;
    await waitFor(() => expect(valueFor('Program stages')).toBe('2'));
    expect(valueFor('Data elements')).toBe('3');
  });

  it('shows a no-connector help line when none is enabled', async () => {
    const o = createMockOpenldr({ pluginId: 'dhis2-sink' });
    o.connectors.list = async () => [{ id: 'c1', name: 'x', enabled: false }] as unknown[];
    (window as unknown as { openldr: unknown }).openldr = o;
    render(<Dashboard />);
    expect(await screen.findByText('Not configured')).toBeTruthy();
    const btn = await screen.findByTestId('dhis2-pull-metadata');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
