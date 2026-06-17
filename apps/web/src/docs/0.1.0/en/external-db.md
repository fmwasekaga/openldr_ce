# External Database

By default OpenLDR stores flattened reporting tables in its internal PostgreSQL database. You can point the reporting warehouse at an external **PostgreSQL** or **SQL Server** instead via the `TARGET_STORE_ADAPTER` setting.

## Configuring SQL Server

Set the target store adapter to `mssql` and the connection in your environment:

```
TARGET_STORE_ADAPTER=mssql
MSSQL_HOST=localhost
MSSQL_PORT=11433
MSSQL_DATABASE=openldr
MSSQL_USER=sa
MSSQL_PASSWORD=Your_Strong_Password1
```

OpenLDR projects FHIR resources into MSSQL-compatible flat tables and bulk-loads them idempotently. No JSON/document columns are required — the data is fully flattened.

## Configuring external PostgreSQL

The default adapter is `pg`; point it at an external Postgres with `TARGET_DATABASE_URL`:

```
TARGET_STORE_ADAPTER=pg
TARGET_DATABASE_URL=postgres://user:pass@host:5432/openldr
```

## Migrating the schema

Run migrations against the external target before the first ingest:

```
pnpm openldr db migrate
```

You can probe the connection first with `pnpm openldr target-store test`.
