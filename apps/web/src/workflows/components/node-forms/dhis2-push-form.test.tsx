import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listDhis2PushMappings: vi.fn(), testConnector: vi.fn() };
});
import * as api from '@/api';
import { Dhis2PushForm } from './dhis2-push-form';

const node = (config: Record<string, unknown> = {}) => ({ id: 'n1', type: 'action', position: { x: 0, y: 0 }, data: { label: 'Push', config } }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  (api.listDhis2PushMappings as any).mockResolvedValue([{ id: 'amr-mapping', name: 'AMR', connectorId: 'c1' }]);
});

describe('Dhis2PushForm', () => {
  it('lists mappings in a picker and updates config on select', async () => {
    const update = vi.fn();
    render(<Dhis2PushForm node={node()} update={update} />);
    const select = await screen.findByTestId('dhis2-mapping-select');
    fireEvent.change(select, { target: { value: 'amr-mapping' } });
    expect(update).toHaveBeenCalledWith({ config: expect.objectContaining({ mappingId: 'amr-mapping' }) });
  });

  it('tests the selected mapping connector (from the picker) and shows the result', async () => {
    (api.testConnector as any).mockResolvedValue({ ok: true, metadata: { dataElements: 7, orgUnits: 2, categoryOptionCombos: 0, programs: 0, programStages: 0 } });
    render(<Dhis2PushForm node={node({ mappingId: 'amr-mapping' })} update={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('dhis2-test'));
    await waitFor(() => expect(api.testConnector).toHaveBeenCalledWith('c1'));
    expect(await screen.findByText(/7 data elements/i)).toBeTruthy();
  });
});
