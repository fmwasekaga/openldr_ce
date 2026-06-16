import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, listUsers, setUserStatus, updateUser } from './api';

describe('users api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'u1' }), { status: 200, headers: { 'content-type': 'application/json' } })));
  });

  it('calls the users endpoints', async () => {
    await listUsers();
    await createUser({ username: 'ada', displayName: 'Ada', roles: ['lab_admin'] });
    await updateUser('u1', { displayName: 'Ada Lovelace', roles: ['system_auditor'] });
    await setUserStatus('u1', 'disabled');

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/users');
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/users', expect.objectContaining({ method: 'POST' }));
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/users/u1', expect.objectContaining({ method: 'PUT' }));
    expect(fetch).toHaveBeenNthCalledWith(4, '/api/users/u1/status', expect.objectContaining({ method: 'POST' }));
  });
});
