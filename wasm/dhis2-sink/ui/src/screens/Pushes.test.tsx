import { render, screen, waitFor, within } from '@testing-library/preact';
import { createMockOpenldr } from '@openldr/plugin-ui-sdk';
import { Pushes } from './Pushes';

type StoreEntry = { collection: string; key: string; doc: unknown };

function mountMock(docs: StoreEntry[]) {
  const o = createMockOpenldr({ pluginId: 'dhis2-sink' });
  o.storage.list = async (c: string) => (c === 'pushes' ? docs : []);
  (window as unknown as { openldr: unknown }).openldr = o;
  return o;
}

describe('dhis2-sink Pushes', () => {
  it('renders push rows newest-first with kind, period, status + result', async () => {
    mountMock([
      {
        collection: 'pushes',
        key: 'p1',
        doc: {
          id: 'p1',
          kind: 'aggregate',
          period: '202401',
          status: 'OK',
          imported: 12,
          updated: 3,
          conflicts: 0,
          trigger: 'manual',
          at: '2024-01-01T00:00:00Z',
        },
      },
      {
        collection: 'pushes',
        key: 'p2',
        doc: {
          id: 'p2',
          kind: 'tracker',
          period: '202402',
          status: 'failed',
          imported: 0,
          updated: 0,
          conflicts: 1,
          skipped: 2,
          error: 'boom',
          trigger: 'schedule',
          at: '2024-02-01T00:00:00Z',
        },
      },
    ]);
    render(<Pushes />);

    const table = await screen.findByTestId('pushes-table');
    const rows = within(table).getAllByRole('row');
    // rows[0] = header; rows[1] = newest (202402, failed); rows[2] = older (202401, OK)
    expect(within(rows[1]).getByText('202402')).toBeTruthy();
    expect(within(rows[1]).getByText('failed')).toBeTruthy();
    expect(within(rows[1]).getByText('tracker')).toBeTruthy();
    expect(within(rows[2]).getByText('202401')).toBeTruthy();
    expect(within(rows[2]).getByText('OK')).toBeTruthy();
    expect(within(rows[2]).getByText('aggregate')).toBeTruthy();
    // result summary: imp/upd/conf (+ skip when >0)
    expect(within(rows[2]).getByText('12 imp · 3 upd · 0 conf')).toBeTruthy();
    expect(within(rows[1]).getByText('0 imp · 0 upd · 1 conf · 2 skip')).toBeTruthy();
  });

  it('shows an empty state when there are no pushes', async () => {
    mountMock([]);
    render(<Pushes />);
    await waitFor(() => expect(screen.getByText('No pushes yet')).toBeTruthy());
    expect(screen.queryByTestId('pushes-table')).toBeNull();
  });
});
