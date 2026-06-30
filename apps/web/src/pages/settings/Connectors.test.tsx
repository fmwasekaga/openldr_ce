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

const conn = {
  id: 'c1', name: 'Prod DHIS2', pluginId: 'dhis2-sink', type: null,
  kind: 'sink', allowedHost: 'dhis2.example.org', enabled: true,
  createdAt: '2026-06-24T00:00:00Z', updatedAt: '2026-06-24T00:00:00Z',
};

const dbConn = {
  id: 'c2', name: 'Prod PG', pluginId: null, type: 'postgres',
  kind: 'host', allowedHost: null, enabled: true,
  createdAt: '2026-06-24T00:00:00Z', updatedAt: '2026-06-24T00:00:00Z',
};

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

  it('Add button is always enabled even with no plugins', async () => {
    (api.listConnectors as any).mockResolvedValue([]);
    (api.listSinkPlugins as any).mockResolvedValue([]);
    render(<MemoryRouter><Connectors /></MemoryRouter>);
    const btn = await screen.findByTestId('add-connector');
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('creates a plugin connector via the dialog', async () => {
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

  it('creates a database connector (postgres) — category=Database, fills host fields, calls createConnector with type', async () => {
    (api.listConnectors as any).mockResolvedValue([]);
    (api.listSinkPlugins as any).mockResolvedValue([]);
    (api.createConnector as any).mockResolvedValue({ ...dbConn, id: 'c3', name: 'Local PG' });
    render(<MemoryRouter><Connectors /></MemoryRouter>);

    // Open dialog
    fireEvent.click(await screen.findByTestId('add-connector'));

    // Fill name
    fireEvent.change(await screen.findByTestId('connector-name'), { target: { value: 'Local PG' } });

    // Switch category to Database via ArrowDown (Radix Select in jsdom)
    fireEvent.keyDown(screen.getByTestId('connector-category'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: /database/i }));

    // DB fields should now be visible
    expect(await screen.findByTestId('connector-db-host')).toBeTruthy();
    expect(screen.getByTestId('connector-db-port')).toBeTruthy();
    expect(screen.getByTestId('connector-db-database')).toBeTruthy();
    expect(screen.getByTestId('connector-db-user')).toBeTruthy();
    expect(screen.getByTestId('connector-db-password')).toBeTruthy();
    expect(screen.getByTestId('connector-db-ssl')).toBeTruthy();

    // Fill required fields
    fireEvent.change(screen.getByTestId('connector-db-host'), { target: { value: 'localhost' } });
    fireEvent.change(screen.getByTestId('connector-db-port'), { target: { value: '5432' } });
    fireEvent.change(screen.getByTestId('connector-db-database'), { target: { value: 'mydb' } });
    fireEvent.change(screen.getByTestId('connector-db-user'), { target: { value: 'pguser' } });
    fireEvent.change(screen.getByTestId('connector-db-password'), { target: { value: 'pgpass' } });

    fireEvent.click(screen.getByTestId('connector-save'));

    await waitFor(() => expect(api.createConnector).toHaveBeenCalledWith({
      name: 'Local PG',
      type: 'postgres',
      config: { host: 'localhost', port: '5432', database: 'mydb', user: 'pguser', password: 'pgpass' },
    }));
  });

  it('tests a plugin connector and shows the metadata summary', async () => {
    (api.testConnector as any).mockResolvedValue({ ok: true, metadata: { dataElements: 12, orgUnits: 5, categoryOptionCombos: 3, programs: 1, programStages: 2 } });
    render(<MemoryRouter><Connectors /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('test-c1'));
    await waitFor(() => expect(api.testConnector).toHaveBeenCalledWith('c1'));
    expect(await screen.findByText(/12 data elements/i)).toBeTruthy();
  });

  it('tests a host connector and shows testOkSimple when no metadata returned', async () => {
    (api.listConnectors as any).mockResolvedValue([dbConn]);
    (api.testConnector as any).mockResolvedValue({ ok: true });
    render(<MemoryRouter><Connectors /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('test-c2'));
    await waitFor(() => expect(api.testConnector).toHaveBeenCalledWith('c2'));
    expect(await screen.findByText(/connection ok/i)).toBeTruthy();
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

  it('rejects a partial connection-field re-entry on edit (plugin)', async () => {
    render(<MemoryRouter><Connectors /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('edit-c1'));
    fireEvent.change(await screen.findByTestId('connector-baseurl'), { target: { value: 'https://new.example.org' } });
    fireEvent.click(screen.getByTestId('connector-save'));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(api.updateConnector).not.toHaveBeenCalled();
  });

  it('shows colType column with type or pluginId', async () => {
    (api.listConnectors as any).mockResolvedValue([conn, dbConn]);
    render(<MemoryRouter><Connectors /></MemoryRouter>);
    // plugin connector shows pluginId in type column
    expect(await screen.findByText('dhis2-sink')).toBeTruthy();
    // db connector shows type
    expect(screen.getByText('postgres')).toBeTruthy();
  });

  it('category=Database + type=MongoDB renders authSource field', async () => {
    (api.listConnectors as any).mockResolvedValue([]);
    (api.listSinkPlugins as any).mockResolvedValue([]);
    render(<MemoryRouter><Connectors /></MemoryRouter>);

    fireEvent.click(await screen.findByTestId('add-connector'));

    // Switch to Database category
    fireEvent.keyDown(screen.getByTestId('connector-category'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: /database/i }));

    // Switch type to MongoDB
    fireEvent.keyDown(await screen.findByTestId('connector-type'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: /mongodb/i }));

    expect(await screen.findByTestId('connector-db-authSource')).toBeTruthy();
    // host/port/database/user/password should also render for mongodb
    expect(screen.getByTestId('connector-db-host')).toBeTruthy();
    expect(screen.getByTestId('connector-db-password')).toBeTruthy();
  });

  it('type=Redis renders db+password, does NOT render database or user', async () => {
    (api.listConnectors as any).mockResolvedValue([]);
    (api.listSinkPlugins as any).mockResolvedValue([]);
    render(<MemoryRouter><Connectors /></MemoryRouter>);

    fireEvent.click(await screen.findByTestId('add-connector'));

    // Switch to Database category
    fireEvent.keyDown(screen.getByTestId('connector-category'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: /database/i }));

    // Switch type to Redis
    fireEvent.keyDown(await screen.findByTestId('connector-type'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: /redis/i }));

    expect(await screen.findByTestId('connector-db-host')).toBeTruthy();
    expect(screen.getByTestId('connector-db-password')).toBeTruthy();
    expect(screen.getByTestId('connector-db-db')).toBeTruthy();
    expect(screen.queryByTestId('connector-db-database')).toBeNull();
    expect(screen.queryByTestId('connector-db-user')).toBeNull();
  });

  it('saves a Redis connector with correct shape — no database/user keys', async () => {
    (api.listConnectors as any).mockResolvedValue([]);
    (api.listSinkPlugins as any).mockResolvedValue([]);
    (api.createConnector as any).mockResolvedValue({ id: 'c4', name: 'Cache', type: 'redis', kind: 'host', allowedHost: null, enabled: true, createdAt: '', updatedAt: '' });
    render(<MemoryRouter><Connectors /></MemoryRouter>);

    fireEvent.click(await screen.findByTestId('add-connector'));
    fireEvent.change(await screen.findByTestId('connector-name'), { target: { value: 'Cache' } });

    // Switch to Database category
    fireEvent.keyDown(screen.getByTestId('connector-category'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: /database/i }));

    // Switch type to Redis
    fireEvent.keyDown(await screen.findByTestId('connector-type'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: /redis/i }));

    fireEvent.change(await screen.findByTestId('connector-db-host'), { target: { value: 'redis.example.org' } });
    fireEvent.change(screen.getByTestId('connector-db-port'), { target: { value: '6379' } });
    fireEvent.change(screen.getByTestId('connector-db-password'), { target: { value: 'secret' } });
    fireEvent.change(screen.getByTestId('connector-db-db'), { target: { value: '0' } });

    fireEvent.click(screen.getByTestId('connector-save'));

    await waitFor(() => expect(api.createConnector).toHaveBeenCalledWith({
      name: 'Cache',
      type: 'redis',
      config: { host: 'redis.example.org', port: '6379', password: 'secret', db: '0' },
    }));

    // Verify no database or user keys in the config
    const callArg = (api.createConnector as any).mock.calls[0][0] as { config: Record<string, string> };
    expect(callArg.config).not.toHaveProperty('database');
    expect(callArg.config).not.toHaveProperty('user');
  });
});
