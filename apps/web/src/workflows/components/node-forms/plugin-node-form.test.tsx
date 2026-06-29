import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginNodeForm } from './plugin-node-form';
import * as api from '@/api';

vi.mock('@/api', async (orig) => ({ ...(await orig<typeof api>()), fetchWorkflowNodes: vi.fn(), fetchNodeOptions: vi.fn(), fetchNodeDetail: vi.fn() }));

const descriptor = {
  id: 'test-sink:echo', source: 'plugin', pluginId: 'test-sink', label: 'Echo', kind: 'transform',
  description: '', entrypoint: 'wf_echo', ports: { inputs: [{ name: 'in' }], outputs: [{ name: 'out' }] },
  capabilities: [], config: [
    { key: 'note', label: 'Note', type: 'text' },
    { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
  ],
};
const node = { id: 'n1', type: 'plugin-node', data: { label: 'Echo', pluginId: 'test-sink', nodeId: 'echo', kind: 'transform', config: { note: 'hi' } } } as never;

const detailDescriptor = {
  ...descriptor,
  config: [
    {
      key: 'mappingId', label: 'Mapping', type: 'select',
      optionsSource: 'dhis2-mappings', detailSource: 'dhis2-mapping',
      options: [{ value: 'm1', label: 'M1' }],
    },
  ],
};
const detailNode = { id: 'n2', type: 'plugin-node', data: { label: 'Echo', pluginId: 'test-sink', nodeId: 'echo', kind: 'transform', config: {} } } as never;

beforeEach(() => {
  (api.fetchWorkflowNodes as ReturnType<typeof vi.fn>).mockResolvedValue([descriptor]);
  (api.fetchNodeOptions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.fetchNodeDetail as ReturnType<typeof vi.fn>).mockResolvedValue({});
});

describe('PluginNodeForm', () => {
  it('renders the declarative config fields from the descriptor', async () => {
    render(<PluginNodeForm node={node} update={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Note')).toBeInTheDocument());
    expect(screen.getByText('Mode')).toBeInTheDocument();
    expect((screen.getByDisplayValue('hi') as HTMLInputElement)).toBeInTheDocument();
  });

  it('calls update with the new config when a field changes', async () => {
    const update = vi.fn();
    render(<PluginNodeForm node={node} update={update} />);
    const input = await screen.findByDisplayValue('hi');
    fireEvent.change(input, { target: { value: 'bye' } });
    await waitFor(() => expect(update).toHaveBeenCalled());
  });

  it('merges the resolved detail into config when a detailSource select changes', async () => {
    (api.fetchWorkflowNodes as ReturnType<typeof vi.fn>).mockResolvedValue([detailDescriptor]);
    (api.fetchNodeOptions as ReturnType<typeof vi.fn>).mockResolvedValue([{ value: 'm1', label: 'M1' }]);
    (api.fetchNodeDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      mapping: { x: 1 }, orgUnitMap: { a: 'b' },
    });
    const update = vi.fn();
    render(<PluginNodeForm node={detailNode} update={update} />);
    const select = await screen.findByRole('combobox');
    await screen.findByRole('option', { name: 'M1' });
    fireEvent.change(select, { target: { value: 'm1' } });
    await waitFor(() =>
      expect(api.fetchNodeDetail).toHaveBeenCalledWith('dhis2-mapping', 'm1'),
    );
    await waitFor(() => {
      const merged = update.mock.calls.find(
        ([arg]) => (arg as { config?: Record<string, unknown> }).config?.mapping !== undefined,
      );
      expect(merged).toBeTruthy();
      const cfg = (merged![0] as { config: Record<string, unknown> }).config;
      expect(cfg).toMatchObject({ mappingId: 'm1', mapping: { x: 1 }, orgUnitMap: { a: 'b' } });
    });
  });
});
