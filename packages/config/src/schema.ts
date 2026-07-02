import { z } from 'zod';

// Env vars arrive as strings, so `z.coerce.boolean()` (JS `Boolean(value)`) treats
// any non-empty string — including 'false' and '0' — as `true`. Parse string booleans
// explicitly instead.
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

    // Run internal + external DB migrations (migrateToLatest, idempotent) on server
    // startup before binding. Off by default so dev/tests manage their own schema; the
    // single-port prod deployment turns it on so a fresh DB self-migrates. See DEPLOYMENT.md.
    MIGRATE_ON_START: envBoolean(false),

    // Seed idempotent sample data (org/location/patient + bundled sample forms) on startup
    // after migration. Off by default; the prod demo turns it on so it comes up populated.
    SEED_ON_START: envBoolean(false),

    AUTH_ADAPTER: z.enum(['keycloak']).default('keycloak'),
    BLOB_ADAPTER: z.enum(['minio']).default('minio'),
    EVENTING_ADAPTER: z.enum(['pg']).default('pg'),
    TARGET_STORE_ADAPTER: z.enum(['pg', 'mssql']).default('pg'),

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

    // S3 / blob storage.
    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_FORCE_PATH_STYLE: envBoolean(true),

    // OIDC issuer (Keycloak realm base URL).
    OIDC_ISSUER_URL: z.string().url(),
    OIDC_WEB_CLIENT_ID: z.string().min(1).default('openldr-web'),
    OIDC_AUDIENCE: z.string().min(1).optional(),
    // Internal (back-channel) JWKS URL. When set, the app fetches signing keys from this
    // docker-network URL instead of via discovery on the public issuer (which may sit behind
    // the gateway with a self-signed cert). Issuer CLAIM validation still uses OIDC_ISSUER_URL.
    OIDC_INTERNAL_JWKS_URL: z.string().url().optional(),
    KEYCLOAK_ADMIN_CLIENT_ID: z.string().min(1).optional(),
    KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().min(1).optional(),

    // Non-production auth bypass: when on and a request has no bearer token, the
    // server injects a dev admin actor. MUST be off in production (enforced below).
    AUTH_DEV_BYPASS: z
      .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === true || v === 'true' || v === '1')),
    AUTH_DEV_USERNAME: z.string().min(1).default('dev-admin'),
    AUTH_DEV_ROLES: z.string().default('lab_admin'),

    // Custom dashboards — raw-SQL widget escape hatch is now the `dashboard.raw_sql`
    // feature flag (Settings → General), not an env var. Timeout/row-cap remain env-tunable.
    DASHBOARD_SQL_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    DASHBOARD_SQL_ROW_CAP: z.coerce.number().int().positive().default(10000),

    // Workflow Code node sandbox limits.
    // SECURITY (SEC-01): Code nodes execute user JS via Node's `vm` inside a worker_thread.
    // `vm` is NOT a security boundary — workflow code can escape it (constructor chain) and
    // reach the host process's filesystem, network, environment, and secrets. This flag is
    // therefore default-OFF (fail-safe): enabling it lets workflow AUTHORS run code with
    // HOST-LEVEL privileges. Only enable in trusted, single-tenant deployments. It is NOT a
    // sandbox. A real isolate (separate unprivileged process) is the proper long-term fix.
    WORKFLOW_CODE_ENABLED: envBoolean(false),
    WORKFLOW_CODE_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    WORKFLOW_CODE_MEMORY_MB: z.coerce.number().int().positive().default(128),
    // Comma-separated allow-list of hostnames for the workflow HTTP source node.
    WORKFLOW_HTTP_ALLOWLIST: z.string().default(''),
    // Publish materialized workflow datasets as real `wf_ds_<name>` tables in the
    // target store (Postgres only) so the SQL node + dashboards can query them.
    WORKFLOW_DATASET_PUBLISH_ENABLED: envBoolean(false),
    // Max byte size of a file uploaded to a workflow run (upload route + webhook body).
    WORKFLOW_FILE_MAX_BYTES: z.coerce.number().int().positive().default(52_428_800),
    // Max accumulated output items a single loop node may emit on its done handle.
    WORKFLOW_LOOP_MAX_ITEMS: z.coerce.number().int().positive().default(100_000),
    // Master switch for external listener triggers (postgres LISTEN / IMAP poll).
    WORKFLOW_LISTENERS_ENABLED: envBoolean(true),
    // Master switch for the read-write-file node's host filesystem access (privilege risk → off by default).
    WORKFLOW_FILE_ACCESS_ENABLED: envBoolean(false),
    // The single sandbox root all host file operations are confined to (empty = unset).
    WORKFLOW_FILE_ACCESS_ROOT: z.string().default(''),
    // Floor for an email-trigger's poll interval (seconds).
    WORKFLOW_EMAIL_POLL_MIN_SECONDS: z.coerce.number().int().positive().default(30),
    // Max unseen messages processed per email-trigger poll.
    WORKFLOW_EMAIL_MAX_PER_POLL: z.coerce.number().int().positive().default(50),

    // Plugin-UI surface master switch. When false the broker refuses all calls and the host
    // serves no plugin nav/UI (kill-switch for the whole webview surface).
    PLUGIN_UI_ENABLED: envBoolean(true),
    // Global egress kill-switch for plugin host services. When false the broker refuses any
    // net-egress-bearing operation regardless of a plugin's grant (consumed by SP-A2's push ops).
    PLUGIN_EGRESS_ENABLED: envBoolean(true),
    // Max serialized byte size of a plugin document persisted/forwarded through the broker
    // (storage.put doc, invoke/push/validate payloads). Generous default (8 MB) so the DHIS2
    // metadata-cache doc (full metadata snapshot) still writes; bounds a memory-DoS otherwise.
    PLUGIN_DATA_MAX_DOC_BYTES: z.coerce.number().int().positive().default(8_388_608),
    // Directory for durable plugin crash markers. When an Extism worker (or any plugin) crashes
    // the whole Node process, the in-app audit DB write can't flush in time, so the process
    // crash handler appends a synchronous JSON marker here naming the in-flight plugin; the next
    // boot drains these into the audit trail (action plugin.crash). Created on first write.
    PLUGIN_CRASH_LOG_DIR: z.string().default('.openldr/crash'),

    // Restart circuit-breaker: if >= CRASH_LOOP_THRESHOLD process crashes occur within
    // CRASH_LOOP_WINDOW_SEC, the next boot writes one system.crash_loop marker and backs off
    // (escalating sleep-then-exit) so the orchestrator's restart policy slows a hot loop instead
    // of the app hot-spinning and flooding the crash log / audit trail.
    CRASH_LOOP_THRESHOLD: z.coerce.number().int().positive().default(5),
    CRASH_LOOP_WINDOW_SEC: z.coerce.number().int().positive().default(60),
    CRASH_LOOP_BACKOFF_MS: z.coerce.number().int().positive().default(2_000),
    CRASH_LOOP_BACKOFF_CAP_MS: z.coerce.number().int().positive().default(60_000),

    // Marketplace artifact security.
    MARKETPLACE_DEV_ALLOW_UNSIGNED: envBoolean(false),
    MARKETPLACE_REGISTRY_DIR: z.string().optional(),
    MARKETPLACE_REGISTRY_URL: z.string().url().optional(), // raw base URL of a remote registry; takes precedence over _DIR for install
    MARKETPLACE_PUBLISH_TOKEN: z.string().optional(),     // GitHub PAT (repo write); secret
    MARKETPLACE_PUBLISH_REPO: z.string().optional(),      // owner/repo, e.g. fmwasekaga/openldr-ce-marketplace
    MARKETPLACE_PUBLISH_BRANCH: z.string().default('main'),
    // SEC-09: when non-empty, an admin-added LOCAL registry's directory must resolve
    // INSIDE this root (path-containment), bounding arbitrary-local-path reads. Empty
    // (default) preserves current behavior — the root is the opt-in containment switch.
    MARKETPLACE_LOCAL_REGISTRY_ROOT: z.string().default(''),
    // SEC-10: max bytes for a remote bundle wasm payload download (defense against an
    // OOM from a malicious/compromised registry). 64 MB default.
    MARKETPLACE_MAX_PAYLOAD_BYTES: z.coerce.number().int().positive().default(67_108_864),

    // Secret-at-rest encryption key for dynamic Connectors (base64, decodes to 32 bytes /
    // AES-256). Optional at boot; required only when a secret-bearing connector is
    // created/updated/decrypted — the connector store fails closed with a clear error if
    // it's unset at that point. Never logged (covered by the secrets-redaction boundary).
    SECRETS_ENCRYPTION_KEY: z.string().optional(),
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
    if (cfg.NODE_ENV === 'production' && cfg.AUTH_DEV_BYPASS === true) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['AUTH_DEV_BYPASS'], message: 'AUTH_DEV_BYPASS must be off in production' });
    }
  })
  .transform((cfg) => ({
    ...cfg,
    AUTH_DEV_BYPASS: cfg.AUTH_DEV_BYPASS ?? cfg.NODE_ENV !== 'production',
  }));

export type Config = z.infer<typeof ConfigSchema>;
