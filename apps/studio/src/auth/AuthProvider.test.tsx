import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { AuthProvider, useAuth, __resetAuthProviderState } from './AuthProvider';

vi.mock('@/api', () => ({ authFetch: vi.fn(), getMe: vi.fn(), getMyCapabilities: vi.fn() }));
vi.mock('./oidc', () => ({ getOidc: vi.fn(), createOidc: vi.fn(), __resetOidc: vi.fn() }));

import { authFetch, getMe, getMyCapabilities } from '@/api';
import { getOidc } from './oidc';

function Probe() {
  const { user, loading, hasRole, hasCapability } = useAuth();
  if (loading) return <div>loading</div>;
  return (
    <div>
      {user ? `${user.username}:${hasRole('lab_admin')}:${hasCapability('roles:manage')}:${hasCapability('roles:missing')}` : 'anon'}
    </div>
  );
}

const okConfig = (cfg: object) =>
  (authFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => cfg,
  });

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAuthProviderState();
  });

  it('dev-bypass (not enforced): loads /api/me anonymously, no OIDC', async () => {
    okConfig({ authEnforced: false, oidc: null, dashboardSqlEnabled: false });
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'dev',
      username: 'dev-admin',
      displayName: null,
      roles: ['lab_admin'],
    });
    (getMyCapabilities as ReturnType<typeof vi.fn>).mockResolvedValue(['roles:manage']);
    render(
      <MemoryRouter>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('dev-admin:true:true:false')).toBeTruthy());
    expect(getOidc).not.toHaveBeenCalled();
    expect(getMyCapabilities).toHaveBeenCalled();
  });

  it('enforced + no stored session: triggers signinRedirect', async () => {
    okConfig({ authEnforced: true, oidc: { issuerUrl: 'i', clientId: 'c', audience: null }, dashboardSqlEnabled: false });
    const signinRedirect = vi.fn();
    (getOidc as ReturnType<typeof vi.fn>).mockReturnValue({
      getStoredUser: vi.fn().mockResolvedValue(null),
      signinRedirect,
      handleCallback: vi.fn(),
      signoutRedirect: vi.fn(),
    });
    render(
      <MemoryRouter>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(signinRedirect).toHaveBeenCalled());
  });

  it('enforced + stored session: loads /api/me', async () => {
    okConfig({ authEnforced: true, oidc: { issuerUrl: 'i', clientId: 'c', audience: null }, dashboardSqlEnabled: false });
    (getOidc as ReturnType<typeof vi.fn>).mockReturnValue({
      getStoredUser: vi.fn().mockResolvedValue({ access_token: 't', expired: false }),
      signinRedirect: vi.fn(),
      handleCallback: vi.fn(),
      signoutRedirect: vi.fn(),
    });
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'u',
      username: 'ada',
      displayName: null,
      roles: ['lab_admin'],
    });
    // Failed capabilities fetch must degrade safely to an empty set (hasCapability => false),
    // rather than crashing the provider.
    (getMyCapabilities as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
    render(
      <MemoryRouter>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('ada:true:false:false')).toBeTruthy());
  });

  it('enforced + at /auth/callback: skips signinRedirect (callback route)', async () => {
    okConfig({ authEnforced: true, oidc: { issuerUrl: 'i', clientId: 'c', audience: null }, dashboardSqlEnabled: false });
    const signinRedirect = vi.fn();
    (getOidc as ReturnType<typeof vi.fn>).mockReturnValue({
      getStoredUser: vi.fn().mockResolvedValue(null),
      signinRedirect,
      handleCallback: vi.fn(),
      signoutRedirect: vi.fn(),
    });
    render(
      <MemoryRouter initialEntries={['/auth/callback']}>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );
    // loading becomes false (callback early-return), signinRedirect must NOT be called
    await waitFor(() => expect(screen.queryByText('loading')).toBeNull());
    expect(signinRedirect).not.toHaveBeenCalled();
  });

  it('config unreachable (ok:false): renders error card, does not call getMe', async () => {
    (authFetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
    render(
      <MemoryRouter>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByText('Cannot reach the server. Please reload.')).toBeTruthy(),
    );
    expect(getMe).not.toHaveBeenCalled();
    expect(getMyCapabilities).not.toHaveBeenCalled();
  });

  it('config fetch rejects: renders error card, does not call getMe', async () => {
    (authFetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
    render(
      <MemoryRouter>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByText('Cannot reach the server. Please reload.')).toBeTruthy(),
    );
    expect(getMe).not.toHaveBeenCalled();
    expect(getMyCapabilities).not.toHaveBeenCalled();
  });
});
