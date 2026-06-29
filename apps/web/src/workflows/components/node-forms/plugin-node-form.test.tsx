import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginNodeForm } from './plugin-node-form';
import * as api from '@/api';

vi.mock('@/api', async (orig) => ({ ...(await orig<typeof api>()), fetchWorkflowNodes: vi.fn(), fetchNodeOptions: vi.fn(), fetchNodeDetail: vi.fn() }));

// CodeMirror renders a contenteditable (not a textarea) and is awkward in jsdom,
// so we mock the editor with a plain textarea that forwards onChange.
vi.mock('./code-editor', () => ({
  CodeEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="code-editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

// The shared Select is now backed by Radix (a div-based combobox), which does not
// respond to `fireEvent.change`. Render it as a native <select> in this test so the
// existing change-driven assertions (detailSource/optionsSource) stay simple.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) => (
    <select role="combobox" value={value ?? ''} onChange={(e) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

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

  it('persists a parsed object when valid JSON is typed into a json field', async () => {
    const jsonDescriptor = {
      ...descriptor,
      config: [{ key: 'mapping', label: 'Mapping', type: 'json' }],
    };
    (api.fetchWorkflowNodes as ReturnType<typeof vi.fn>).mockResolvedValue([jsonDescriptor]);
    const jsonNode = { id: 'n3', type: 'plugin-node', data: { label: 'Echo', pluginId: 'test-sink', nodeId: 'echo', kind: 'transform', config: {} } } as never;
    const update = vi.fn();
    const { container } = render(<PluginNodeForm node={jsonNode} update={update} />);
    await waitFor(() => expect(screen.getByText('Mapping')).toBeInTheDocument());
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{"a":1}' } });
    await waitFor(() => {
      const call = update.mock.calls.find(
        ([arg]) => (arg as { config?: Record<string, unknown> }).config?.mapping !== undefined,
      );
      expect(call).toBeTruthy();
      const cfg = (call![0] as { config: Record<string, unknown> }).config;
      expect(cfg.mapping).toEqual({ a: 1 });
    });
  });

  it('does not persist a broken value and shows an error when invalid JSON is typed', async () => {
    const jsonDescriptor = {
      ...descriptor,
      config: [{ key: 'mapping', label: 'Mapping', type: 'json' }],
    };
    (api.fetchWorkflowNodes as ReturnType<typeof vi.fn>).mockResolvedValue([jsonDescriptor]);
    const jsonNode = { id: 'n4', type: 'plugin-node', data: { label: 'Echo', pluginId: 'test-sink', nodeId: 'echo', kind: 'transform', config: {} } } as never;
    const update = vi.fn();
    const { container } = render(<PluginNodeForm node={jsonNode} update={update} />);
    await waitFor(() => expect(screen.getByText('Mapping')).toBeInTheDocument());
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{bad' } });
    // No update call should set config.mapping to the broken raw text or any value.
    const badCall = update.mock.calls.find(
      ([arg]) => 'mapping' in ((arg as { config?: Record<string, unknown> }).config ?? {}),
    );
    expect(badCall).toBeFalsy();
    // An error message is surfaced.
    await waitFor(() => expect(screen.getByText(/JSON|Unexpected|token/i)).toBeInTheDocument());
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
