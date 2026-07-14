import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCtx = vi.hoisted(() => ({ close: vi.fn() }));
const enrollSite = vi.hoisted(() => vi.fn());
const listSites = vi.hoisted(() => vi.fn());
const rotateSite = vi.hoisted(() => vi.fn());
const revokeSite = vi.hoisted(() => vi.fn());

vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({ config: true })) }));

vi.mock('@openldr/bootstrap', () => ({
  createAppContext: vi.fn(async () => mockCtx),
  enrollSite,
  listSites,
  rotateSite,
  revokeSite,
}));

import { runSyncEnroll, runSyncList, runSyncRotate, runSyncRevoke } from './sync';

// A typed enrollment error mirrors the orchestrator's `.name`-tagged Error subclasses.
function named(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

describe('sync enroll|list|rotate|revoke commands', () => {
  let out: ReturnType<typeof vi.fn>;
  let err: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
  });
  afterEach(() => {
    out.mockRestore();
    err.mockRestore();
  });

  const stdout = (): string => out.mock.calls.map((c) => c[0]).join('');
  const stderr = (): string => err.mock.calls.map((c) => c[0]).join('');

  it('requires --central-url and never builds a context', async () => {
    await expect(runSyncEnroll('lab-a', {})).resolves.toBe(1);
    expect(enrollSite).not.toHaveBeenCalled();
    expect(mockCtx.close).not.toHaveBeenCalled();
    expect(stderr()).toContain('central URL required (use --central-url)');
  });

  it('enrolls a site, prints the secret once with the warning, and closes the context', async () => {
    const result = {
      clientId: 'sync-lab-a',
      clientSecret: 'sekret',
      siteId: 'lab-a',
      centralUrl: 'https://central.example',
      oidcIssuer: 'https://kc/realms/openldr',
    };
    enrollSite.mockResolvedValueOnce(result);

    await expect(runSyncEnroll('lab-a', { centralUrl: 'https://central.example' })).resolves.toBe(0);

    expect(enrollSite).toHaveBeenCalledWith(mockCtx, {
      siteId: 'lab-a',
      name: null,
      centralUrl: 'https://central.example',
      actor: null,
    });
    const text = stdout();
    expect(text).toContain('will not be shown again');
    expect((text.match(/sekret/g) ?? []).length).toBe(1); // printed exactly once
    expect(mockCtx.close).toHaveBeenCalledTimes(1);
  });

  it('emits the full EnrollResult as JSON with --json', async () => {
    const result = { clientId: 'sync-lab-a', clientSecret: 's', siteId: 'lab-a', centralUrl: 'u', oidcIssuer: 'i' };
    enrollSite.mockResolvedValueOnce(result);
    await expect(runSyncEnroll('lab-a', { centralUrl: 'u', json: true })).resolves.toBe(0);
    expect(stdout()).toBe(JSON.stringify(result, null, 2) + '\n');
  });

  it('maps AlreadyEnrolledError to a rotate hint and exit 1', async () => {
    enrollSite.mockRejectedValueOnce(named('AlreadyEnrolledError'));
    await expect(runSyncEnroll('lab-a', { centralUrl: 'u' })).resolves.toBe(1);
    expect(stderr()).toContain('site already enrolled');
    expect(mockCtx.close).toHaveBeenCalledTimes(1);
  });

  it('maps InvalidSiteIdError and IdentityAdminNotConfiguredError', async () => {
    enrollSite.mockRejectedValueOnce(named('InvalidSiteIdError'));
    await expect(runSyncEnroll('BAD', { centralUrl: 'u' })).resolves.toBe(1);
    expect(stderr()).toContain('invalid site id');

    enrollSite.mockRejectedValueOnce(named('IdentityAdminNotConfiguredError'));
    await expect(runSyncEnroll('lab-a', { centralUrl: 'u' })).resolves.toBe(1);
    expect(stderr()).toContain('Keycloak admin not configured');
  });

  it('lists sites as an aligned table and JSON', async () => {
    const sites = [
      { siteId: 'lab-a', name: 'Lab A', clientId: 'sync-lab-a', enrolledAt: '2026-07-14T00:00:00.000Z', enrolledBy: null, status: 'active' },
    ];
    listSites.mockResolvedValue(sites);

    await expect(runSyncList({ json: false })).resolves.toBe(0);
    expect(stdout()).toContain('lab-a');
    expect(stdout()).toContain('sync-lab-a');

    out.mockClear();
    await expect(runSyncList({ json: true })).resolves.toBe(0);
    expect(stdout()).toBe(JSON.stringify(sites, null, 2) + '\n');
  });

  it('prints "no sites enrolled" when empty', async () => {
    listSites.mockResolvedValueOnce([]);
    await expect(runSyncList({ json: false })).resolves.toBe(0);
    expect(stdout()).toContain('no sites enrolled');
  });

  it('rotates a secret once and maps SiteNotFoundError to exit 1', async () => {
    rotateSite.mockResolvedValueOnce({ clientId: 'sync-lab-a', clientSecret: 'new-sekret' });
    await expect(runSyncRotate('lab-a', { json: false })).resolves.toBe(0);
    expect((stdout().match(/new-sekret/g) ?? []).length).toBe(1);
    expect(stdout()).toContain('will not be shown again');

    err.mockClear();
    rotateSite.mockRejectedValueOnce(named('SiteNotFoundError'));
    await expect(runSyncRotate('nope', { json: false })).resolves.toBe(1);
    expect(stderr()).toContain('site not found');
  });

  it('revokes idempotently, in text and JSON', async () => {
    revokeSite.mockResolvedValue(undefined);
    await expect(runSyncRevoke('lab-a', { json: false })).resolves.toBe(0);
    expect(stdout()).toContain('revoked lab-a');

    out.mockClear();
    await expect(runSyncRevoke('lab-a', { json: true })).resolves.toBe(0);
    expect(stdout()).toBe(JSON.stringify({ revoked: true, siteId: 'lab-a' }, null, 2) + '\n');
  });
});
