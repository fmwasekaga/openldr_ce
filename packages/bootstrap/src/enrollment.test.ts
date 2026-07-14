import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { createSyncSiteStore, type SyncSiteStore } from '@openldr/db';
import type { AppContext } from './index';
import {
  enrollSite,
  listSites,
  rotateSite,
  revokeSite,
  AlreadyEnrolledError,
  SiteNotFoundError,
  InvalidSiteIdError,
  MissingCentralUrlError,
} from './enrollment';

// Fake Keycloak clients port that records calls and returns canned values. Individual tests tweak
// the vi.fn return values (e.g. findUuidByClientId → a uuid to simulate an existing client).
function makeClients() {
  return {
    findUuidByClientId: vi.fn(async (_clientId: string): Promise<string | null> => null),
    createConfidentialClient: vi.fn(async (_clientId: string): Promise<string> => 'uuid-new'),
    addSiteIdMapper: vi.fn(async () => {}),
    addAudienceMapper: vi.fn(async () => {}),
    getClientSecret: vi.fn(async () => 'secret-created'),
    regenerateClientSecret: vi.fn(async () => 'secret-rotated'),
    deleteClient: vi.fn(async () => {}),
  };
}

const ISSUER = 'https://kc.example/realms/openldr';

function makeCtx(
  clients: ReturnType<typeof makeClients>,
  syncSites: SyncSiteStore,
  cfg: { OIDC_ISSUER_URL: string; OIDC_AUDIENCE?: string } = { OIDC_ISSUER_URL: ISSUER },
): AppContext {
  return { auth: { clients }, syncSites, cfg } as unknown as AppContext;
}

describe('enrollment orchestrator', () => {
  let store: SyncSiteStore;
  let clients: ReturnType<typeof makeClients>;

  beforeEach(async () => {
    const db = await makeMigratedDb();
    store = createSyncSiteStore(db);
    clients = makeClients();
  });

  it('enroll happy path: creates client + site_id mapper, inserts row, returns echoed secret/issuer/url', async () => {
    const ctx = makeCtx(clients, store);
    const res = await enrollSite(ctx, { siteId: 'lab-a', name: 'Lab A', centralUrl: 'https://central', actor: 'admin' });

    // Keycloak side: fresh client + site_id mapper; NO audience mapper (cfg has none).
    expect(clients.createConfidentialClient).toHaveBeenCalledWith('sync-lab-a');
    expect(clients.addSiteIdMapper).toHaveBeenCalledWith('uuid-new', 'lab-a');
    expect(clients.addAudienceMapper).not.toHaveBeenCalled();
    expect(clients.getClientSecret).toHaveBeenCalledWith('uuid-new');

    // Result echoes secret + centralUrl + oidcIssuer.
    expect(res).toEqual({
      clientId: 'sync-lab-a',
      clientSecret: 'secret-created',
      siteId: 'lab-a',
      centralUrl: 'https://central',
      oidcIssuer: ISSUER,
    });

    // Registry row exists and carries NO secret field.
    const row = await store.get('lab-a');
    expect(row).toBeDefined();
    expect(row!.clientId).toBe('sync-lab-a');
    expect(row!.status).toBe('active');
    expect(row!.enrolledBy).toBe('admin');
    expect(Object.keys(row!)).not.toContain('secret');
    expect(Object.keys(row!)).not.toContain('clientSecret');
  });

  it('audience mapper added ONLY when OIDC_AUDIENCE is set', async () => {
    // With audience configured.
    const ctxWith = makeCtx(clients, store, { OIDC_ISSUER_URL: ISSUER, OIDC_AUDIENCE: 'openldr-api' });
    await enrollSite(ctxWith, { siteId: 'lab-aud', name: null, centralUrl: 'https://central', actor: null });
    expect(clients.addAudienceMapper).toHaveBeenCalledWith('uuid-new', 'openldr-api');

    // Without audience (fresh state).
    const db2 = await makeMigratedDb();
    const store2 = createSyncSiteStore(db2);
    const clients2 = makeClients();
    const ctxWithout = makeCtx(clients2, store2, { OIDC_ISSUER_URL: ISSUER });
    await enrollSite(ctxWithout, { siteId: 'lab-noaud', name: null, centralUrl: 'https://central', actor: null });
    expect(clients2.addAudienceMapper).not.toHaveBeenCalled();
  });

  it('mapper failure after client create → deletes the just-created client, inserts no row, rethrows', async () => {
    const boom = new Error('mapper 500');
    clients.addSiteIdMapper.mockRejectedValueOnce(boom);
    const ctx = makeCtx(clients, store);

    await expect(
      enrollSite(ctx, { siteId: 'lab-orphan', name: null, centralUrl: 'https://central', actor: null }),
    ).rejects.toBe(boom);

    // The half-configured client was cleaned up so a later enroll can't adopt a mapper-less client.
    expect(clients.deleteClient).toHaveBeenCalledWith('uuid-new');
    // No registry row was inserted for the failed enroll.
    expect(await store.get('lab-orphan')).toBeUndefined();
  });

  it('trims centralUrl and echoes the trimmed value', async () => {
    const ctx = makeCtx(clients, store);
    const res = await enrollSite(ctx, { siteId: 'lab-trim', name: null, centralUrl: '  https://central  ', actor: null });
    expect(res.centralUrl).toBe('https://central');
  });

  it('enroll twice (active) → AlreadyEnrolledError', async () => {
    const ctx = makeCtx(clients, store);
    await enrollSite(ctx, { siteId: 'lab-b', name: null, centralUrl: 'https://central', actor: null });
    await expect(
      enrollSite(ctx, { siteId: 'lab-b', name: null, centralUrl: 'https://central', actor: null }),
    ).rejects.toBeInstanceOf(AlreadyEnrolledError);
  });

  it.each(['Bad_Site', '-x', '', 'a'.repeat(100)])('enroll bad slug %j → InvalidSiteIdError', async (siteId) => {
    const ctx = makeCtx(clients, store);
    await expect(
      enrollSite(ctx, { siteId, name: null, centralUrl: 'https://central', actor: null }),
    ).rejects.toBeInstanceOf(InvalidSiteIdError);
    // Nothing was minted for an invalid slug.
    expect(clients.createConfidentialClient).not.toHaveBeenCalled();
  });

  it('enroll empty centralUrl → MissingCentralUrlError', async () => {
    const ctx = makeCtx(clients, store);
    await expect(
      enrollSite(ctx, { siteId: 'lab-c', name: null, centralUrl: '   ', actor: null }),
    ).rejects.toBeInstanceOf(MissingCentralUrlError);
  });

  it('revoke → calls deleteClient + status becomes revoked', async () => {
    const ctx = makeCtx(clients, store);
    await enrollSite(ctx, { siteId: 'lab-d', name: null, centralUrl: 'https://central', actor: null });
    clients.findUuidByClientId.mockResolvedValue('uuid-existing');

    await revokeSite(ctx, 'lab-d');
    expect(clients.deleteClient).toHaveBeenCalledWith('uuid-existing');
    expect((await store.get('lab-d'))!.status).toBe('revoked');
  });

  it('re-enroll after revoke → status back to active, new secret, reuses uuid, no mapper re-add', async () => {
    // Seed a revoked row directly.
    await store.insert({ siteId: 'lab-e', name: 'Lab E', clientId: 'sync-lab-e', enrolledBy: 'admin' });
    await store.setStatus('lab-e', 'revoked');

    // Client still exists in Keycloak (was not deleted): findUuid returns it, secret is the new one.
    clients.findUuidByClientId.mockResolvedValue('uuid-existing');
    clients.getClientSecret.mockResolvedValue('secret-reenroll');
    const ctx = makeCtx(clients, store);

    const res = await enrollSite(ctx, { siteId: 'lab-e', name: 'Lab E', centralUrl: 'https://central', actor: 'admin' });

    expect(res.clientSecret).toBe('secret-reenroll');
    // Reused the existing client — did NOT create or re-map (avoids duplicate-mapper 409s).
    expect(clients.createConfidentialClient).not.toHaveBeenCalled();
    expect(clients.addSiteIdMapper).not.toHaveBeenCalled();
    expect(clients.addAudienceMapper).not.toHaveBeenCalled();

    // Row flipped back to active, not duplicated.
    const list = await listSites(ctx);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('active');
  });

  it('rotate → returns a new secret, no registry row change', async () => {
    const ctx = makeCtx(clients, store);
    await enrollSite(ctx, { siteId: 'lab-f', name: null, centralUrl: 'https://central', actor: null });
    const before = await store.get('lab-f');

    clients.findUuidByClientId.mockResolvedValue('uuid-existing');
    const res = await rotateSite(ctx, 'lab-f');

    expect(res).toEqual({ clientId: 'sync-lab-f', clientSecret: 'secret-rotated' });
    expect(clients.regenerateClientSecret).toHaveBeenCalledWith('uuid-existing');
    // Registry untouched.
    expect(await store.get('lab-f')).toEqual(before);
  });

  it('rotate unknown site → SiteNotFoundError', async () => {
    const ctx = makeCtx(clients, store);
    clients.findUuidByClientId.mockResolvedValue(null);
    await expect(rotateSite(ctx, 'ghost')).rejects.toBeInstanceOf(SiteNotFoundError);
  });

  it('revoke unknown site → idempotent no-op (no throw, no calls)', async () => {
    const ctx = makeCtx(clients, store);
    clients.findUuidByClientId.mockResolvedValue(null);
    await expect(revokeSite(ctx, 'ghost')).resolves.toBeUndefined();
    expect(clients.deleteClient).not.toHaveBeenCalled();
  });
});
