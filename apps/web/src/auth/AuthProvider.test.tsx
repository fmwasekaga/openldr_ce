import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthProvider';

vi.mock('@/api', () => ({ fetchClientConfig: vi.fn(), getMe: vi.fn() }));
vi.mock('./oidc', () => ({ createOidc: vi.fn() }));

import { fetchClientConfig, getMe } from '@/api';
import { createOidc } from './oidc';

function Probe() {
  const { user, loading, hasRole } = useAuth();
  if (loading) return <div>loading</div>;
  return <div>{user ? `${user.username}:${hasRole('lab_admin')}` : 'anon'}</div>;
}

describe('AuthProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dev-bypass (not enforced): loads /api/me anonymously, no OIDC', async () => {
    (fetchClientConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      authEnforced: false,
      oidc: null,
      dashboardSqlEnabled: false,
    });
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'dev',
      username: 'dev-admin',
      displayName: null,
      roles: ['lab_admin'],
    });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('dev-admin:true')).toBeTruthy());
    expect(createOidc).not.toHaveBeenCalled();
  });

  it('enforced + no stored session: triggers signinRedirect', async () => {
    (fetchClientConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      authEnforced: true,
      oidc: { issuerUrl: 'i', clientId: 'c', audience: null },
      dashboardSqlEnabled: false,
    });
    const signinRedirect = vi.fn();
    (createOidc as ReturnType<typeof vi.fn>).mockReturnValue({
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
    (fetchClientConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      authEnforced: true,
      oidc: { issuerUrl: 'i', clientId: 'c', audience: null },
      dashboardSqlEnabled: false,
    });
    (createOidc as ReturnType<typeof vi.fn>).mockReturnValue({
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
    render(
      <MemoryRouter>
        <AuthProvider><Probe /></AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('ada:true')).toBeTruthy());
  });
});
