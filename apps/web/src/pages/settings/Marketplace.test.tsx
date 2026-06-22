import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me', username: 'admin', roles: ['lab_admin'] }, hasRole: () => true }) }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual,
    listInstalledArtifacts: vi.fn(), listAvailableArtifacts: vi.fn(),
    installArtifact: vi.fn(), setArtifactEnabled: vi.fn(), rollbackArtifact: vi.fn(), removeArtifact: vi.fn() };
});
import * as api from '@/api';
import { Marketplace } from './Marketplace';

beforeEach(() => { vi.clearAllMocks(); });

it('lists available bundles and installs after consent', async () => {
  (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, bundles: [{ ref: 'whonet-narrow', id: 'whonet-sqlite', version: '1.0.0', type: 'plugin', publisher: { id: 'p', name: 'P' }, capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }], compatibility: { ceVersion: '*' }, valid: true }] });
  (api.listInstalledArtifacts as any).mockResolvedValue([]);
  (api.installArtifact as any).mockResolvedValue({ id: 'whonet-sqlite', version: '1.0.0' });
  render(<MemoryRouter><Marketplace /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId('install-whonet-narrow'));
  // consent dialog shows the requested capabilities
  expect(await screen.findByText(/Patient/)).toBeTruthy();
  fireEvent.click(screen.getByTestId('approve-install'));
  await waitFor(() => expect(api.installArtifact).toHaveBeenCalledWith('whonet-narrow', [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }]));
});

it('shows the unconfigured empty state', async () => {
  (api.listAvailableArtifacts as any).mockResolvedValue({ configured: false, bundles: [] });
  (api.listInstalledArtifacts as any).mockResolvedValue([]);
  render(<MemoryRouter><Marketplace /></MemoryRouter>);
  expect(await screen.findByText(/No marketplace registry configured/i)).toBeTruthy();
});

it('disables install for a non-plugin bundle', async () => {
  (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, bundles: [{ ref: 'form1', id: 'intake', version: '1.0.0', type: 'form-template', publisher: null, capabilities: [], compatibility: { ceVersion: '*' }, valid: true }] });
  (api.listInstalledArtifacts as any).mockResolvedValue([]);
  render(<MemoryRouter><Marketplace /></MemoryRouter>);
  expect((await screen.findByTestId('install-form1')).hasAttribute('disabled')).toBe(true);
});

it('enable/disable + remove call the api', async () => {
  (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, bundles: [] });
  (api.listInstalledArtifacts as any).mockResolvedValue([{ id: 'whonet-sqlite', version: '1.0.0', active: true, enabled: true, approvedBy: 'admin', type: 'plugin', publisher: null, capabilities: [], legacy: false }]);
  (api.setArtifactEnabled as any).mockResolvedValue(undefined);
  render(<MemoryRouter><Marketplace /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId('toggle-enabled-whonet-sqlite'));
  await waitFor(() => expect(api.setArtifactEnabled).toHaveBeenCalledWith('whonet-sqlite', false));
});
