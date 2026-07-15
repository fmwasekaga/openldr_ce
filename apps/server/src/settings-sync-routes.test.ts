import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerSettingsRoutes } from './settings-routes';
import './auth-plugin';

// ---------------------------------------------------------------------------
// Minimal types mirrored so we don't add a dep
// ---------------------------------------------------------------------------
interface SyncSiteRow {
  siteId: string;
  name: string | null;
  clientId: string;
  enrolledAt: string;
  enrolledBy: string | null;
  status: 'active' | 'revoked';
}

// ---------------------------------------------------------------------------
// fakeCtx — sync_sites registry (in-memory) + auth.clients (canned) + cfg + audit
// Only the pieces the /api/settings/sync/* enrollment routes touch are populated;
// the other settings routes (flags/numbers/danger) are registered but never hit.
// ---------------------------------------------------------------------------
function fakeCtx() {
  const sites = new Map<string, SyncSiteRow>();
  const clients = new Map<string, string>(); // clientId -> uuid
  const signingKeys = new Map<string, string>(); // siteId -> public signing key
  const settings = new Map<string, string>(); // app_settings (incl. central signing keypair — S5)
  let uuidSeq = 0;
  let secretSeq = 0;
  const auditEvents: unknown[] = [];
  let clientsUnconfigured = false;

  const notConfigured = () => {
    const e = new Error('admin not configured');
    e.name = 'IdentityAdminNotConfiguredError';
    return e;
  };
  const guard = () => { if (clientsUnconfigured) throw notConfigured(); };

  return {
    cfg: { OIDC_ISSUER_URL: 'https://kc.example/realms/openldr', OIDC_AUDIENCE: null },

    syncSites: {
      async list() {
        return [...sites.values()].sort((a, b) => (a.enrolledAt < b.enrolledAt ? 1 : -1));
      },
      async get(siteId: string) {
        return sites.get(siteId) ?? undefined;
      },
      async insert(row: { siteId: string; name: string | null; clientId: string; enrolledBy: string | null }) {
        sites.set(row.siteId, {
          siteId: row.siteId,
          name: row.name,
          clientId: row.clientId,
          enrolledAt: new Date(Date.now() + sites.size).toISOString(),
          enrolledBy: row.enrolledBy,
          status: 'active',
        });
      },
      async setStatus(siteId: string, status: 'active' | 'revoked') {
        const r = sites.get(siteId);
        if (r) r.status = status;
      },
      // Sync S5 key exchange: central persists ONLY the site's public signing key.
      async setSigningPublicKey(siteId: string, publicKey: string) {
        signingKeys.set(siteId, publicKey);
      },
      async getReportedPullCursor() { return 0; },
      async setReportedPullCursor() {},
    },

    // Sync S5: in-memory app_settings backing ensureCentralKeypair (get→{value}|undefined, set(k,v,actor)).
    appSettings: {
      async get(key: string) {
        return settings.has(key) ? { value: settings.get(key)! } : undefined;
      },
      async set(key: string, value: string) {
        settings.set(key, value);
      },
    },
    // Identity encrypt/decrypt — sufficient for the round-trip ensureCentralKeypair performs.
    encryptSecret: (s: string) => s,
    decryptSecret: (s: string) => s,

    auth: {
      verifyToken: async () => ({ sub: 's' }),
      clients: {
        async findUuidByClientId(clientId: string) { guard(); return clients.get(clientId) ?? null; },
        async createConfidentialClient(clientId: string) { guard(); const uuid = `uuid-${++uuidSeq}`; clients.set(clientId, uuid); return uuid; },
        async addSiteIdMapper() { guard(); },
        async addAudienceMapper() { guard(); },
        async getClientSecret() { guard(); return `secret-${++secretSeq}`; },
        async regenerateClientSecret() { guard(); return `secret-${++secretSeq}`; },
        async deleteClient(uuid: string) { guard(); for (const [k, v] of clients) if (v === uuid) clients.delete(k); },
      },
    },

    // Sync S6a: the central amend endpoint delegates the transactional version-bump to fhirStore.amend.
    // Default returns a canned AmendResult; individual tests override the mock (mockResolvedValue /
    // mockRejectedValue) to exercise the 200/404/409 paths.
    fhirStore: {
      amend: vi.fn(async () => ({ version: 2, provenanceId: 'prov-1', siteId: 'lab-a' })),
    },

    audit: { record: async (e: unknown) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },

    __auditEvents: auditEvents,
    __sites: sites,
    __setClientsUnconfigured: (v: boolean) => { clientsUnconfigured = v; },
  } as unknown as AppContext & {
    __auditEvents: unknown[];
    __sites: Map<string, SyncSiteRow>;
    __setClientsUnconfigured: (v: boolean) => void;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function adminApp(ctx: AppContext) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'admin', username: 'admin', displayName: null, roles: ['lab_admin'] };
  });
  registerSettingsRoutes(app, ctx);
  return app;
}

// ---------------------------------------------------------------------------
// Enrollment endpoints
// ---------------------------------------------------------------------------
describe('settings sync enrollment routes', () => {
  it('POST /enroll → 200 with clientSecret; audit recorded WITHOUT the secret', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);

    const res = await app.inject({
      method: 'POST', url: '/api/settings/sync/enroll',
      payload: { siteId: 'lab-a', name: 'Lab A', centralUrl: 'https://central.example' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.clientId).toBe('sync-lab-a');
    expect(typeof body.clientSecret).toBe('string');
    expect((body.clientSecret as string).length).toBeGreaterThan(0);
    expect(body.siteId).toBe('lab-a');
    expect(body.centralUrl).toBe('https://central.example');
    expect(body.oidcIssuer).toBe('https://kc.example/realms/openldr');
    // Sync S5 key exchange: enroll hands back the site's private signing key + central's public key.
    expect(typeof body.signingPrivateKey).toBe('string');
    expect((body.signingPrivateKey as string).length).toBeGreaterThan(0);
    expect(typeof body.centralPublicKey).toBe('string');
    expect((body.centralPublicKey as string).length).toBeGreaterThan(0);

    // Registry row exists
    const sites = (ctx as unknown as { __sites: Map<string, SyncSiteRow> }).__sites;
    expect(sites.get('lab-a')?.status).toBe('active');

    // Audit: action present, clientId in metadata, secret NEVER logged
    const events = (ctx as unknown as { __auditEvents: unknown[] }).__auditEvents;
    const enrollEvent = events.find((e) => (e as { action: string }).action === 'settings.sync.enroll') as
      | { entityId: string; metadata: { clientId: string } }
      | undefined;
    expect(enrollEvent).toBeTruthy();
    expect(enrollEvent!.entityId).toBe('lab-a');
    expect(enrollEvent!.metadata.clientId).toBe('sync-lab-a');
    expect(JSON.stringify(events)).not.toContain(body.clientSecret as string);
  });

  it('POST /enroll → 400 when siteId missing', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/settings/sync/enroll',
      payload: { centralUrl: 'https://central.example' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/siteId/);
  });

  it('POST /enroll → 400 when centralUrl missing', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/settings/sync/enroll',
      payload: { siteId: 'lab-a' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/centralUrl/);
  });

  it('POST /enroll → 409 when the site is already enrolled (active)', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);
    const payload = { siteId: 'lab-a', centralUrl: 'https://central.example' };
    expect((await app.inject({ method: 'POST', url: '/api/settings/sync/enroll', payload })).statusCode).toBe(200);
    const res = await app.inject({ method: 'POST', url: '/api/settings/sync/enroll', payload });
    expect(res.statusCode).toBe(409);
  });

  it('POST /enroll → 400 on an invalid site id', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/settings/sync/enroll',
      payload: { siteId: 'Lab A!', centralUrl: 'https://central.example' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /enroll → 503 when ctx.auth.clients is not configured', async () => {
    const ctx = fakeCtx();
    (ctx as unknown as { __setClientsUnconfigured: (v: boolean) => void }).__setClientsUnconfigured(true);
    const app = adminApp(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/settings/sync/enroll',
      payload: { siteId: 'lab-a', centralUrl: 'https://central.example' },
    });
    expect(res.statusCode).toBe(503);
  });

  it('GET /sites → 200 array with NO secret key on any row', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);
    await app.inject({ method: 'POST', url: '/api/settings/sync/enroll', payload: { siteId: 'lab-a', centralUrl: 'https://c.example' } });
    await app.inject({ method: 'POST', url: '/api/settings/sync/enroll', payload: { siteId: 'lab-b', centralUrl: 'https://c.example' } });

    const res = await app.inject({ method: 'GET', url: '/api/settings/sync/sites' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    for (const row of body) {
      expect(row).not.toHaveProperty('secret');
      expect(row).not.toHaveProperty('clientSecret');
      expect(Object.keys(row).some((k) => /secret/i.test(k))).toBe(false);
    }
  });

  it('POST /sites/:siteId/rotate → 200 with a new clientSecret; audit recorded WITHOUT the secret', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);
    await app.inject({ method: 'POST', url: '/api/settings/sync/enroll', payload: { siteId: 'lab-a', centralUrl: 'https://c.example' } });

    const res = await app.inject({ method: 'POST', url: '/api/settings/sync/sites/lab-a/rotate' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.clientId).toBe('sync-lab-a');
    expect(typeof body.clientSecret).toBe('string');
    // Sync S5: rotate re-mints the site keypair and returns the new material.
    expect(typeof body.signingPrivateKey).toBe('string');
    expect((body.signingPrivateKey as string).length).toBeGreaterThan(0);
    expect(typeof body.centralPublicKey).toBe('string');

    const events = (ctx as unknown as { __auditEvents: unknown[] }).__auditEvents;
    expect(events.some((e) => (e as { action: string }).action === 'settings.sync.rotate')).toBe(true);
    expect(JSON.stringify(events)).not.toContain(body.clientSecret as string);
  });

  it('POST /sites/:siteId/rotate → 404 for an unknown site', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/settings/sync/sites/nope/rotate' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /sites/:siteId/rotate → 503 when ctx.auth.clients is not configured', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);
    await app.inject({ method: 'POST', url: '/api/settings/sync/enroll', payload: { siteId: 'lab-a', centralUrl: 'https://c.example' } });
    (ctx as unknown as { __setClientsUnconfigured: (v: boolean) => void }).__setClientsUnconfigured(true);
    const res = await app.inject({ method: 'POST', url: '/api/settings/sync/sites/lab-a/rotate' });
    expect(res.statusCode).toBe(503);
  });

  it('POST /enroll → 400 on a whitespace-only centralUrl (passes the pre-check, enrollSite trims → MissingCentralUrlError)', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/settings/sync/enroll',
      payload: { siteId: 'lab-a', centralUrl: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /sites/:siteId/revoke → 200 { revoked: true }; row marked revoked; audit recorded', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);
    await app.inject({ method: 'POST', url: '/api/settings/sync/enroll', payload: { siteId: 'lab-a', centralUrl: 'https://c.example' } });

    const res = await app.inject({ method: 'POST', url: '/api/settings/sync/sites/lab-a/revoke' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ revoked: true });

    const sites = (ctx as unknown as { __sites: Map<string, SyncSiteRow> }).__sites;
    expect(sites.get('lab-a')?.status).toBe('revoked');

    const events = (ctx as unknown as { __auditEvents: unknown[] }).__auditEvents;
    expect(events.some((e) => (e as { action: string }).action === 'settings.sync.revoke')).toBe(true);
  });

  it('POST /sites/:siteId/revoke → 200 { revoked: true } for an unknown site (idempotent no-op)', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);
    const res = await app.inject({ method: 'POST', url: '/api/settings/sync/sites/never-enrolled/revoke' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ revoked: true });
  });

  it('rejects unauthenticated (no actor) → 401', async () => {
    const ctx = fakeCtx();
    const app = Fastify();
    registerSettingsRoutes(app, ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/settings/sync/enroll',
      payload: { siteId: 'lab-a', centralUrl: 'https://c.example' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('non-admin actor → 403', async () => {
    const ctx = fakeCtx();
    const app = Fastify();
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'tech', username: 'tech', displayName: null, roles: ['lab_technician'] };
    });
    registerSettingsRoutes(app, ctx);

    expect((await app.inject({ method: 'POST', url: '/api/settings/sync/enroll', payload: { siteId: 'lab-a', centralUrl: 'https://c.example' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/settings/sync/sites' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/settings/sync/sites/lab-a/rotate' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/settings/sync/sites/lab-a/revoke' })).statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Sync S6a: central amend endpoint (POST /api/settings/sync/amend)
// ---------------------------------------------------------------------------
describe('settings sync amend route', () => {
  function amendMock(ctx: AppContext) {
    return (ctx as unknown as { fhirStore: { amend: ReturnType<typeof vi.fn> } }).fhirStore.amend;
  }

  it('POST /amend → 200: delegates to fhirStore.amend and returns {version, provenanceId, siteId}', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);

    const res = await app.inject({
      method: 'POST', url: '/api/settings/sync/amend',
      payload: { resourceType: 'Observation', id: 'obs-1', status: 'amended', reason: 'x' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: 2, provenanceId: 'prov-1', siteId: 'lab-a' });

    const amend = amendMock(ctx);
    expect(amend).toHaveBeenCalledTimes(1);
    expect(amend).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'Observation', id: 'obs-1', status: 'amended', reason: 'x', agent: 'central',
    }));

    // Audit: action + resource reference + new version; PHI/secret-free.
    const events = (ctx as unknown as { __auditEvents: unknown[] }).__auditEvents;
    const ev = events.find((e) => (e as { action: string }).action === 'settings.sync.amend') as
      | { entityType: string; entityId: string; metadata: { version: number; provenanceId: string; siteId: string } }
      | undefined;
    expect(ev).toBeTruthy();
    expect(ev!.entityType).toBe('Observation');
    expect(ev!.entityId).toBe('obs-1');
    expect(ev!.metadata).toEqual({ version: 2, provenanceId: 'prov-1', siteId: 'lab-a' });
  });

  it('POST /amend → 404 when fhirStore.amend throws ResourceNotFoundError', async () => {
    const ctx = fakeCtx();
    amendMock(ctx).mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'ResourceNotFoundError' }));
    const app = adminApp(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/settings/sync/amend',
      payload: { resourceType: 'Observation', id: 'nope', status: 'amended' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /amend → 409 when fhirStore.amend throws NotLabOwnedError', async () => {
    const ctx = fakeCtx();
    amendMock(ctx).mockRejectedValueOnce(Object.assign(new Error('not owned'), { name: 'NotLabOwnedError' }));
    const app = adminApp(ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/settings/sync/amend',
      payload: { resourceType: 'Observation', id: 'local-1', status: 'amended' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('POST /amend → 400 when resourceType/id/status missing (amend NOT called)', async () => {
    const ctx = fakeCtx();
    const app = adminApp(ctx);
    for (const payload of [
      { id: 'obs-1', status: 'amended' },              // no resourceType
      { resourceType: 'Observation', status: 'amended' }, // no id
      { resourceType: 'Observation', id: 'obs-1' },       // no status
      {},
    ]) {
      const res = await app.inject({ method: 'POST', url: '/api/settings/sync/amend', payload });
      expect(res.statusCode).toBe(400);
    }
    expect(amendMock(ctx)).not.toHaveBeenCalled();
  });

  it('rejects non-admin actor → 403', async () => {
    const ctx = fakeCtx();
    const app = Fastify();
    app.addHook('onRequest', async (req) => {
      req.user = { id: 'tech', username: 'tech', displayName: null, roles: ['lab_technician'] };
    });
    registerSettingsRoutes(app, ctx);
    const res = await app.inject({
      method: 'POST', url: '/api/settings/sync/amend',
      payload: { resourceType: 'Observation', id: 'obs-1', status: 'amended' },
    });
    expect(res.statusCode).toBe(403);
    expect(amendMock(ctx)).not.toHaveBeenCalled();
  });
});
