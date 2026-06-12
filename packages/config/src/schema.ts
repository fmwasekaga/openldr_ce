import { z } from 'zod';

export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),

  AUTH_ADAPTER: z.enum(['keycloak']).default('keycloak'),
  BLOB_ADAPTER: z.enum(['minio']).default('minio'),
  EVENTING_ADAPTER: z.enum(['pg']).default('pg'),
  TARGET_STORE_ADAPTER: z.enum(['pg']).default('pg'),

  // Internal operational Postgres (always pg) — used by the event bus.
  INTERNAL_DATABASE_URL: z.string().url(),
  // External analytics / target store.
  TARGET_DATABASE_URL: z.string().url(),

  // S3 / blob storage.
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  // OIDC issuer (Keycloak realm base URL).
  OIDC_ISSUER_URL: z.string().url(),
});

export type Config = z.infer<typeof ConfigSchema>;
