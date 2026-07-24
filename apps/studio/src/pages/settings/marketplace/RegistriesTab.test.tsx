import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me', username: 'admin', roles: ['lab_admin'] }, hasCapability: () => true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual,
    listRegistries: vi.fn(), createRegistry: vi.fn(),
    updateRegistry: vi.fn(), deleteRegistry: vi.fn() };
});
import * as api from '@/api';
import { RegistriesTab } from './RegistriesTab';

const reg = { id: 'r1', name: 'Official', kind: 'http' as const, location: 'https://reg.example.org', enabled: true, createdAt: '2026-06-24T00:00:00Z', updatedAt: '2026-06-24T00:00:00Z' };

beforeEach(() => {
  vi.clearAllMocks();
  (api.listRegistries as any).mockResolvedValue([reg]);
});

describe('RegistriesTab', () => {
  it('lists registries', async () => {
    render(<MemoryRouter><RegistriesTab onChanged={() => {}} /></MemoryRouter>);
    expect(await screen.findByText('Official')).toBeTruthy();
    expect(screen.getByText('https://reg.example.org')).toBeTruthy();
  });

  it('creates a registry via the dialog', async () => {
    (api.createRegistry as any).mockResolvedValue({ ...reg, id: 'r2', name: 'New' });
    render(<MemoryRouter><RegistriesTab onChanged={() => {}} /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('add-registry'));
    fireEvent.change(await screen.findByTestId('registry-name'), { target: { value: 'New' } });
    // Radix Select inside a Radix Dialog: open with ArrowDown then click the rendered option.
    fireEvent.keyDown(screen.getByTestId('registry-kind'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Remote (HTTP)' }));
    fireEvent.change(screen.getByTestId('registry-location'), { target: { value: 'https://reg.example.org' } });
    fireEvent.click(screen.getByTestId('registry-save'));
    await waitFor(() => expect(api.createRegistry).toHaveBeenCalledWith({
      name: 'New', kind: 'http', location: 'https://reg.example.org',
    }));
  });

  it('removes a registry after confirm', async () => {
    (api.deleteRegistry as any).mockResolvedValue(undefined);
    render(<MemoryRouter><RegistriesTab onChanged={() => {}} /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('remove-r1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.deleteRegistry).toHaveBeenCalledWith('r1'));
  });

  it('toggles enabled', async () => {
    (api.updateRegistry as any).mockResolvedValue(reg);
    render(<MemoryRouter><RegistriesTab onChanged={() => {}} /></MemoryRouter>);
    // The Switch primitive renders role="switch"; one per row.
    fireEvent.click(await screen.findByRole('switch'));
    await waitFor(() => expect(api.updateRegistry).toHaveBeenCalledWith('r1', { enabled: false }));
  });
});
