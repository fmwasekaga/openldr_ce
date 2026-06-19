import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthProvider';
import * as api from '../api';

function Probe() {
  const { user, loading, hasRole } = useAuth();
  if (loading) return <div>loading</div>;
  return <div>{user ? `${user.username}:${hasRole('lab_admin')}` : 'anon'}</div>;
}

describe('AuthProvider', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('exposes the current user and hasRole', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue({ id: 'u1', username: 'ada', displayName: 'Ada', roles: ['lab_admin'] });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('ada:true')).toBeTruthy());
  });

  it('falls back to anon when /api/me fails', async () => {
    vi.spyOn(api, 'getMe').mockRejectedValue(new Error('401'));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('anon')).toBeTruthy());
  });
});
