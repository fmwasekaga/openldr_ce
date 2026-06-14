import { z } from 'zod';

// Env vars arrive as strings, so `z.coerce.boolean()` (JS `Boolean(value)`) treats
// any non-empty string — including 'false' and '0' — as `true`. Parse string booleans
// explicitly instead. Mirrors the DHIS2_SYNC_ENABLED pattern below.
const envBoolean = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .default(defaultValue)
    .transform((v) => v === true || v === 'true' || v === '1');

export const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.string().default('info'),

    AUTH_ADAPTER: z.enum(['keycloak']).default('keycloak'),
    BLOB_ADAPTER: z.enum(['minio']).default('minio'),
    EVENTING_ADAPTER: z.enum(['pg']).default('pg'),
    TARGET_STORE_ADAPTER: z.enum(['pg', 'mssql']).default('pg'),
    REPORTING_TARGET_ADAPTER: z.enum(['none', 'dhis2']).default('none'),

    // Internal operational Postgres (always pg) — used by the event bus, audit, users, plugins.
    INTERNAL_DATABASE_URL: z.string().url(),
    // External analytics / target store (required when TARGET_STORE_ADAPTER=pg).
    TARGET_DATABASE_URL: z.string().url().optional(),

    // SQL Server target store (required when TARGET_STORE_ADAPTER=mssql).
    MSSQL_HOST: z.string().min(1).optional(),
    MSSQL_PORT: z.coerce.number().int().positive().default(1433),
    MSSQL_DATABASE: z.string().min(1).optional(),
    MSSQL_USER: z.string().min(1).optional(),
    MSSQL_PASSWORD: z.string().min(1).optional(),
    MSSQL_ENCRYPT: envBoolean(false),
    MSSQL_TRUST_SERVER_CERT: envBoolean(true),

    // DHIS2 reporting target (required when REPORTING_TARGET_ADAPTER=dhis2).
    DHIS2_BASE_URL: z.string().url().optional(),
    DHIS2_USERNAME: z.string().min(1).optional(),
    DHIS2_PASSWORD: z.string().min(1).optional(),
    DHIS2_SYNC_ENABLED: z
      .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
      .default(true)
      .transform((v) => v === true || v === 'true' || v === '1'),

    // S3 / blob storage.
    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_FORCE_PATH_STYLE: envBoolean(true),

    // OIDC issuer (Keycloak realm base URL).
    OIDC_ISSUER_URL: z.string().url(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.TARGET_STORE_ADAPTER === 'mssql') {
      for (const key of ['MSSQL_HOST', 'MSSQL_DATABASE', 'MSSQL_USER', 'MSSQL_PASSWORD'] as const) {
        if (!cfg[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when TARGET_STORE_ADAPTER=mssql` });
        }
      }
    } else if (!cfg.TARGET_DATABASE_URL) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TARGET_DATABASE_URL'], message: 'TARGET_DATABASE_URL is required when TARGET_STORE_ADAPTER=pg' });
    }
    if (cfg.REPORTING_TARGET_ADAPTER === 'dhis2') {
      for (const key of ['DHIS2_BASE_URL', 'DHIS2_USERNAME', 'DHIS2_PASSWORD'] as const) {
        if (!cfg[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when REPORTING_TARGET_ADAPTER=dhis2` });
      }
    }
  });

export type Config = z.infer<typeof ConfigSchema>;
