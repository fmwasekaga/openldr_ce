# OpenLDR CE Configuration Reference

Source of truth: `packages/config/src/schema.ts`.

## Gateway And Public Addressing

These variables control the nginx gateway's public identity and TLS behaviour. `pnpm run init`
writes all of them into `.env.prod`; you can also set them manually.

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `SERVER_NAME` | hostname or IP | `localhost` | nginx `server_name` and the hostname used in the TLS certificate subject. |
| `PUBLIC_ORIGIN` | URL | `https://localhost` | The fully-qualified public origin (scheme + host + optional port). Used to construct absolute URLs in emails and OIDC redirects. |
| `GATEWAY_HTTP_PORT` | positive integer | `80` | Host port mapped to nginx's HTTP listener (redirects to HTTPS). |
| `GATEWAY_HTTPS_PORT` | positive integer | `443` | Host port mapped to nginx's HTTPS listener. |
| `TLS_MODE` | `self-signed\|letsencrypt\|bring-your-own` | `self-signed` | TLS provisioning mode. `self-signed` generates a cert via `gen-selfsigned.sh`; `letsencrypt` uses Certbot (requires a public DNS record); `bring-your-own` reads pre-placed certs from `deploy/nginx/certs/`. |
| `LETSENCRYPT_EMAIL` | email | unset | Required when `TLS_MODE=letsencrypt`. Passed to `certbot certonly` for expiry notifications. |

### OIDC and Keycloak gateway vars

Keycloak is proxied by nginx at `/auth`. The application accesses it two ways:

- **Browser (front-channel):** via the public `OIDC_ISSUER_URL` — e.g. `https://HOST/auth/realms/openldr`. This is the issuer embedded in tokens and used for OIDC discovery.
- **Server (back-channel JWKS):** via `OIDC_INTERNAL_JWKS_URL` — the docker-internal address, which avoids the gateway and the need to trust a self-signed cert.

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `OIDC_ISSUER_URL` | URL | required | Public Keycloak realm issuer, e.g. `https://HOST/auth/realms/openldr`. Must match the token `iss` claim. |
| `OIDC_INTERNAL_JWKS_URL` | URL | unset | Back-channel JWKS endpoint, e.g. `http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/certs`. When set the server fetches signing keys over the docker network, bypassing the gateway TLS cert. |
| `KC_HOSTNAME` | URL | `https://localhost/auth` | Keycloak's advertised external hostname (Keycloak v2 `hostname` setting). Must be `PUBLIC_ORIGIN + /auth`. |

## Required Core Settings

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `NODE_ENV` | `development\|test\|production` | `development` | Controls production safeguards, especially auth bypass. |
| `PORT` | positive integer | `3000` | HTTP server port. |
| `LOG_LEVEL` | string | `info` | Logger verbosity. |
| `INTERNAL_DATABASE_URL` | URL | required | Operational PostgreSQL database for users, audit, eventing, plugins, workflows, forms, marketplace, and schedules. |
| `TARGET_STORE_ADAPTER` | `pg\|mssql\|mysql` | `pg` | Analytics warehouse adapter. |
| `TARGET_DATABASE_URL` | URL | required when `TARGET_STORE_ADAPTER=pg` | PostgreSQL analytics warehouse. |
| `WEB_DIST_DIR` | path | `apps/studio/dist` relative to built server | Overrides where the server serves the built SPA from. This is read directly by `apps/server/src/app.ts`. |

## Startup Flags

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `MIGRATE_ON_START` | boolean string: `true`, `false`, `1`, `0` | `false` | Runs internal and external migrations before binding the server. |
| `SEED_ON_START` | boolean string | `false` | Seeds sample operational data (and the bundled license-safe terminology, see below) after migration. Idempotent. |

## Bundled Terminology

On a fresh install the seed (`openldr db seed`, or `SEED_ON_START=true`) auto-imports two
**license-safe, freely-redistributable** terminology sets so Forms coded-field authoring works
out of the box. The import is **idempotent** (skipped once already present) and **best-effort**
(a terminology-import failure logs a warning and never aborts the rest of the seed):

- **HL7 FHIR R4 base ValueSet catalog** — the FHIR R4 value sets, imported via the FHIR catalog
  path (`packages/db/fixtures/fhir/R4.valuesets.json.gz`).
- **Full UCUM code system** — every UCUM atomic unit + prefix as a FHIR `CodeSystem`
  (`http://unitsofmeasure.org`), generated from `ucum-essence.xml` by
  `scripts/make-ucum-codesystem.mjs` (`packages/db/fixtures/fhir/ucum.codesystem.json.gz`). UCUM is
  © Regenstrief Institute and the UCUM Organization, redistributable with attribution.

**LOINC, SNOMED CT and RxNorm are NOT bundled** — they carry usage licenses and remain
user-provided. Import them yourself once you have accepted the relevant license, e.g.:

```sh
openldr terminology import loinc <dir> --accept-license
openldr terminology import resource <codesystem.json>
```

## Auth And OIDC

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `AUTH_ADAPTER` | `keycloak` | `keycloak` | Auth adapter. |
| `OIDC_ISSUER_URL` | URL | required | Keycloak realm issuer URL. |
| `OIDC_WEB_CLIENT_ID` | string | `openldr-web` | Browser OIDC client id. |
| `OIDC_AUDIENCE` | string | unset | Optional API audience. |
| `KEYCLOAK_ADMIN_CLIENT_ID` | string | unset | Enables admin user actions against Keycloak when paired with the secret. |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | string | unset | Secret for Keycloak admin client. |
| `AUTH_DEV_BYPASS` | boolean string | `true` outside production, `false` in production | Injects a dev admin when no bearer token is present. Production rejects `true`. |
| `AUTH_DEV_USERNAME` | string | `dev-admin` | Dev-bypass username. |
| `AUTH_DEV_ROLES` | comma string | `lab_admin` | Dev-bypass roles. |

## Storage And Eventing

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `BLOB_ADAPTER` | `minio` | `minio` | Blob/S3 adapter. |
| `EVENTING_ADAPTER` | `pg` | `pg` | Event bus adapter. |
| `S3_ENDPOINT` | URL | required | S3-compatible endpoint. |
| `S3_REGION` | string | `us-east-1` | S3 region. |
| `S3_ACCESS_KEY_ID` | string | required | S3 access key. |
| `S3_SECRET_ACCESS_KEY` | string | required | S3 secret key. |
| `S3_BUCKET` | string | required | Bucket for raw inputs and artifacts. |
| `S3_FORCE_PATH_STYLE` | boolean string | `true` | Enables MinIO-compatible path-style URLs. |

## SQL Server Target Store

Required only when `TARGET_STORE_ADAPTER=mssql`.

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `MSSQL_HOST` | string | required for MSSQL | SQL Server host. |
| `MSSQL_PORT` | positive integer | `1433` | SQL Server port. |
| `MSSQL_DATABASE` | string | required for MSSQL | Database name. |
| `MSSQL_USER` | string | required for MSSQL | Login user. |
| `MSSQL_PASSWORD` | string | required for MSSQL | Login password. |
| `MSSQL_ENCRYPT` | boolean string | `false` | Enables encrypted SQL Server connection. |
| `MSSQL_TRUST_SERVER_CERT` | boolean string | `true` | Trusts self-signed SQL Server certificates. |

## MySQL / MariaDB Target Store

Required only when `TARGET_STORE_ADAPTER=mysql`. Serves both MySQL 8.4+ and MariaDB 11.4+.

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `MYSQL_HOST` | string | required for MySQL | MySQL/MariaDB host. |
| `MYSQL_PORT` | positive integer | `3306` | Server port. |
| `MYSQL_DATABASE` | string | required for MySQL | Database name. |
| `MYSQL_USER` | string | required for MySQL | Login user. |
| `MYSQL_PASSWORD` | string | required for MySQL | Login password. |
| `MYSQL_SSL` | boolean string | `false` | Enables a TLS connection to the server. |
| `MYSQL_SSL_REJECT_UNAUTHORIZED` | boolean string | `false` | When true, rejects a server certificate that does not validate against the trust store. |

## Connectors (DHIS2 & external targets)

DHIS2 ships as a removable `dhis2-sink` plugin (Settings ▸ Marketplace). Its connection,
mappings, org-unit links, and schedules are managed from the plugin's own screens —
there are no DHIS2 env vars. Connector credentials are stored encrypted in the database.

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `SECRETS_ENCRYPTION_KEY` | base64 (32 bytes) | required to use secret-bearing connectors | AES-256-GCM key for connector secrets at rest. Generate with `openssl rand -base64 32`. |

## Dashboards

Dashboard raw SQL is toggled at runtime in **Settings → General → Feature Flags** (`dashboard.raw_sql`, admin-only, default off). Its **statement timeout** and **row cap** are no longer environment variables — they are **number settings** under **Settings → General → Limits & tuning** (`dashboard.sql_timeout_ms`, `dashboard.sql_row_cap`), also settable with `openldr settings numbers set`.

## Workflows

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `WORKFLOW_CODE_ENABLED` | boolean string | `false` | Master switch for Workflow Code nodes. **Default off (fail-safe).** Code nodes run author-supplied JavaScript via Node's `vm`, which is **not** a security sandbox — enabled code executes with **host-level privileges** (filesystem, network, environment, secrets). Enable only in trusted, single-tenant deployments. When false, Code nodes refuse to run. |
| `WORKFLOW_CODE_TIMEOUT_MS` | positive integer | `5000` | Code node timeout. |
| `WORKFLOW_CODE_MEMORY_MB` | positive integer | `128` | Code node worker memory cap. |
| `WORKFLOW_HTTP_ALLOWLIST` | comma-separated hostnames | empty | Allowed hosts for Workflow HTTP Request nodes. Empty means no hosts are reachable. |
| `WORKFLOW_FILE_MAX_BYTES` | positive integer | `52428800` | Max byte size of a file uploaded to a workflow run (upload route + webhook body). |
| `WORKFLOW_LOOP_MAX_ITEMS` | positive integer | `100000` | Max accumulated output items a single loop node may emit. |
| `WORKFLOW_FILE_ACCESS_ENABLED` | boolean string | `false` | Master switch for the read/write-file node's host filesystem access (privilege risk → off by default). |
| `WORKFLOW_FILE_ACCESS_ROOT` | path | empty | The single sandbox root all host file operations are confined to (empty = unset). |
| `WORKFLOW_EMAIL_POLL_MIN_SECONDS` | positive integer | `30` | Floor for an email-trigger's poll interval, in seconds. |
| `WORKFLOW_EMAIL_MAX_PER_POLL` | positive integer | `50` | Max unseen messages processed per email-trigger poll. |

> `workflow.dataset_publish_enabled` (publish materialized datasets as real target tables) and `workflow.listeners_enabled` (external listener triggers — Postgres `LISTEN` / IMAP poll) are now **Settings → General feature flags**, not environment variables.

## Plugin Runtime

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `PLUGIN_UI_ENABLED` | boolean string | `true` | Master switch for the plugin webview/UI surface. When false the host serves no plugin nav/UI and the broker refuses all UI calls. |
| `PLUGIN_EGRESS_ENABLED` | boolean string | `true` | Global network-egress kill-switch for plugin host services. When false the broker refuses any egress-bearing operation regardless of a plugin's grant. |
| `PLUGIN_DATA_MAX_DOC_BYTES` | positive integer | `8388608` | Max serialized byte size of a plugin document persisted/forwarded through the broker. |
| `PLUGIN_CRASH_LOG_DIR` | path | `.openldr/crash` | Directory for durable plugin crash markers, drained into the audit trail on the next boot. |

## Crash-loop Breaker

Restart circuit-breaker: if `CRASH_LOOP_THRESHOLD` process crashes occur within `CRASH_LOOP_WINDOW_SEC`, the next boot writes one `system.crash_loop` marker and backs off (escalating sleep-then-exit) so the orchestrator's restart policy slows a hot loop.

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `CRASH_LOOP_THRESHOLD` | positive integer | `5` | Crashes within the window before the breaker trips. |
| `CRASH_LOOP_WINDOW_SEC` | positive integer | `60` | Rolling window, in seconds. |
| `CRASH_LOOP_BACKOFF_MS` | positive integer | `2000` | Initial backoff sleep before exit. |
| `CRASH_LOOP_BACKOFF_CAP_MS` | positive integer | `60000` | Maximum backoff sleep. |

## Marketplace

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `MARKETPLACE_DEV_ALLOW_UNSIGNED` | boolean string | `false` | Allows unsigned bundles during local development only. |
| `MARKETPLACE_REGISTRY_DIR` | path | unset | Local registry directory for marketplace browsing/install. |
| `MARKETPLACE_REGISTRY_URL` | URL | unset | Remote raw registry base URL; takes precedence over `MARKETPLACE_REGISTRY_DIR` for available artifacts. |
| `MARKETPLACE_PUBLISH_TOKEN` | string | unset | GitHub token for marketplace publish PRs. |
| `MARKETPLACE_PUBLISH_REPO` | `owner/repo` | unset | GitHub repository for marketplace publishing. |
| `MARKETPLACE_PUBLISH_BRANCH` | string | `main` | Target branch for publish PRs. |
| `MARKETPLACE_LOCAL_REGISTRY_ROOT` | path | empty | When non-empty, an admin-added **local** registry's directory must resolve inside this root (path-containment). Empty preserves current behaviour. |

## PowerShell And Bash Setup

PowerShell:

```powershell
Copy-Item .env.example .env
docker compose up -d
pnpm install --frozen-lockfile
pnpm openldr db migrate
pnpm -C apps/server dev
```

Bash:

```bash
cp .env.example .env
docker compose up -d
pnpm install --frozen-lockfile
pnpm openldr db migrate
pnpm -C apps/server dev
```

Run the web app separately:

```bash
pnpm -C apps/studio dev
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Config validation fails on `TARGET_DATABASE_URL` | `TARGET_STORE_ADAPTER` defaults to `pg`, which requires `TARGET_DATABASE_URL`. | Set `TARGET_DATABASE_URL` or switch to `TARGET_STORE_ADAPTER=mssql` and provide all `MSSQL_*` keys. |
| A connector/sink push fails with a connector error (e.g. the DHIS2 plugin) | No connector configured, the connector is disabled, or `SECRETS_ENCRYPTION_KEY` is unset. | Create/enable a connector under Settings ▸ Connectors and set `SECRETS_ENCRYPTION_KEY`. |
| HTTP Request workflow node cannot reach a host | `WORKFLOW_HTTP_ALLOWLIST` does not include the hostname. | Set a comma-separated allowlist, for example `WORKFLOW_HTTP_ALLOWLIST=api.example.org,dhis2.local`. |
| Built server serves API but not SPA | `WEB_DIST_DIR` points to a missing directory. | Build web with `pnpm -C apps/studio build` and set `WEB_DIST_DIR` to that `dist` path if using a custom layout. |
| Raw SQL dashboard tab is hidden | Feature flag `dashboard.raw_sql` is off or target store is not PostgreSQL. | Enable the flag in **Settings → General → Feature Flags** (admin-only) and ensure `TARGET_STORE_ADAPTER=pg`. |
