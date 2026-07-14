import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCtx = vi.hoisted(() => ({ close: vi.fn() }));
const enrollSite = vi.hoisted(() => vi.fn());
const listSites = vi.hoisted(() => vi.fn());
const rotateSite = vi.hoisted(() => vi.fn());
const revokeSite = vi.hoisted(() => vi.fn());
const exportPushBundle = vi.hoisted(() => vi.fn());
const importPushBundle = vi.hoisted(() => vi.fn());
const exportPullBundle = vi.hoisted(() => vi.fn());
const importPullBundle = vi.hoisted(() => vi.fn());
const unpackBundle = vi.hoisted(() => vi.fn());
const readFile = vi.hoisted(() => vi.fn(async () => Buffer.from('bundle-bytes')));

vi.mock('node:fs/promises', () => ({ readFile }));

vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({ config: true })) }));

vi.mock('@openldr/sync', () => ({ unpackBundle }));

vi.mock('@openldr/bootstrap', () => ({
  createAppContext: vi.fn(async () => mockCtx),
  enrollSite,
  listSites,
  rotateSite,
  revokeSite,
  exportPushBundle,
  importPushBundle,
  exportPullBundle,
  importPullBundle,
}));

import { runSyncEnroll, runSyncList, runSyncRotate, runSyncRevoke, runSyncExport, runSyncImport } from './sync';

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
      signingPrivateKey: 'deadbeefpriv',
      centralPublicKey: 'cafef00dpub',
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
    // The one-time signing keys the lab needs are surfaced in the text block.
    expect(text).toContain('signingPrivateKey = deadbeefpriv');
    expect(text).toContain('centralPublicKey  = cafef00dpub');
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
    rotateSite.mockResolvedValueOnce({ clientId: 'sync-lab-a', clientSecret: 'new-sekret', signingPrivateKey: 'rotpriv', centralPublicKey: 'rotpub' });
    await expect(runSyncRotate('lab-a', { json: false })).resolves.toBe(0);
    expect((stdout().match(/new-sekret/g) ?? []).length).toBe(1);
    expect(stdout()).toContain('will not be shown again');
    expect(stdout()).toContain('signingPrivateKey = rotpriv');
    expect(stdout()).toContain('centralPublicKey  = rotpub');

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

describe('sync export|import commands', () => {
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

  const pushManifest = {
    formatVersion: 1,
    kind: 'push' as const,
    siteId: 'lab-a',
    fromCursor: 0,
    toCursor: 12,
    recordCount: 12,
    signerKeyId: 'lab-a',
    producedAt: '2026-07-14T00:00:00.000Z',
  };

  it('exports a push bundle by default (no --site) and prints the summary + path', async () => {
    exportPushBundle.mockResolvedValueOnce({ path: '/tmp/sync-push.bundle', manifest: pushManifest });
    await expect(runSyncExport({})).resolves.toBe(0);
    expect(exportPushBundle).toHaveBeenCalledWith(mockCtx, { from: undefined, out: undefined });
    expect(exportPullBundle).not.toHaveBeenCalled();
    const text = stdout();
    expect(text).toContain('kind        = push');
    expect(text).toContain('cursor      = 0 → 12');
    expect(text).toContain('recordCount = 12');
    expect(text).toContain('/tmp/sync-push.bundle');
    // No secret material is ever written by export.
    expect(text).not.toMatch(/clientSecret|signingPrivateKey/);
    expect(mockCtx.close).toHaveBeenCalledTimes(1);
  });

  it('exports a pull bundle when --site is given and forwards siteId', async () => {
    const manifest = { ...pushManifest, kind: 'pull' as const, signerKeyId: 'central' };
    exportPullBundle.mockResolvedValueOnce({ path: '/tmp/sync-pull.bundle', manifest });
    await expect(runSyncExport({ site: 'lab-a', out: '/tmp/sync-pull.bundle' })).resolves.toBe(0);
    expect(exportPullBundle).toHaveBeenCalledWith(mockCtx, { siteId: 'lab-a', out: '/tmp/sync-pull.bundle' });
    expect(stdout()).toContain('kind        = pull');
  });

  it('coerces --from to a number for a push export', async () => {
    exportPushBundle.mockResolvedValueOnce({ path: 'p', manifest: pushManifest });
    await expect(runSyncExport({ from: '7' })).resolves.toBe(0);
    expect(exportPushBundle).toHaveBeenCalledWith(mockCtx, { from: 7, out: undefined });
  });

  it('fails a pull export with no --site (exit 1) and never builds a bundle', async () => {
    await expect(runSyncExport({ kind: 'pull' })).resolves.toBe(1);
    expect(exportPullBundle).not.toHaveBeenCalled();
    expect(stderr()).toContain('--site required for a pull export');
  });

  it('emits the manifest as JSON with --json', async () => {
    exportPushBundle.mockResolvedValueOnce({ path: 'p', manifest: pushManifest });
    await expect(runSyncExport({ json: true })).resolves.toBe(0);
    expect(stdout()).toBe(JSON.stringify(pushManifest, null, 2) + '\n');
  });

  it('imports a push bundle (dispatch on manifest kind) and reports applied + ackSeq', async () => {
    unpackBundle.mockReturnValueOnce({ manifest: { kind: 'push' } });
    importPushBundle.mockResolvedValueOnce({ applied: 9, ackSeq: 12, siteId: 'lab-a' });
    await expect(runSyncImport('/tmp/in.bundle', { json: false })).resolves.toBe(0);
    expect(readFile).toHaveBeenCalledWith('/tmp/in.bundle');
    expect(importPushBundle).toHaveBeenCalledWith(mockCtx, expect.any(Buffer));
    expect(importPullBundle).not.toHaveBeenCalled();
    const text = stdout();
    expect(text).toContain('applied 9');
    expect(text).toContain('ack seq 12');
    expect(mockCtx.close).toHaveBeenCalledTimes(1);
  });

  it('imports a pull bundle and reports applied + toCursor, JSON with --json', async () => {
    unpackBundle.mockReturnValueOnce({ manifest: { kind: 'pull' } });
    importPullBundle.mockResolvedValueOnce({ applied: 3, toCursor: 40 });
    await expect(runSyncImport('/tmp/in.bundle', { json: true })).resolves.toBe(0);
    expect(importPullBundle).toHaveBeenCalledWith(mockCtx, expect.any(Buffer));
    expect(stdout()).toBe(JSON.stringify({ applied: 3, toCursor: 40 }, null, 2) + '\n');
  });

  it('maps BundleSignatureError to exit 1 with a clear message', async () => {
    unpackBundle.mockReturnValueOnce({ manifest: { kind: 'push' } });
    importPushBundle.mockRejectedValueOnce(named('BundleSignatureError'));
    await expect(runSyncImport('/tmp/in.bundle', { json: false })).resolves.toBe(1);
    expect(stderr()).toContain('bundle signature invalid — wrong key or tampered');
    expect(mockCtx.close).toHaveBeenCalledTimes(1);
  });

  it('maps BundleGapError to exit 1 with an import-earlier-first hint', async () => {
    unpackBundle.mockReturnValueOnce({ manifest: { kind: 'pull' } });
    importPullBundle.mockRejectedValueOnce(named('BundleGapError'));
    await expect(runSyncImport('/tmp/in.bundle', { json: false })).resolves.toBe(1);
    expect(stderr()).toContain('bundle is out of order');
  });

  it('maps BundleFormatError (from unpackBundle) and SiteNotFoundError to exit 1', async () => {
    unpackBundle.mockImplementationOnce(() => { throw named('BundleFormatError'); });
    await expect(runSyncImport('/tmp/bad', { json: false })).resolves.toBe(1);
    expect(stderr()).toContain('not a valid bundle file');

    err.mockClear();
    unpackBundle.mockReturnValueOnce({ manifest: { kind: 'push' } });
    importPushBundle.mockRejectedValueOnce(named('SiteNotFoundError'));
    await expect(runSyncImport('/tmp/in.bundle', { json: false })).resolves.toBe(1);
    expect(stderr()).toContain('unknown or revoked site');
  });
});
