import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me', username: 'admin', roles: ['lab_admin'] }, hasRole: () => true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual,
    listConnectors: vi.fn(), listSinkPlugins: vi.fn(), createConnector: vi.fn(),
    updateConnector: vi.fn(), deleteConnector: vi.fn(), testConnector: vi.fn() };
});
import * as api from '@/api';
import { toast } from 'sonner';
import { Connectors } from './Connectors';

const conn = { id: 'c1', name: 'Prod DHIS2', pluginId: 'dhis2-sink', kind: 'sink', allowedHost: 'dhis2.example.org', enabled: true, createdAt: '2026-06-24T00:00:00Z', updatedAt: '2026-06-24T00:00:00Z' };

beforeEach(() => {
  vi.clearAllMocks();
  (api.listConnectors as any).mockResolvedValue([conn]);
  (api.listSinkPlugins as any).mockResolvedValue([{ id: 'dhis2-sink', version: '1.0.0', enabled: true }]);
});

describe('Connectors page', () => {
  it('lists connectors', async () => {
    render(<MemoryRouter><Connectors /></MemoryRouter>);
    expect(await screen.findByText('Prod DHIS2')).toBeTruthy();
    expect(screen.getByText('dhis2.example.org')).toBeTruthy();
  });

  it('creates a connector via the dialog', async () => {
    (api.createConnector as any).mockResolvedValue({ ...conn, id: 'c2', name: 'New' });
    render(<MemoryRouter><Connectors /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('add-connector'));
    fireEvent.change(await screen.findByTestId('connector-name'), { target: { value: 'New' } });
    // Radix Select inside a Radix Dialog: the popper content only mounts via
    // keyboard navigation in jsdom (the dialog marks the tree pointer-events:none),
    // so open with ArrowDown then click the rendered option.
    fireEvent.keyDown(screen.getByTestId('connector-plugin'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'dhis2-sink' }));
    fireEvent.change(screen.getByTestId('connector-baseurl'), { target: { value: 'https://dhis2.example.org' } });
    fireEvent.change(screen.getByTestId('connector-username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByTestId('connector-password'), { target: { value: 'district' } });
    fireEvent.click(screen.getByTestId('connector-save'));
    await waitFor(() => expect(api.createConnector).toHaveBeenCalledWith({
      name: 'New', pluginId: 'dhis2-sink',
      config: { baseUrl: 'https://dhis2.example.org', username: 'admin', password: 'district' },
    }));
  });

  it('tests a connector and shows the metadata summary', async () => {
    (api.testConnector as any).mockResolvedValue({ ok: true, metadata: { dataElements: 12, orgUnits: 5, categoryOptionCombos: 3, programs: 1, programStages: 2 } });
    render(<MemoryRouter><Connectors /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('test-c1'));
    await waitFor(() => expect(api.testConnector).toHaveBeenCalledWith('c1'));
    expect(await screen.findByText(/12 data elements/i)).toBeTruthy();
  });

  it('removes a connector after confirm', async () => {
    (api.deleteConnector as any).mockResolvedValue(undefined);
    render(<MemoryRouter><Connectors /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('remove-c1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.deleteConnector).toHaveBeenCalledWith('c1'));
  });

  it('updates name/enabled without resending secrets', async () => {
    (api.updateConnector as any).mockResolvedValue(conn);
    render(<MemoryRouter><Connectors /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('edit-c1'));
    fireEvent.change(await screen.findByTestId('connector-name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByTestId('connector-save'));
    await waitFor(() => expect(api.updateConnector).toHaveBeenCalledWith('c1', { name: 'Renamed', enabled: true }));
  });

  it('rejects a partial connection-field re-entry on edit', async () => {
    render(<MemoryRouter><Connectors /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('edit-c1'));
    fireEvent.change(await screen.findByTestId('connector-baseurl'), { target: { value: 'https://new.example.org' } });
    fireEvent.click(screen.getByTestId('connector-save'));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(api.updateConnector).not.toHaveBeenCalled();
  });
});
