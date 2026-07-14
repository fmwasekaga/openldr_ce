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

/**
 * @deprecated Legacy single-blob shape (app_settings key `sync.config`). S4 moved the operator
 * surface onto the six discrete `sync.*` keys the workers actually read; this schema is retained
 * ONLY so the one-time blob→discrete migration (and `parseSyncConfig`) can still parse an existing
 * blob. New reads/writes go through {@link SyncConfigInputSchema} / {@link SyncConfigView}.
 */
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

/**
 * Input accepted by setSyncConfig / PUT /api/settings/sync / CLI. Writes the six discrete `sync.*`
 * keys the workers read. `clientSecret` is optional & WRITE-ONLY: a blank/absent value leaves the
 * stored (encrypted) secret unchanged so a field-level patch or a UI submit that doesn't re-type the
 * secret preserves it.
 */
export const SyncConfigInputSchema = z
  .object({
    enabled: z.boolean().default(false),
    mode: SyncModeSchema.default('bidirectional'),
    centralUrl: z.string().default(''),
    siteId: z.string().default(''),
    oidcIssuer: z.string().default(''),
    clientId: z.string().default(''),
    clientSecret: z.string().optional(),
    intervalMinutes: z.number().int().positive().max(1440).default(15),
  })
  .superRefine((c, ctx) => {
    if (c.centralUrl && !/^https?:\/\//i.test(c.centralUrl))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['centralUrl'], message: 'centralUrl must be an http(s) URL' });
    if (c.oidcIssuer && !/^https?:\/\//i.test(c.oidcIssuer))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['oidcIssuer'], message: 'oidcIssuer must be an http(s) URL' });
    if (c.enabled) {
      for (const [f, v] of [
        ['centralUrl', c.centralUrl],
        ['siteId', c.siteId],
        ['oidcIssuer', c.oidcIssuer],
        ['clientId', c.clientId],
      ] as const) {
        if (!v) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [f], message: `${f} is required when sync is enabled` });
      }
    }
  });
export type SyncConfigInput = z.infer<typeof SyncConfigInputSchema>;

/** Output of getSyncConfig / GET /api/settings/sync / `openldr sync show` — never carries the secret
 *  value, only a boolean indicating whether one is set. */
export interface SyncConfigView {
  enabled: boolean;
  mode: SyncMode;
  centralUrl: string;
  siteId: string;
  oidcIssuer: string;
  clientId: string;
  clientSecretSet: boolean;
  intervalMinutes: number;
}
