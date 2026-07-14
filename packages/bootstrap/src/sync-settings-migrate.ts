import { SYNC_CONFIG_KEY, parseSyncConfig } from '@openldr/config';
import type { AppSettingStore } from '@openldr/db';

/**
 * One-time upgrade shim: pre-S4 installs stored sync config as a single JSON blob under
 * `sync.config` that the workers never read. If that blob exists AND the discrete `sync.enabled`
 * key is absent, copy the blob's non-secret fields into the discrete `sync.*` keys once, then
 * tombstone the blob (empty value — the reader treats `''` as absent; AppSettingStore has no delete).
 * Credentials (oidcIssuer/clientId/clientSecret) were never in the blob, so an operator must still
 * supply them. Idempotent: a no-op once the discrete keys exist or no blob is present.
 *
 * @returns true if the migration copied the blob this call; false if it was a no-op.
 */
export async function migrateLegacySyncConfig(
  store: AppSettingStore,
  actor: string | null = 'migration',
): Promise<boolean> {
  const blob = await store.get(SYNC_CONFIG_KEY);
  if (!blob?.value) return false; // no blob (or already tombstoned) → nothing to migrate
  const discrete = await store.get('sync.enabled');
  if (discrete) return false; // discrete keys already own the config → never overwrite

  const cfg = parseSyncConfig(blob.value);
  await store.set('sync.enabled', String(cfg.enabled), actor);
  await store.set('sync.mode', cfg.mode, actor);
  await store.set('sync.central_url', cfg.centralUrl, actor);
  await store.set('sync.site_id', cfg.siteId, actor);
  await store.set('sync.interval_minutes', String(cfg.intervalMinutes), actor);
  await store.set(SYNC_CONFIG_KEY, '', actor); // tombstone the legacy blob
  return true;
}
