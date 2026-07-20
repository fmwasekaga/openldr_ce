-- Keycloak's own database, created inside the SAME internal Postgres instance the app uses (no second
-- Postgres container). Runs once, on first initialization of an empty pgdata volume, via the postgres
-- image's /docker-entrypoint-initdb.d hook — the same mechanism that creates openldr_target. Keycloak
-- connects as the `openldr` role with POSTGRES_PASSWORD and owns this database.
--
-- Existing deployment (pgdata already initialized, so this script will NOT re-run)? Create it once by
-- hand, then restart Keycloak:
--   docker compose exec postgres psql -U openldr -d openldr -c 'CREATE DATABASE keycloak OWNER openldr;'
CREATE DATABASE keycloak OWNER openldr;
