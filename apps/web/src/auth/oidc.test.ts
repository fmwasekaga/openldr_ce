import { describe, it, expect, vi, beforeEach } from 'vitest';

const signinRedirect = vi.fn();
const signoutRedirect = vi.fn();
const signinCallback = vi.fn();
const getUser = vi.fn();
const addUserLoaded = vi.fn();
const addAccessTokenExpired = vi.fn();
vi.mock('oidc-client-ts', () => ({
  UserManager: vi.fn().mockImplementation(() => ({
    signinRedirect, signoutRedirect, signinCallback, getUser,
    events: { addUserLoaded, addAccessTokenExpired },
  })),
  WebStorageStateStore: vi.fn(),
}));
vi.mock('./token', () => ({ setAccessToken: vi.fn(), getAccessToken: vi.fn() }));
import { UserManager } from 'oidc-client-ts';
import { setAccessToken } from './token';
import { createOidc } from './oidc';

const oidcCfg = { issuerUrl: 'https://kc/realms/openldr', clientId: 'openldr-web', audience: 'openldr-api' };

beforeEach(() => vi.clearAllMocks());

describe('createOidc', () => {
  it('configures UserManager with authority/client/redirect/pkce', () => {
    createOidc(oidcCfg);
    const settings = (UserManager as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(settings.authority).toBe('https://kc/realms/openldr');
    expect(settings.client_id).toBe('openldr-web');
    expect(settings.redirect_uri).toContain('/auth/callback');
    expect(settings.response_type).toBe('code');
  });
  it('handleCallback stores the access token', async () => {
    signinCallback.mockResolvedValue({ access_token: 'tok', expired: false });
    const oidc = createOidc(oidcCfg);
    const u = await oidc.handleCallback();
    expect(setAccessToken).toHaveBeenCalledWith('tok');
    expect(u?.access_token).toBe('tok');
  });
  it('getStoredUser returns null when expired', async () => {
    getUser.mockResolvedValue({ access_token: 'tok', expired: true });
    const oidc = createOidc(oidcCfg);
    expect(await oidc.getStoredUser()).toBeNull();
  });
});
