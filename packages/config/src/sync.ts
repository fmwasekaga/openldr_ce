import { z } from 'zod';

/**
 * Lab⇄central sync configuration. This is CONFIG SCAFFOLDING — the sync engine itself is
 * not implemented yet (see docs/superpowers/specs/2026-07-02-distributed-sync-architecture-design.md).
 * The settings are persisted (app_settings key `sync.config`, non-secret) so an operator
 * can configure the feature ahead of it shipping. Per-lab credentials are NOT stored here —
 * they belong in the secret/connector store when the engine lands.
 */
export const SYNC_CONFIG_KEY = 'sync.config';

export const SyncModeSchema = z.enum(['push', 'pull', 'bidirectional']);
export type SyncMode = z.infer<typeof SyncModeSchema>;

export const SyncConfigSchema = z
  .object({
    /** Master on/off. When the engine ships, false keeps it fully dormant. */
    enabled: z.boolean().default(false),
    /** Direction: push to central, pull from central, or both. */
    mode: SyncModeSchema.default('bidirectional'),
    /** Base URL of the central instance (http/https). */
    centralUrl: z.string().default(''),
    /** This lab's site identifier (scopes ownership at central). */
    siteId: z.string().default(''),
    /** How often to sync, in minutes. */
    intervalMinutes: z.number().int().positive().max(1440).default(15),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.centralUrl && !/^https?:\/\//i.test(cfg.centralUrl)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['centralUrl'], message: 'centralUrl must be an http(s) URL' });
    }
    if (cfg.enabled && !cfg.centralUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['centralUrl'], message: 'centralUrl is required when sync is enabled' });
    }
    if (cfg.enabled && !cfg.siteId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['siteId'], message: 'siteId is required when sync is enabled' });
    }
  });

export type SyncConfig = z.infer<typeof SyncConfigSchema>;

export const DEFAULT_SYNC_CONFIG: SyncConfig = SyncConfigSchema.parse({});

/** Parse a stored JSON value into a SyncConfig, falling back to defaults on absence/corruption. */
export function parseSyncConfig(raw: string | null | undefined): SyncConfig {
  if (!raw) return { ...DEFAULT_SYNC_CONFIG };
  try {
    return SyncConfigSchema.parse(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SYNC_CONFIG };
  }
}
