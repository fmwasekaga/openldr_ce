import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me', username: 'admin', roles: ['lab_admin'] }, hasRole: () => true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, fetchWorkflows: vi.fn(), createWorkflow: vi.fn(), deleteWorkflow: vi.fn() };
});
import * as api from '@/api';
import { WorkflowList } from './WorkflowList';

const wf = (over = {}) => ({ id: 'wf_1', name: 'AMR sync', description: null, definition: { nodes: [], edges: [] }, enabled: true, createdBy: null, createdAt: '2026-06-24T00:00:00Z', updatedAt: '2026-06-24T00:00:00Z', ...over });

beforeEach(() => {
  vi.clearAllMocks();
  (api.fetchWorkflows as any).mockResolvedValue([wf()]);
});

describe('WorkflowList', () => {
  it('lists workflows', async () => {
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    expect(await screen.findByText('AMR sync')).toBeTruthy();
  });
  it('navigates to the builder for a new workflow', async () => {
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('workflow-new'));
    expect(navigateMock).toHaveBeenCalledWith('/workflows/new');
  });
  it('opens a workflow in the builder', async () => {
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('open-wf_1'));
    expect(navigateMock).toHaveBeenCalledWith('/workflows/wf_1');
  });
  it('duplicates a workflow', async () => {
    (api.createWorkflow as any).mockResolvedValue(wf({ id: 'wf_2', name: 'AMR sync (copy)' }));
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('duplicate-wf_1'));
    await waitFor(() => expect(api.createWorkflow).toHaveBeenCalledWith(expect.objectContaining({ name: 'AMR sync (copy)' })));
  });
  it('deletes a workflow after confirm', async () => {
    (api.deleteWorkflow as any).mockResolvedValue(undefined);
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('delete-wf_1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteWorkflow).toHaveBeenCalledWith('wf_1'));
  });
});
