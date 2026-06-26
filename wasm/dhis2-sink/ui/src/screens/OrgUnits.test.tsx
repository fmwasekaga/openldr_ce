import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { createMockOpenldr } from '@openldr/plugin-ui-sdk';
import { OrgUnits } from './OrgUnits';

function mountMock() {
  const o = createMockOpenldr({ pluginId: 'dhis2-sink', capabilities: ['host:fhir'] });
  o.fhir.facilities = async () => [
    { id: 'F1', name: 'Clinic A' },
    { id: 'F2', name: 'Clinic B' },
  ] as unknown[];
  o.storage.list = async (c: string) =>
    c === 'orgUnitMaps'
      ? [{ collection: 'orgUnitMaps', key: 'F1', doc: { facilityId: 'F1', orgUnitId: 'ou1', orgUnitName: 'OU One' } }]
      : [];
  o.storage.get = async (c: string, k: string) =>
    c === 'metadataCache' && k === 'latest'
      ? {
          metadata: { orgUnits: [{ id: 'ou1', name: 'OU One' }, { id: 'ou2', name: 'OU Two' }] },
          pulledAt: '2024-01-01T00:00:00Z',
        }
      : null;
  const put = vi.fn(o.storage.put);
  o.storage.put = put as typeof o.storage.put;
  const del = vi.fn(o.storage.delete);
  o.storage.delete = del as typeof o.storage.delete;
  (window as unknown as { openldr: unknown }).openldr = o;
  return { o, put, del };
}

describe('dhis2-sink OrgUnits', () => {
  it('renders facilities with mapped + unmapped state', async () => {
    mountMock();
    render(<OrgUnits />);
    const row1 = await screen.findByTestId('orgunit-row-F1');
    expect(within(row1).getByText('Clinic A')).toBeTruthy();
    // mapped: shows the org-unit name (also echoed as the picker's selected label,
    // hence getAllByText) + the org-unit id, which is unique to the mapped cell.
    expect(within(row1).getAllByText('OU One').length).toBeGreaterThan(0);
    expect(within(row1).getByText('(ou1)')).toBeTruthy();

    const row2 = screen.getByTestId('orgunit-row-F2');
    expect(within(row2).getByText('Unmapped')).toBeTruthy();
  });

  it('shows the metadata pulled-at line', async () => {
    mountMock();
    render(<OrgUnits />);
    await screen.findByTestId('orgunit-row-F1');
    expect(screen.getByText(/Metadata pulled at/)).toBeTruthy();
  });

  it('picks an org unit → storage.put with the looked-up name', async () => {
    const { put } = mountMock();
    render(<OrgUnits />);
    const row2 = await screen.findByTestId('orgunit-row-F2');
    // open the picker for the unmapped facility
    fireEvent.click(within(row2).getByRole('button', { name: /Pick an org unit/ }));
    fireEvent.click(within(row2).getByRole('option', { name: 'OU One' }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('orgUnitMaps', 'F2', {
        facilityId: 'F2',
        orgUnitId: 'ou1',
        orgUnitName: 'OU One',
      }),
    );
  });

  it('clears a mapped facility → storage.delete', async () => {
    const { del } = mountMock();
    render(<OrgUnits />);
    const row1 = await screen.findByTestId('orgunit-row-F1');
    fireEvent.click(within(row1).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('orgUnitMaps', 'F1'));
  });

  it('disables the picker when the org-unit catalog is empty', async () => {
    const o = createMockOpenldr({ pluginId: 'dhis2-sink' });
    o.fhir.facilities = async () => [{ id: 'F1', name: 'Clinic A' }] as unknown[];
    o.storage.list = async () => [];
    o.storage.get = async () => ({ metadata: { orgUnits: [] }, pulledAt: '2024-01-01T00:00:00Z' });
    (window as unknown as { openldr: unknown }).openldr = o;
    render(<OrgUnits />);
    const row1 = await screen.findByTestId('orgunit-row-F1');
    const trigger = within(row1).getByRole('button', { name: /Pick an org unit/ }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
  });
});
