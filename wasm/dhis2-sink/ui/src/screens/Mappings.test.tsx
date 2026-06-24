import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import { createMockOpenldr } from '@openldr/plugin-ui-sdk';
import { Mappings } from './Mappings';

type StoreEntry = { collection: string; key: string; doc: unknown };

const DEFINITION = {
  kind: 'aggregate',
  connectorId: 'c1',
  source: { reportId: 'r1' },
};

const MAPPING_DOC = { id: 'm1', name: 'AMR agg', definition: DEFINITION };

const RUN_OUTCOME = {
  kind: 'aggregate',
  dryRun: false,
  build: { payload: { dataValues: [{ a: 1 }, { a: 2 }, { a: 3 }] }, skipped: [] },
  result: { status: 'OK', imported: 3, updated: 1, ignored: 0, conflicts: [] },
};

function mountMock() {
  const o = createMockOpenldr({ pluginId: 'dhis2-sink' });
  o.storage.list = async (c: string): Promise<StoreEntry[]> => {
    if (c === 'mappings') return [{ collection: 'mappings', key: 'm1', doc: MAPPING_DOC }];
    if (c === 'orgUnitMaps') return [{ collection: 'orgUnitMaps', key: 'f1', doc: { facilityId: 'f1', orgUnitId: 'ou1' } }];
    return [];
  };
  o.storage.get = async (c: string, key: string) => (c === 'mappings' && key === 'm1' ? MAPPING_DOC : null);
  const pushSpy = vi.fn(async () => RUN_OUTCOME);
  o.connectors.push = pushSpy as typeof o.connectors.push;
  const deleteSpy = vi.fn(async () => {});
  o.storage.delete = deleteSpy as typeof o.storage.delete;
  (window as unknown as { openldr: unknown }).openldr = o;
  return { pushSpy, deleteSpy };
}

describe('dhis2-sink Mappings', () => {
  it('renders a mapping row with its name and kind badge', async () => {
    mountMock();
    render(<Mappings />);
    const row = await screen.findByTestId('mapping-row-m1');
    expect(row.textContent).toContain('AMR agg');
    expect(row.textContent).toContain('aggregate');
  });

  it('Push calls connectors.push with the definition + orgUnitMap + period and shows the result', async () => {
    const { pushSpy } = mountMock();
    render(<Mappings />);
    fireEvent.click(await screen.findByTestId('run-m1'));

    fireEvent.input(await screen.findByTestId('run-period'), { target: { value: '202401' } });
    fireEvent.click(screen.getByTestId('run-push'));

    await waitFor(() => expect(pushSpy).toHaveBeenCalledTimes(1));
    expect(pushSpy).toHaveBeenCalledWith({
      connectorId: 'c1',
      mapping: DEFINITION,
      orgUnitMap: { f1: 'ou1' },
      period: '202401',
      dryRun: false,
    });

    const result = await screen.findByTestId('run-result');
    expect(result.textContent).toContain('Values:');
    expect(result.textContent).toContain('3'); // 3 dataValues
    expect(result.textContent).toContain('OK'); // push status
    expect(result.textContent).toContain('imported 3');
  });

  it('Dry run passes dryRun:true', async () => {
    const { pushSpy } = mountMock();
    render(<Mappings />);
    fireEvent.click(await screen.findByTestId('run-m1'));
    fireEvent.input(await screen.findByTestId('run-period'), { target: { value: '202401' } });
    fireEvent.click(screen.getByTestId('run-dry'));

    await waitFor(() => expect(pushSpy).toHaveBeenCalledTimes(1));
    expect(pushSpy).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, period: '202401' }));
  });

  it('Delete → confirm calls storage.delete', async () => {
    const { deleteSpy } = mountMock();
    render(<Mappings />);
    fireEvent.click(await screen.findByTestId('delete-m1'));
    fireEvent.click(await screen.findByTestId('confirm-delete'));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('mappings', 'm1'));
  });
});
