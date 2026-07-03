import { SYNC_CONFIG_KEY, SyncConfigSchema, parseSyncConfig, type SyncConfig } from '@openldr/config';
import type { AppSettingStore } from '@openldr/db';

/**
 * Read/write the (scaffolded) lab⇄central sync configuration. Shared by the HTTP route
 * (`/api/settings/sync`) and the CLI (`openldr settings sync …`) so both run identical
 * validation and persistence. Stored as a JSON blob in app_settings (non-secret).
 */
export async function getSyncConfig(store: AppSettingStore): Promise<SyncConfig> {
  const record = await store.get(SYNC_CONFIG_KEY);
  return parseSyncConfig(record?.value ?? null);
}

/** Validate and persist a sync configuration; returns the normalized value. Throws on invalid input. */
export async function setSyncConfig(
  store: AppSettingStore,
  input: unknown,
  actor: string | null,
): Promise<SyncConfig> {
  const config = SyncConfigSchema.parse(input);
  await store.set(SYNC_CONFIG_KEY, JSON.stringify(config), actor);
  return config;
}
