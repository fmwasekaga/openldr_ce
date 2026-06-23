# External Database

OpenLDR stores operational state in the internal PostgreSQL database. Flattened reporting tables live in the analytics warehouse, which can be PostgreSQL or SQL Server.

## Configuring SQL Server

Set the target store adapter to `mssql` and provide all required connection settings:

```text
TARGET_STORE_ADAPTER=mssql
MSSQL_HOST=localhost
MSSQL_PORT=11433
MSSQL_DATABASE=openldr
MSSQL_USER=sa
MSSQL_PASSWORD=Your_Strong_Password1
MSSQL_ENCRYPT=false
MSSQL_TRUST_SERVER_CERT=true
```

OpenLDR projects FHIR resources into MSSQL-compatible flat tables and bulk-loads them idempotently. No JSON/document columns are required for the core reporting tables.

## Configuring external PostgreSQL

The default adapter is `pg`; point it at an external Postgres with `TARGET_DATABASE_URL`:

```text
TARGET_STORE_ADAPTER=pg
TARGET_DATABASE_URL=postgres://user:pass@host:5432/openldr
```

## Migrating and probing

Run migrations against the external target before the first ingest:

```console
PS D:\Projects\Repositories\openldr_ce> pnpm openldr db migrate
PS D:\Projects\Repositories\openldr_ce> pnpm openldr target-store test --json
```

If `TARGET_STORE_ADAPTER=pg`, `TARGET_DATABASE_URL` is required. If `TARGET_STORE_ADAPTER=mssql`, all of `MSSQL_HOST`, `MSSQL_DATABASE`, `MSSQL_USER`, and `MSSQL_PASSWORD` are required.
