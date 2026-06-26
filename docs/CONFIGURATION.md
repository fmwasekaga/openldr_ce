# OpenLDR CE Configuration Reference

Source of truth: `packages/config/src/schema.ts`.

## Required Core Settings

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `NODE_ENV` | `development\|test\|production` | `development` | Controls production safeguards, especially auth bypass. |
| `PORT` | positive integer | `3000` | HTTP server port. |
| `LOG_LEVEL` | string | `info` | Logger verbosity. |
| `INTERNAL_DATABASE_URL` | URL | required | Operational PostgreSQL database for users, audit, eventing, plugins, workflows, forms, marketplace, and schedules. |
| `TARGET_STORE_ADAPTER` | `pg\|mssql` | `pg` | Analytics warehouse adapter. |
| `TARGET_DATABASE_URL` | URL | required when `TARGET_STORE_ADAPTER=pg` | PostgreSQL analytics warehouse. |
| `WEB_DIST_DIR` | path | `apps/web/dist` relative to built server | Overrides where the server serves the built SPA from. This is read directly by `apps/server/src/app.ts`. |

## Startup Flags

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `MIGRATE_ON_START` | boolean string: `true`, `false`, `1`, `0` | `false` | Runs internal and external migrations before binding the server. |
| `SEED_ON_START` | boolean string | `false` | Seeds sample operational data after migration. |

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

## DHIS2

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `REPORTING_TARGET_ADAPTER` | `none\|dhis2` | `none` | Enables DHIS2 reporting-target wiring. Connection details live in a Connector (Settings ▸ Connectors), not env vars. |
| `SECRETS_ENCRYPTION_KEY` | base64 (32 bytes) | required to use secret-bearing connectors | AES-256-GCM key for connector secrets at rest. Generate with `openssl rand -base64 32`. |
| `DHIS2_SYNC_ENABLED` | boolean string | `true` | Enables scheduled/event-driven DHIS2 sync processing. |

## Dashboards

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `DASHBOARD_SQL_ENABLED` | boolean string | `false` | Enables raw SQL widgets when the target store is PostgreSQL. |
| `DASHBOARD_SQL_TIMEOUT_MS` | positive integer | `5000` | Statement timeout for raw dashboard SQL. |
| `DASHBOARD_SQL_ROW_CAP` | positive integer | `10000` | Row cap for raw dashboard SQL. |

## Workflows

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `WORKFLOW_CODE_ENABLED` | boolean string | `false` | Master switch for Workflow Code nodes. **Default off (fail-safe).** Code nodes run author-supplied JavaScript via Node's `vm`, which is **not** a security sandbox — enabled code executes with **host-level privileges** (filesystem, network, environment, secrets). Enable only in trusted, single-tenant deployments. When false, Code nodes refuse to run. |
| `WORKFLOW_CODE_TIMEOUT_MS` | positive integer | `5000` | Code node timeout. |
| `WORKFLOW_CODE_MEMORY_MB` | positive integer | `128` | Code node worker memory cap. |
| `WORKFLOW_HTTP_ALLOWLIST` | comma-separated hostnames | empty | Allowed hosts for Workflow HTTP Request nodes. Empty means no hosts are reachable. |
| `WORKFLOW_DATASET_PUBLISH_ENABLED` | boolean string | `false` | When true and the target store is PostgreSQL, materialized workflow datasets are also published as `wf_ds_<name>` tables with one `data jsonb` column. |

## Marketplace

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `MARKETPLACE_DEV_ALLOW_UNSIGNED` | boolean string | `false` | Allows unsigned bundles during local development only. |
| `MARKETPLACE_REGISTRY_DIR` | path | unset | Local registry directory for marketplace browsing/install. |
| `MARKETPLACE_REGISTRY_URL` | URL | unset | Remote raw registry base URL; takes precedence over `MARKETPLACE_REGISTRY_DIR` for available artifacts. |
| `MARKETPLACE_PUBLISH_TOKEN` | string | unset | GitHub token for marketplace publish PRs. |
| `MARKETPLACE_PUBLISH_REPO` | `owner/repo` | unset | GitHub repository for marketplace publishing. |
| `MARKETPLACE_PUBLISH_BRANCH` | string | `main` | Target branch for publish PRs. |

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
pnpm -C apps/web dev
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Config validation fails on `TARGET_DATABASE_URL` | `TARGET_STORE_ADAPTER` defaults to `pg`, which requires `TARGET_DATABASE_URL`. | Set `TARGET_DATABASE_URL` or switch to `TARGET_STORE_ADAPTER=mssql` and provide all `MSSQL_*` keys. |
| DHIS2 push fails with a connector error | No connector configured, the connector is disabled, or `SECRETS_ENCRYPTION_KEY` is unset. | Create/enable a connector under Settings ▸ Connectors and set `SECRETS_ENCRYPTION_KEY`. |
| HTTP Request workflow node cannot reach a host | `WORKFLOW_HTTP_ALLOWLIST` does not include the hostname. | Set a comma-separated allowlist, for example `WORKFLOW_HTTP_ALLOWLIST=api.example.org,dhis2.local`. |
| Built server serves API but not SPA | `WEB_DIST_DIR` points to a missing directory. | Build web with `pnpm -C apps/web build` and set `WEB_DIST_DIR` to that `dist` path if using a custom layout. |
| Raw SQL dashboard tab is hidden | `DASHBOARD_SQL_ENABLED=false` or target store is not PostgreSQL. | Use builder mode, or set `DASHBOARD_SQL_ENABLED=true` with `TARGET_STORE_ADAPTER=pg`. |
