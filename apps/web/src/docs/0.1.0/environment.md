# Environment variables

OpenLDR is configured through environment variables read at startup. In a Docker
deployment they live in the `.env` file the installer generates next to
`docker-compose.yml`. Change a value, then recreate the stack to apply it:

```
docker compose up -d
```

Most operators never edit these by hand — the installer writes sensible defaults and
generates every secret for you. This page is a reference for the values that matter
once you move beyond a single-host install: a public domain, an external database, or
SQL Server as the analytics store.

> Secrets (`*_PASSWORD`, `*_SECRET_*`, `SECRETS_ENCRYPTION_KEY`) are generated on first
> install — never share or commit them. Rotating `SECRETS_ENCRYPTION_KEY` after
> connectors exist makes their stored credentials unreadable, so treat it as permanent
> once the stack is live.

## Runtime

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `production` | Runtime mode. Keep `production` for deployments. |
| `PORT` | `3000` | Internal API port behind the gateway. |
| `LOG_LEVEL` | `info` | Log verbosity (`debug`, `info`, `warn`, `error`). |
| `OPENLDR_VERSION` | `latest` | Image tag the stack pulls and runs. |

## Public address and TLS

These decide the URL users reach and how the gateway terminates HTTPS. `SERVER_NAME` is
the public hostname; `PUBLIC_ORIGIN` is the full origin used for links and OIDC
redirects. The [installer](/docs/install) sets these from `--server-name` /
`--letsencrypt`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SERVER_NAME` | `localhost` | Public hostname or domain of this deployment. |
| `PUBLIC_ORIGIN` | `https://localhost` | Full external origin (`https://your.domain`). |
| `GATEWAY_HTTP_PORT` | `80` | Host port the gateway serves HTTP on. |
| `GATEWAY_HTTPS_PORT` | `443` | Host port the gateway serves HTTPS on. |
| `TLS_MODE` | `self-signed` | `self-signed` or a trusted (Let's Encrypt) certificate. |
| `LETSENCRYPT_EMAIL` | — | Contact email used when issuing a trusted certificate. |

## Database

OpenLDR uses two Postgres databases: an internal application database and a target
(analytics) warehouse. Both are provided as connection URLs.

| Variable | Purpose |
| --- | --- |
| `INTERNAL_DATABASE_URL` | Application database (users, forms, workflows, audit). |
| `TARGET_DATABASE_URL` | Analytics warehouse the pipelines write to. |
| `POSTGRES_PASSWORD` | Password for the bundled Postgres container. |

## Adapters

Adapters select the backing implementation for each subsystem. The defaults match the
bundled containers; change them only when pointing at external infrastructure.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_ADAPTER` | `keycloak` | Identity provider backing sign-in. |
| `BLOB_ADAPTER` | `minio` | Object-storage backend for uploads and artifacts. |
| `EVENTING_ADAPTER` | `pg` | Event store used by workflow triggers. |
| `TARGET_STORE_ADAPTER` | `pg` | Analytics warehouse engine (`pg` or `mssql`). |
| `REPORTING_TARGET_ADAPTER` | `none` | Optional external reporting target. |

## Object storage (S3 / MinIO)

The bundled MinIO container is S3-compatible. Point these at any S3 endpoint to use
external storage instead.

| Variable | Default | Purpose |
| --- | --- | --- |
| `S3_ENDPOINT` | `http://minio:9000` | S3 endpoint URL. |
| `S3_REGION` | `us-east-1` | S3 region. |
| `S3_ACCESS_KEY_ID` | generated | Access key. |
| `S3_SECRET_ACCESS_KEY` | generated | Secret key. |
| `S3_BUCKET` | `openldr` | Bucket that holds uploads and artifacts. |
| `S3_FORCE_PATH_STYLE` | `true` | Path-style addressing (required by MinIO). |

## Authentication (Keycloak / OIDC)

Sign-in runs through Keycloak. The installer registers this deployment's origin as a
valid OIDC redirect automatically; you only touch these when using an external identity
provider.

| Variable | Purpose |
| --- | --- |
| `OIDC_ISSUER_URL` | Public issuer URL of the realm. |
| `OIDC_INTERNAL_JWKS_URL` | In-cluster JWKS endpoint the API validates tokens against. |
| `OIDC_AUDIENCE` | Expected token audience. |
| `OIDC_WEB_CLIENT_ID` | Public client ID the studio app authenticates with. |
| `KC_HOSTNAME` | Public base URL Keycloak advertises. |
| `KEYCLOAK_ADMIN` | Keycloak admin username. |
| `KEYCLOAK_ADMIN_PASSWORD` | Keycloak admin password (generated). |
| `KEYCLOAK_ADMIN_CLIENT_ID` | Client ID used for admin API calls. |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | Client secret for admin API calls. |

### Development-only auth bypass

`AUTH_DEV_BYPASS` turns **authentication off**: any API request without a bearer token is
served as a dev admin. It exists so local development and end-to-end tests can run without
a configured Keycloak. It is **off unless you explicitly set it**, and the server refuses
to start with it enabled under `NODE_ENV=production`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_DEV_BYPASS` | `false` | Serve unauthenticated API requests as a dev admin. Local development only. |
| `AUTH_DEV_USERNAME` | `dev-admin` | Username of the injected dev actor. |
| `AUTH_DEV_ROLES` | `lab_admin` | Roles granted to the injected dev actor. |

Never set this in a deployment. When it is on, Studio shows an "Authentication bypass
active" banner and the server logs a warning at startup.

## Secrets

| Variable | Purpose |
| --- | --- |
| `SECRETS_ENCRYPTION_KEY` | Base64 32-byte key that encrypts connector credentials at rest. Generate with `openssl rand -base64 32`. |

## First-run behavior

| Variable | Default | Purpose |
| --- | --- | --- |
| `MIGRATE_ON_START` | `true` | Run database migrations when the API starts. |
| `SEED_ON_START` | `true` | Seed default forms, workflows, and terminology on first boot. |

## SQL Server target store

Set only when `TARGET_STORE_ADAPTER=mssql`. Start the SQL Server profile with
`docker compose --profile mssql up -d`.

| Variable | Purpose |
| --- | --- |
| `MSSQL_HOST` | SQL Server host. |
| `MSSQL_PORT` | SQL Server port. |
| `MSSQL_DATABASE` | Target database name. |
| `MSSQL_USER` | Login. |
| `MSSQL_PASSWORD` | Password. |
| `MSSQL_ENCRYPT` | `true`/`false` — encrypt the connection. |
| `MSSQL_TRUST_SERVER_CERT` | `true`/`false` — trust a self-signed server certificate. |

## Marketplace

| Variable | Default | Purpose |
| --- | --- | --- |
| `MARKETPLACE_REGISTRY_URL` | bundled registry | Remote registry seeded on first boot when no registries exist. |
