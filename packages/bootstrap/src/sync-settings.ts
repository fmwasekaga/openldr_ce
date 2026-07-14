import { SyncConfigInputSchema, type SyncConfigView, type SyncMode } from '@openldr/config';
import type { AppSettingStore } from '@openldr/db';

/**
 * Read/write the operator sync configuration. S4 makes the six discrete `sync.*` app_settings keys
 * the single source of truth (the same keys `@openldr/sync`'s readSyncConfig + fhir-store's
 * resolveSiteId read), so enabling sync via the HTTP route (`/api/settings/sync`) or the CLI now
 * actually turns the workers on. Shared by both callers so they run identical validation/persistence.
 *
 * The client secret is WRITE-ONLY and stored ENCRYPTED: getSyncConfig returns a `clientSecretSet`
 * boolean (never the value); setSyncConfig only writes `sync.client_secret` when a non-empty secret
 * is supplied (a blank submit preserves the existing one). The encrypt fn is INJECTED so this module
 * stays free of the SECRETS_ENCRYPTION_KEY / @openldr/core crypto (the route/CLI/bootstrap supply it).
 */
const K = {
  enabled: 'sync.enabled',
  mode: 'sync.mode',
  centralUrl: 'sync.central_url',
  siteId: 'sync.site_id',
  oidcIssuer: 'sync.oidc_issuer',
  clientId: 'sync.client_id',
  clientSecret: 'sync.client_secret',
  interval: 'sync.interval_minutes',
} as const;

export async function getSyncConfig(store: AppSettingStore): Promise<SyncConfigView> {
  const g = async (k: string) => (await store.get(k))?.value ?? '';
  const secret = await g(K.clientSecret);
  const intervalRaw = Number(await g(K.interval));
  const modeRaw = (await g(K.mode)).trim().toLowerCase();
  return {
    enabled: ['true', '1'].includes((await g(K.enabled)).trim().toLowerCase()),
    mode: (modeRaw === 'push' || modeRaw === 'pull' ? modeRaw : 'bidirectional') as SyncMode,
    centralUrl: await g(K.centralUrl),
    siteId: await g(K.siteId),
    oidcIssuer: await g(K.oidcIssuer),
    clientId: await g(K.clientId),
    clientSecretSet: secret.length > 0,
    intervalMinutes: Number.isFinite(intervalRaw) && intervalRaw >= 1 && intervalRaw <= 1440 ? Math.floor(intervalRaw) : 15,
  };
}

/** Validate and persist an operator sync configuration onto the discrete keys; returns the normalized
 *  view (with the secret elided). Throws on invalid input. `encrypt` seals the client secret before it
 *  is stored; it is only invoked when a non-empty `clientSecret` is supplied. */
export async function setSyncConfig(
  store: AppSettingStore,
  input: unknown,
  actor: string | null,
  encrypt: (plain: string) => string,
): Promise<SyncConfigView> {
  const c = SyncConfigInputSchema.parse(input);
  await store.set(K.enabled, String(c.enabled), actor);
  await store.set(K.mode, c.mode, actor);
  await store.set(K.centralUrl, c.centralUrl, actor);
  await store.set(K.siteId, c.siteId, actor);
  await store.set(K.oidcIssuer, c.oidcIssuer, actor);
  await store.set(K.clientId, c.clientId, actor);
  await store.set(K.interval, String(c.intervalMinutes), actor);
  // Write-only: only persist the secret when one is actually supplied so a blank submit / a
  // single-field patch preserves the existing encrypted value.
  if (typeof c.clientSecret === 'string' && c.clientSecret.length > 0) {
    await store.set(K.clientSecret, encrypt(c.clientSecret), actor);
  }
  return getSyncConfig(store);
}
