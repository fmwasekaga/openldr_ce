import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me', username: 'admin', roles: ['lab_admin'] }, hasRole: () => true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual,
    listInstalledArtifacts: vi.fn(), listAvailableArtifacts: vi.fn(), getAvailableArtifact: vi.fn(),
    installArtifact: vi.fn(), setArtifactEnabled: vi.fn(), rollbackArtifact: vi.fn(), removeArtifact: vi.fn(), detachArtifact: vi.fn(), refreshRegistry: vi.fn(),
    getPublishStatus: vi.fn(), publishArtifact: vi.fn() };
});
import * as api from '@/api';
import { Marketplace } from './Marketplace';

beforeEach(() => {
  vi.clearAllMocks();
  (api.getPublishStatus as any).mockResolvedValue({ configured: false, repo: null });
});

const oneBundle = {
  configured: true,
  source: 'local', host: 'local',
  bundles: [{ ref: 'whonet-narrow', id: 'whonet-sqlite', version: '1.0.0', type: 'plugin', publisher: { id: 'p', name: 'P' }, capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }], compatibility: { ceVersion: '*' }, valid: true }],
};

function mockDetail() {
  (api.getAvailableArtifact as any).mockResolvedValue({
    ref: 'whonet-narrow', id: 'whonet-sqlite', version: '1.0.0', type: 'plugin',
    description: 'desc', license: 'Apache-2.0', publisher: { id: 'p', name: 'P' },
    capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }],
    compatibility: { ceVersion: '*' }, compatible: true, ceVersion: '0.1.0',
    payload: { kind: 'plugin', entrypoint: 'convert', wasmSha256: 'a'.repeat(64), wasi: true, limits: { memoryMb: 256, timeoutMs: 30000 } },
    valid: true,
  });
}

describe('Marketplace', () => {
  it('browses a bundle, opens detail, installs after consent', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue(oneBundle);
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    (api.installArtifact as any).mockResolvedValue({ id: 'whonet-sqlite', version: '1.0.0' });
    mockDetail();
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('card-whonet-narrow'));
    fireEvent.click(await screen.findByTestId('detail-install'));
    expect((await screen.findAllByText(/Patient/)).length).toBeGreaterThan(0); // consent dialog
    fireEvent.click(screen.getByTestId('approve-install'));
    await waitFor(() => expect(api.installArtifact).toHaveBeenCalledWith('whonet-narrow', [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }]));
  });

  it('shows the unconfigured empty state', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: false, source: null, host: null, bundles: [] });
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    expect(await screen.findByText(/No marketplace registry configured/i)).toBeTruthy();
  });

  it('installed tab lists installed artifacts and toggles enabled from detail', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [] });
    (api.listInstalledArtifacts as any).mockResolvedValue([{ id: 'whonet-sqlite', version: '1.0.0', active: true, enabled: true, approvedBy: 'admin', type: 'plugin', publisher: null, capabilities: [], legacy: false }]);
    (api.setArtifactEnabled as any).mockResolvedValue(undefined);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    // Radix Tabs activate on mouseDown in jsdom (matches the repo's tabs.test pattern).
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /Installed \(1\)/ }), { button: 0 });
    fireEvent.click(await screen.findByTestId('card-whonet-sqlite'));
    // Radix DropdownMenu opens on pointerDown in jsdom, with a keyboard fallback (matches the repo's BuilderHeader test pattern).
    const menuTrigger = await screen.findByTestId('detail-menu');
    fireEvent.pointerDown(menuTrigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Disable')) fireEvent.keyDown(menuTrigger, { key: 'Enter' });
    fireEvent.click(await screen.findByText('Disable'));
    await waitFor(() => expect(api.setArtifactEnabled).toHaveBeenCalledWith('whonet-sqlite', false));
  });

  it('detaches an installed form-template from its detail menu', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [] });
    (api.listInstalledArtifacts as any).mockResolvedValue([{ id: 'demo-form', version: '1.0.0', active: true, enabled: true, approvedBy: 'admin', type: 'form-template', publisher: { name: 'Acme' }, capabilities: [], legacy: false, drifted: false, targetFormId: 'form-9' }]);
    (api.detachArtifact as any).mockResolvedValue(undefined);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    // Radix Tabs activate on mouseDown in jsdom (matches the installed-tab test above).
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /Installed \(1\)/ }), { button: 0 });
    fireEvent.click(await screen.findByTestId('card-demo-form'));
    // Radix DropdownMenu opens on pointerDown in jsdom, with a keyboard fallback.
    const menuTrigger = await screen.findByTestId('detail-menu');
    fireEvent.pointerDown(menuTrigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Detach')) fireEvent.keyDown(menuTrigger, { key: 'Enter' });
    fireEvent.click(await screen.findByText('Detach'));
    // Confirm in the AlertDialog (its action button is also labelled "Detach").
    fireEvent.click(await screen.findByRole('button', { name: 'Detach' }));
    await waitFor(() => expect(api.detachArtifact).toHaveBeenCalledWith('demo-form'));
  });

  it('publishes a staged bundle and shows the PR toast', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ ...oneBundle });
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    (api.getPublishStatus as any).mockResolvedValue({ configured: true, repo: 'o/r' });
    (api.getAvailableArtifact as any).mockResolvedValue({
      ref: 'whonet-narrow', id: 'whonet-sqlite', version: '1.0.0', type: 'plugin', description: 'd', license: 'L',
      publisher: { id: 'p', name: 'P' }, capabilities: [], compatibility: { ceVersion: '*' }, compatible: true, ceVersion: '0.1.0',
      payload: { kind: 'plugin', entrypoint: 'convert', wasmSha256: 'a'.repeat(64), wasi: true, limits: { memoryMb: 256, timeoutMs: 30000 } }, valid: true,
    });
    (api.publishArtifact as any).mockResolvedValue({ prUrl: 'https://gh/pr/9', prNumber: 9 });
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('card-whonet-narrow'));
    fireEvent.click(await screen.findByTestId('detail-publish'));
    await waitFor(() => expect(api.publishArtifact).toHaveBeenCalledWith('whonet-narrow'));
  });

  it('refreshes the registry', async () => {
    (api.listAvailableArtifacts as any).mockResolvedValue({ configured: true, source: 'local', host: 'local', bundles: [] });
    (api.listInstalledArtifacts as any).mockResolvedValue([]);
    (api.refreshRegistry as any).mockResolvedValue(undefined);
    render(<MemoryRouter><Marketplace /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('refresh-registry'));
    await waitFor(() => expect(api.refreshRegistry).toHaveBeenCalled());
  });
});
