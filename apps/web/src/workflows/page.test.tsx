import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, fetchWorkflow: vi.fn() };
});
const setWorkflow = vi.fn();
const clear = vi.fn();
vi.mock('./hooks/use-workflow-store', () => ({
  useWorkflowStore: (sel?: (s: any) => unknown) => {
    const state = { configNodeId: null, workflowId: null, setWorkflow, clear };
    return sel ? sel(state) : state;
  },
}));
vi.mock('./hooks/use-workflow-api', () => ({ useWorkflowApi: () => ({ save: vi.fn(), execute: vi.fn(), fireTrigger: vi.fn(), saving: false, executing: false, lastExecution: null }) }));
vi.mock('./components/canvas', () => ({ Canvas: () => null }));
vi.mock('./components/sidebar', () => ({ Sidebar: () => null }));
vi.mock('./components/panels/node-config-panel', () => ({ NodeConfigPanel: () => null }));
vi.mock('./components/panels/toolbar', () => ({ Toolbar: () => null }));
vi.mock('./components/panels/execution-panel', () => ({ ExecutionPanel: () => null }));
vi.mock('./components/panels/run-history-drawer', () => ({ RunHistoryDrawer: () => null }));
vi.mock('./components/panels/datasets-drawer', () => ({ DatasetsDrawer: () => null }));

import * as api from '@/api';
import { Workflows } from './page';

const wf = { id: 'wf_1', name: 'AMR sync', description: null, definition: { nodes: [{ id: 'n1' }], edges: [] }, enabled: true, createdBy: null, createdAt: '', updatedAt: '' };
beforeEach(() => { vi.clearAllMocks(); (api.fetchWorkflow as any).mockResolvedValue(wf); clear.mockReset(); setWorkflow.mockReset(); });

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/workflows/new" element={<Workflows />} />
        <Route path="/workflows/:id" element={<Workflows />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Workflows builder', () => {
  it('loads the workflow named by :id into the store', async () => {
    renderAt('/workflows/wf_1');
    await waitFor(() => expect(api.fetchWorkflow).toHaveBeenCalledWith('wf_1'));
    await waitFor(() => expect(setWorkflow).toHaveBeenCalledWith('wf_1', 'AMR sync', wf.definition.nodes, wf.definition.edges));
  });
  it('starts blank for /workflows/new (resets, no fetch)', async () => {
    renderAt('/workflows/new');
    await waitFor(() => expect(clear).toHaveBeenCalled());
    expect(api.fetchWorkflow).not.toHaveBeenCalled();
  });
});
