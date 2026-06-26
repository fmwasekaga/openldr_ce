import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { createMockOpenldr } from '@openldr/plugin-ui-sdk';
import { Schedules } from './Schedules';

function mountMock() {
  const o = createMockOpenldr({ pluginId: 'dhis2-sink', capabilities: ['host:schedule'] });
  o.schedule.list = async () =>
    [
      {
        id: 's1',
        mappingId: 'm1',
        mode: 'aggregate',
        periodType: 'monthly',
        eventDriven: false,
        enabled: true,
        nextDueAt: '2024-02-01T00:00:00Z',
      },
    ] as unknown[];
  o.storage.list = async (c: string) =>
    c === 'mappings'
      ? [{ collection: 'mappings', key: 'm1', doc: { id: 'm1', name: 'AMR monthly', definition: { kind: 'aggregate' } } }]
      : [];
  const register = vi.fn(o.schedule.register);
  o.schedule.register = register as typeof o.schedule.register;
  const remove = vi.fn(o.schedule.remove);
  o.schedule.remove = remove as typeof o.schedule.remove;
  (window as unknown as { openldr: unknown }).openldr = o;
  return { o, register, remove };
}

describe('dhis2-sink Schedules', () => {
  it('renders a schedule row with the resolved mapping NAME + mode', async () => {
    mountMock();
    render(<Schedules />);
    const row = await screen.findByTestId('sched-row-s1');
    expect(within(row).getByText('AMR monthly')).toBeTruthy();
    expect(within(row).getByText('aggregate')).toBeTruthy();
    expect(within(row).getByText('monthly')).toBeTruthy();
  });

  it('toggling calls schedule.register with enabled:false plus the rest of the doc', async () => {
    const { register } = mountMock();
    render(<Schedules />);
    await screen.findByTestId('sched-row-s1');
    fireEvent.click(screen.getByTestId('toggle-s1'));
    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({
        id: 's1',
        mappingId: 'm1',
        mode: 'aggregate',
        periodType: 'monthly',
        eventDriven: false,
        enabled: false,
        nextDueAt: '2024-02-01T00:00:00Z',
      }),
    );
  });

  it('creating (pick mapping → Create) registers with the derived mode', async () => {
    const { register } = mountMock();
    render(<Schedules />);
    await screen.findByTestId('sched-row-s1');

    // open the mapping picker and choose AMR monthly
    const picker = screen.getByTestId('new-mapping');
    fireEvent.click(within(picker).getByRole('button', { name: /Pick a mapping/ }));
    fireEvent.click(within(picker).getByRole('option', { name: 'AMR monthly' }));

    fireEvent.click(screen.getByTestId('create-schedule'));
    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({
        mappingId: 'm1',
        periodType: 'monthly',
        eventDriven: false,
        mode: 'aggregate',
      }),
    );
  });

  it('delete (→ confirm) calls schedule.remove', async () => {
    const { remove } = mountMock();
    render(<Schedules />);
    await screen.findByTestId('sched-row-s1');
    fireEvent.click(screen.getByTestId('del-s1'));
    fireEvent.click(await screen.findByTestId('confirm-delete'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('s1'));
  });
});
