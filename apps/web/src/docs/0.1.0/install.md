# Install

The one-line installer scaffolds an `openldr/` directory, generates secrets, pulls the
images, and starts the stack. When it finishes it prints the URL and the generated
admin credentials.

## Quick start (local / self-signed)

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash
```

**Windows (PowerShell)**
```
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.ps1 | iex
```

This brings the stack up on `https://localhost` with a self-signed certificate — your
browser will warn once; accept it to continue.

## Public domain + trusted TLS (Let's Encrypt)

To serve a real domain with a browser-trusted certificate in one shot, pass your
hostname and an email. The installer brings the stack up, requests a Let's Encrypt
certificate over HTTP-01, installs it into the gateway, and wires up **automatic
renewal** (a cron job that renews and reloads the gateway).

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --server-name your.domain.com --letsencrypt you@email.com
```

Point `your.domain.com` at the host and open inbound **TCP 80 and 443** first —
Let's Encrypt validates over port 80. If issuance fails, the stack stays up on the
self-signed certificate; re-run the same command once DNS and ports are ready.

> **Tip:** add `--staging` the first time to use the Let's Encrypt staging CA. It
> avoids the production rate limits while you confirm DNS and firewall are correct,
> then re-run without `--staging` for the real certificate.

> Let's Encrypt issuance and auto-renewal are Linux-only. On Windows the installer
> configures a self-signed certificate; front it with your own reverse proxy or
> certificate if you need trusted TLS.

## Bring your own certificate

Already have a certificate — a `fullchain.pem` + `privkey.pem` from elsewhere, a wildcard, or
an internal CA? Scaffold without starting, drop the files in, then start:

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --server-name your.domain.com --no-start
cp /path/to/fullchain.pem openldr/config/nginx/certs/fullchain.pem
cp /path/to/privkey.pem   openldr/config/nginx/certs/privkey.pem
cd openldr && docker compose up -d
```

`--server-name` sets the domain in the generated `.env` and the OIDC redirect. On Windows use
`install.ps1 -ServerName your.domain.com -NoStart`, copy the two files into
`openldr\config\nginx\certs\`, then `docker compose up -d`. Already running on the self-signed
certificate? Overwrite the two files and run `docker compose restart gateway`.

## SQL Server as the analytics database

OpenLDR keeps operational data in an internal **PostgreSQL** database (always) and writes flattened
analytics/reporting data to a separate **external** database. That external database is **PostgreSQL by
default**, or a **self-hosted Microsoft SQL Server** — chosen at install time. Dashboards, reports,
custom queries, and the report designer all read from it, and the query surfaces are SQL Server–aware.

**Supported SQL Server versions:** 2017, 2019, and 2022 — self-hosted only. 2017 is the minimum (the
nearest upgrade for sites still on 2014).

> **No cloud databases — ever.** Azure SQL, Managed Instance, AWS RDS, and any hosted SQL are **not
> supported**, for either database. Ministry-of-Health and laboratory data must stay on infrastructure
> the operator controls — a permanent data-sovereignty constraint. SQL Server 2016 and earlier are
> unsupported (end of life / no official Linux container); upgrade to 2017.

Select the target with `--target-db` (default `postgres`). There are two SQL Server paths.

### Demo / evaluation

Spin up a bundled SQL Server 2022 container alongside the stack — the installer generates its SA
password and creates the `openldr_target` database automatically.

```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --mssql-demo
```

On Windows: `install.ps1 -MssqlDemo`.

> SQL Server Developer/Express editions are **not licensed for production**, so the bundled container
> is for evaluation only and must never back a production deployment.

### Production (bring your own SQL Server)

Point OpenLDR at your own self-hosted SQL Server. **The target database must already exist.**

```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --target-db mssql \
      --mssql-host sql.internal --mssql-user openldr --mssql-password 'YourStrongPassword1'
```

On Windows: `install.ps1 -TargetDb mssql -MssqlHost sql.internal -MssqlUser openldr -MssqlPassword '...'`.
Optional: `--mssql-port` (default `1433`), `--mssql-database` (`openldr_target`), `--mssql-encrypt`
(`false`), `--mssql-trust-cert` (`true`).

> Keep the SQL Server password free of `#`, spaces, and quote characters — they confuse Docker
> Compose's `.env` reader.

These map to `TARGET_STORE_ADAPTER=mssql` and the `MSSQL_*` [environment variables](/docs/environment);
you can also set them in `.env` directly.

## MySQL/MariaDB as the analytics database

OpenLDR can also write analytics/reporting data to a **self-hosted MySQL** or **MariaDB** database —
chosen at install time. Dashboards, reports, custom queries, and the report designer all read from it.

**Supported versions:** MySQL 8.4 LTS and MariaDB 11.4 LTS — self-hosted only.

> **No cloud databases — ever.** Azure Database for MySQL, AWS RDS, and any hosted MySQL/MariaDB
> are **not supported**. Ministry-of-Health and laboratory data must stay on infrastructure
> the operator controls — a permanent data-sovereignty constraint.

Select the target with `--target-db` (default `postgres`). There are two MySQL/MariaDB paths.

### Demo / evaluation

Spin up a bundled MySQL 8.4 container alongside the stack — the installer generates the password and
creates the `openldr_target` database automatically.

```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --mysql-demo
```

On Windows: `install.ps1 -MysqlDemo`.

> The bundled MySQL container is for evaluation only and must never back a production deployment.

### Production (bring your own MySQL/MariaDB)

Point OpenLDR at your own self-hosted MySQL or MariaDB. **The target database must already exist.**

```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --target-db mysql \
      --mysql-host mysql.internal --mysql-user openldr --mysql-password 'YourStrongPassword1'
```

On Windows: `install.ps1 -TargetDb mysql -MysqlHost mysql.internal -MysqlUser openldr -MysqlPassword '...'`.
Optional: `--mysql-port` (default `3306`), `--mysql-database` (`openldr_target`), `--mysql-ssl` (`false`).

> Keep the MySQL/MariaDB password free of `#`, spaces, and quote characters — they confuse Docker
> Compose's `.env` reader.

These map to `TARGET_STORE_ADAPTER=mysql` and the `MYSQL_*` [environment variables](/docs/environment);
you can also set them in `.env` directly.

## Installer flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `--dir <path>` | `./openldr` | Directory to scaffold the stack into. |
| `--version <tag>` | `latest` | Image tag to pull and run. |
| `--server-name <host>` | `localhost` | Public hostname/domain for this deployment. |
| `--letsencrypt <email>` | — | Issue a trusted Let's Encrypt certificate for `--server-name`. |
| `--staging` | off | Use the Let's Encrypt staging CA (testing; avoids rate limits). |
| `--no-start` | off | Scaffold and configure only; don't start the stack. |
| `--no-pull` | off | Skip pulling images (use what's already local). |
| `--seedless` | off (seeded) | Empty first run — skip the seeded sample dashboard + demo data (the default seeds them). Windows: `-Seedless`. Fresh install only. |
| `--target-db <db>` | `postgres` | External analytics database: `postgres`, `mssql`, or `mysql`. |
| `--mssql-demo` | off | Bundle a SQL Server 2022 container (evaluation only); implies `--target-db mssql`. |
| `--mssql-host <host>` | — | BYO SQL Server host (required for `--target-db mssql` without `--mssql-demo`). |
| `--mssql-port <n>` | `1433` | BYO SQL Server port. |
| `--mssql-database <name>` | `openldr_target` | Target database name (must already exist for BYO). |
| `--mssql-user <user>` | — | BYO SQL Server login. |
| `--mssql-password <pw>` | — | BYO SQL Server password (avoid `#`, spaces, quotes). |
| `--mssql-encrypt <bool>` | `false` | Encrypt the SQL Server connection. |
| `--mssql-trust-cert <bool>` | `true` | Trust the server's TLS certificate (self-signed on-prem). |
| `--mysql-demo` | off | Bundle a MySQL 8.4 container (evaluation only); implies `--target-db mysql`. |
| `--mysql-host <host>` | — | BYO MySQL/MariaDB host (required for `--target-db mysql` without `--mysql-demo`). |
| `--mysql-port <n>` | `3306` | BYO MySQL/MariaDB port. |
| `--mysql-database <name>` | `openldr_target` | Target database name (must already exist for BYO). |
| `--mysql-user <user>` | — | BYO MySQL/MariaDB login. |
| `--mysql-password <pw>` | — | BYO MySQL/MariaDB password (avoid `#`, spaces, quotes). |
| `--mysql-ssl <bool>` | `false` | Enable SSL/TLS for the MySQL/MariaDB connection. |

After it finishes, manage the stack from inside the `openldr/` directory:

```
docker compose ps            # status
docker compose logs -f       # follow logs
docker compose down          # stop
docker compose up -d         # start
```

See [Environment variables](/docs/environment) for the values in the generated `.env`,
or [Windows Server (WSL2)](/docs/windows-server) to deploy on Windows Server.

## Install from source (for development)

Run OpenLDR from source with the developer bootstrap. It clones the repo, installs
dependencies, starts the backing services, initializes the database, and prints how to
launch the dev servers.

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/development.sh | bash
```

**Windows (PowerShell)**
```
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/development.ps1 | iex
```

Requires git, Node.js 20+, pnpm (or Corepack), and Docker. Then start the app in two
terminals: `pnpm -C apps/server dev` and `pnpm -C apps/studio dev` (Studio UI on
http://localhost:5173).
