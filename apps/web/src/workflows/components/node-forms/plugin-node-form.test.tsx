import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginNodeForm } from './plugin-node-form';
import * as api from '@/api';

vi.mock('@/api', async (orig) => ({ ...(await orig<typeof api>()), fetchWorkflowNodes: vi.fn(), fetchNodeOptions: vi.fn() }));

const descriptor = {
  id: 'test-sink:echo', source: 'plugin', pluginId: 'test-sink', label: 'Echo', kind: 'transform',
  description: '', entrypoint: 'wf_echo', ports: { inputs: [{ name: 'in' }], outputs: [{ name: 'out' }] },
  capabilities: [], config: [
    { key: 'note', label: 'Note', type: 'text' },
    { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
  ],
};
const node = { id: 'n1', type: 'plugin-node', data: { label: 'Echo', pluginId: 'test-sink', nodeId: 'echo', kind: 'transform', config: { note: 'hi' } } } as never;

beforeEach(() => {
  (api.fetchWorkflowNodes as ReturnType<typeof vi.fn>).mockResolvedValue([descriptor]);
  (api.fetchNodeOptions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
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
});
