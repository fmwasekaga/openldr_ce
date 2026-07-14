// Typed reader for the lab's sync configuration, sourced from the DB `app_settings` store. Task 7's
// bootstrap host loop calls this once at boot to decide whether to start the push worker and, if so,
// with what central URL / OIDC issuer / client credentials / site id.
//
// The client secret is stored ENCRYPTED at rest (same SECRETS_ENCRYPTION_KEY / AES-256-GCM scheme the
// connector store uses). Rather than pull the crypto helper (and thus @openldr/core) into this package,
// `decrypt` is INJECTED — keeping the reader pure/testable and @openldr/sync dependency-light. Task 7
// supplies the real `open(blob, key)`-backed decrypt.

import type { AppSettingStore } from '@openldr/db';

/** Sync direction. `bidirectional` is the safe default when the key is absent/garbage. */
export type SyncMode = 'push' | 'pull' | 'bidirectional';

/** Fully-resolved, ready-to-use lab sync configuration. `clientSecret` is decrypted in memory. */
export interface SyncConfig {
  enabled: boolean;
  centralUrl: string;
  oidcIssuer: string;
  clientId: string;
  clientSecret: string; // decrypted in memory
  siteId: string;
  mode: SyncMode;
  intervalMinutes: number;
}

/** Minimal logger surface so an enabled-but-incomplete config can be surfaced clearly at boot. */
export interface SyncConfigLogger {
  warn(message: string): void;
}

// app_settings keys. `sync.site_id` MUST match the key fhir-store.ts's resolveSiteId already reads so
// the config reader and the write path agree on the lab's enrollment id.
const KEY_ENABLED = 'sync.enabled';
const KEY_CENTRAL_URL = 'sync.central_url';
const KEY_OIDC_ISSUER = 'sync.oidc_issuer';
const KEY_CLIENT_ID = 'sync.client_id';
const KEY_CLIENT_SECRET = 'sync.client_secret'; // stored encrypted
const KEY_SITE_ID = 'sync.site_id';
const KEY_MODE = 'sync.mode';
const KEY_INTERVAL = 'sync.interval_minutes';

/** Boolean-flag parse convention (mirrors @openldr/config's parseFlagValue), extended to be
 *  case-insensitive so 'TRUE'/'True' also enable. Absent/anything-else = disabled. */
function isTruthy(value: string | null | undefined): boolean {
  if (value == null) return false;
  const v = value.trim().toLowerCase();
  return v === 'true' || v === '1';
}

async function readValue(appSettings: AppSettingStore, key: string): Promise<string> {
  const rec = await appSettings.get(key);
  return rec?.value?.trim() ?? '';
}

/**
 * Reads the `sync.*` keys from `app_settings` and returns a ready-to-use {@link SyncConfig}, or
 * `null` when sync should not run. `null` means one of:
 *   - `sync.enabled` is absent/false → sync is off (normal; no warning),
 *   - enabled but a required field is missing/empty → misconfigured (warns via `logger`),
 *   - enabled but the client secret fails to decrypt → misconfigured (warns via `logger`).
 *
 * A caller can treat `null` as "do not start the push worker". `decrypt` may be sync or async.
 */
export async function readSyncConfig(
  appSettings: AppSettingStore,
  decrypt: (ciphertext: string) => string | Promise<string>,
  logger?: SyncConfigLogger,
): Promise<SyncConfig | null> {
  const enabledRaw = await readValue(appSettings, KEY_ENABLED);
  if (!isTruthy(enabledRaw)) return null; // sync off — the common path, deliberately silent.

  const centralUrl = await readValue(appSettings, KEY_CENTRAL_URL);
  const oidcIssuer = await readValue(appSettings, KEY_OIDC_ISSUER);
  const clientId = await readValue(appSettings, KEY_CLIENT_ID);
  const clientSecretCipher = await readValue(appSettings, KEY_CLIENT_SECRET);
  const siteId = await readValue(appSettings, KEY_SITE_ID);

  // Enabled ⇒ every field below is required. Collect ALL missing keys so the operator sees the full
  // list in one message rather than fixing them one boot at a time.
  const missing: string[] = [];
  if (!centralUrl) missing.push(KEY_CENTRAL_URL);
  if (!oidcIssuer) missing.push(KEY_OIDC_ISSUER);
  if (!clientId) missing.push(KEY_CLIENT_ID);
  if (!clientSecretCipher) missing.push(KEY_CLIENT_SECRET);
  if (!siteId) missing.push(KEY_SITE_ID);
  if (missing.length > 0) {
    logger?.warn(`sync enabled but misconfigured: missing ${missing.join(', ')}`);
    return null;
  }

  let clientSecret: string;
  try {
    clientSecret = await decrypt(clientSecretCipher);
  } catch {
    // Never echo the ciphertext or the underlying crypto error — just flag which key failed.
    logger?.warn(`sync enabled but misconfigured: could not decrypt ${KEY_CLIENT_SECRET}`);
    return null;
  }
  if (!clientSecret) {
    logger?.warn(`sync enabled but misconfigured: ${KEY_CLIENT_SECRET} decrypted to an empty value`);
    return null;
  }

  // Optional tuning keys — only meaningful once we know the config is valid. Absent/garbage → safe
  // defaults (bidirectional, every 15 min). Interval is clamped to [1, 1440] minutes and floored.
  const modeRaw = (await readValue(appSettings, KEY_MODE)).trim().toLowerCase();
  const mode: SyncMode = modeRaw === 'push' || modeRaw === 'pull' ? modeRaw : 'bidirectional';
  const intervalRaw = Number(await readValue(appSettings, KEY_INTERVAL));
  const intervalMinutes =
    Number.isFinite(intervalRaw) && intervalRaw >= 1 && intervalRaw <= 1440 ? Math.floor(intervalRaw) : 15;

  return { enabled: true, centralUrl, oidcIssuer, clientId, clientSecret, siteId, mode, intervalMinutes };
}
