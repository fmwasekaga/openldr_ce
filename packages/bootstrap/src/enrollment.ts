import type { SyncSiteRow } from '@openldr/db';
import { generatePublisherKeypair } from '@openldr/marketplace';
// `import type` (not a value import): index.ts re-exports this module, so a runtime import of
// AppContext from './index' would create a require cycle. A type-only import is erased at compile
// time and carries no runtime edge.
import type { AppContext } from './index';

// Sync S4d enrollment orchestrator — the shared brain behind `openldr sync enroll|list|rotate|revoke`
// (CLI, Task 5) and the central HTTP settings endpoints (Task 6). Composes the Task 2 Keycloak
// primitives (ctx.auth.clients) with the Task 3 registry (ctx.syncSites). NEVER persists the client
// secret: it is returned once at enroll/rotate time and lives only in the caller's response.
//
// IdentityAdminNotConfiguredError (thrown by ctx.auth.clients.* when Keycloak admin creds are
// absent) is intentionally NOT caught here — it propagates so callers can map it to 503 / an exit
// code.

/** A site whose registry row is already `active` cannot be re-enrolled (rotate to get a new secret). */
export class AlreadyEnrolledError extends Error {
  constructor(public siteId: string) {
    super(`site already enrolled: ${siteId}`);
    this.name = 'AlreadyEnrolledError';
  }
}

/** No Keycloak client exists for the site (rotate/revoke of a never-enrolled site). */
export class SiteNotFoundError extends Error {
  constructor(public siteId: string) {
    super(`site not found: ${siteId}`);
    this.name = 'SiteNotFoundError';
  }
}

/** The requested site id fails {@link SITE_ID_RE} (used as-is in a Keycloak clientId + a table key). */
export class InvalidSiteIdError extends Error {
  constructor(public siteId: string) {
    super(`invalid site id: ${siteId}`);
    this.name = 'InvalidSiteIdError';
  }
}

/** enrollSite requires an explicit central public base URL — there is no config key to derive it. */
export class MissingCentralUrlError extends Error {
  constructor() {
    super('centralUrl is required');
    this.name = 'MissingCentralUrlError';
  }
}

export interface EnrollResult {
  clientId: string;
  clientSecret: string;
  siteId: string;
  centralUrl: string;
  oidcIssuer: string;
  // Sync S5: the site's ed25519 PRIVATE signing key (SPKI/PKCS8 DER, hex), handed to the lab ONCE
  // at enroll time (same one-time-secret model as clientSecret) — never persisted centrally.
  signingPrivateKey: string;
  // Sync S5: central's PUBLIC signing key (DER hex) — the lab verifies central's pull bundles with it.
  centralPublicKey: string;
}

// Sync S5: the single central signing keypair, stored in app_settings. The private key is encrypted
// at rest (AES under SECRETS_ENCRYPTION_KEY); the public key is plaintext hex. Neither key is a
// reference-captured `sync.*` value (S2 excludes the sync.* namespace from capture).
const CENTRAL_PRIV = 'sync.central_signing_private_key'; // encrypted at rest
const CENTRAL_PUB = 'sync.central_signing_public_key'; // plaintext hex

/** Idempotently ensure the single central signing keypair exists; return both keys as DER hex.
 *  Created once, reused thereafter. */
export async function ensureCentralKeypair(ctx: AppContext): Promise<{ privHex: string; pubHex: string }> {
  const pub = (await ctx.appSettings.get(CENTRAL_PUB))?.value ?? '';
  const priv = (await ctx.appSettings.get(CENTRAL_PRIV))?.value ?? '';
  if (pub && priv) return { privHex: ctx.decryptSecret(priv), pubHex: pub };
  const kp = generatePublisherKeypair();
  const privHex = Buffer.from(kp.privateKeyDer).toString('hex');
  const pubHex = Buffer.from(kp.publicKeyDer).toString('hex');
  await ctx.appSettings.set(CENTRAL_PUB, pubHex, 'enroll');
  await ctx.appSettings.set(CENTRAL_PRIV, ctx.encryptSecret(privHex), 'enroll');
  return { privHex, pubHex };
}

/** Mint a fresh ed25519 site signing keypair as DER hex (public + private). */
function mintSiteKeypair(): { signingPublicKey: string; signingPrivateKey: string } {
  const kp = generatePublisherKeypair();
  return {
    signingPublicKey: Buffer.from(kp.publicKeyDer).toString('hex'),
    signingPrivateKey: Buffer.from(kp.privateKeyDer).toString('hex'),
  };
}

// lowercase alnum, may contain hyphens (not leading), 1..63 chars. Reused verbatim as the Keycloak
// clientId suffix and the sync_sites primary key.
const SITE_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The Keycloak clientId minted for a site — the single source of the `sync-<siteId>` convention. */
const syncClientId = (siteId: string): string => `sync-${siteId}`;

/** Central mints a confidential Keycloak client + registry row for a lab. Idempotent-ish: an
 *  already-active site throws; re-enrolling a previously-revoked site flips it back to active and
 *  returns a secret, reusing the existing client (mappers are NOT re-added — see below). */
export async function enrollSite(
  ctx: AppContext,
  args: { siteId: string; name?: string | null; centralUrl: string; actor: string | null },
): Promise<EnrollResult> {
  const { siteId } = args;
  if (!SITE_ID_RE.test(siteId)) throw new InvalidSiteIdError(siteId);
  const centralUrl = (args.centralUrl ?? '').trim();
  if (!centralUrl) throw new MissingCentralUrlError();

  const existing = await ctx.syncSites.get(siteId);
  if (existing && existing.status === 'active') throw new AlreadyEnrolledError(siteId);

  const clientId = syncClientId(siteId);
  let uuid = await ctx.auth.clients.findUuidByClientId(clientId);
  if (uuid === null) {
    // Fresh client — add the site_id mapper (+ audience mapper when configured) exactly once. On a
    // revoked-site re-enroll whose client was never deleted, `uuid` is non-null and we skip mapper
    // creation to avoid duplicate-mapper 409s from Keycloak.
    //
    // Atomic-ish: if mapper creation throws AFTER the client was created, the client would persist
    // WITHOUT its site_id mapper — a later re-enroll would find the uuid, skip mapper creation, and
    // adopt a mapper-less client whose tokens carry no site claim (silently breaking sync auth). So
    // best-effort delete the just-created client before rethrowing, leaving no half-configured
    // orphan for a later enroll to adopt.
    const createdUuid = await ctx.auth.clients.createConfidentialClient(clientId);
    try {
      await ctx.auth.clients.addSiteIdMapper(createdUuid, siteId);
      if (ctx.cfg.OIDC_AUDIENCE) await ctx.auth.clients.addAudienceMapper(createdUuid, ctx.cfg.OIDC_AUDIENCE);
    } catch (err) {
      await ctx.auth.clients.deleteClient(createdUuid).catch(() => undefined); // best-effort cleanup
      throw err;
    }
    uuid = createdUuid;
  }

  const clientSecret = await ctx.auth.clients.getClientSecret(uuid);

  if (existing) {
    // Re-enroll of a revoked row: flip status back to active (never re-insert — primary key clash).
    await ctx.syncSites.setStatus(siteId, 'active');
  } else {
    await ctx.syncSites.insert({ siteId, name: args.name ?? null, clientId, enrolledBy: args.actor });
  }

  // Sync S5 key exchange: hand the lab its own private signing key + central's public key ONCE.
  // Central persists ONLY the site's public key (to verify the lab's push bundles); the site's
  // private key is returned and never stored here. A fresh site keypair is minted on every enroll
  // (including revoked-re-enroll) so a re-enrolled lab always gets working, current material.
  const { pubHex: centralPublicKey } = await ensureCentralKeypair(ctx);
  const { signingPublicKey, signingPrivateKey } = mintSiteKeypair();
  await ctx.syncSites.setSigningPublicKey(siteId, signingPublicKey); // ONLY the public key persisted

  return {
    clientId,
    clientSecret,
    siteId,
    centralUrl,
    oidcIssuer: ctx.cfg.OIDC_ISSUER_URL,
    signingPrivateKey,
    centralPublicKey,
  };
}

/** All enrolled sites, newest first. Never includes secrets (the registry never stores them). */
export async function listSites(ctx: AppContext): Promise<SyncSiteRow[]> {
  return ctx.syncSites.list();
}

/** Regenerate the client secret AND re-mint the site signing keypair for an enrolled site. Persists
 *  only the new public key; returns the new client secret + the new site private key + central's
 *  public key (same one-time-secret model as enroll). Throws if no client. */
export async function rotateSite(
  ctx: AppContext,
  siteId: string,
): Promise<{ clientId: string; clientSecret: string; signingPrivateKey: string; centralPublicKey: string }> {
  const clientId = syncClientId(siteId);
  const uuid = await ctx.auth.clients.findUuidByClientId(clientId);
  if (uuid === null) throw new SiteNotFoundError(siteId);
  const clientSecret = await ctx.auth.clients.regenerateClientSecret(uuid);

  // Re-mint the SITE keypair (central pub is stable — created once by ensureCentralKeypair).
  const { pubHex: centralPublicKey } = await ensureCentralKeypair(ctx);
  const { signingPublicKey, signingPrivateKey } = mintSiteKeypair();
  await ctx.syncSites.setSigningPublicKey(siteId, signingPublicKey); // ONLY the public key persisted

  return { clientId, clientSecret, signingPrivateKey, centralPublicKey };
}

/** Revoke a site: delete its Keycloak client (if present) and mark the registry row revoked (if
 *  present). Idempotent — revoking an unknown site (no client, no row) is a silent no-op, never a
 *  throw, so operators can safely re-run it. */
export async function revokeSite(ctx: AppContext, siteId: string): Promise<void> {
  const uuid = await ctx.auth.clients.findUuidByClientId(syncClientId(siteId));
  if (uuid !== null) await ctx.auth.clients.deleteClient(uuid);
  if (await ctx.syncSites.get(siteId)) await ctx.syncSites.setStatus(siteId, 'revoked');
}
