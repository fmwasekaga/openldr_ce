#!/usr/bin/env bash
# Boot each supported SQL Server version in an isolated container, create the target DB,
# run the live acceptance against it, then tear it down. Versions/ports are kept in lockstep
# with packages/adapter-mssql-store/src/supported-versions.ts (2017/2019/2022).
#
# Usage: scripts/mssql-matrix-accept.sh
# Requires: docker, pnpm. Safe to re-run (containers are removed on entry + exit).
set -uo pipefail

PW='Openldr_Local_2026!'
DB='openldr_target'
# major:hostPort pairs — one free port each so versions can run sequentially without conflict.
VERSIONS=( "2017:11417" "2019:11419" "2022:11422" )

overall=0

for pair in "${VERSIONS[@]}"; do
  major="${pair%%:*}"
  port="${pair##*:}"
  name="openldr-mssql-${major}"
  image="mcr.microsoft.com/mssql/server:${major}-latest"

  echo ""
  echo "=================================================================="
  echo " SQL Server ${major}  (image ${image}, host port ${port})"
  echo "=================================================================="

  docker rm -f "${name}" >/dev/null 2>&1 || true
  docker run -d --name "${name}" -e ACCEPT_EULA=Y \
    -e "MSSQL_SA_PASSWORD=${PW}" -p "${port}:1433" "${image}" >/dev/null

  # Wait for the server to accept connections (up to ~90s).
  echo "  waiting for SQL Server ${major} to become ready..."
  ready=0
  for _ in $(seq 1 45); do
    if MSYS_NO_PATHCONV=1 docker exec "${name}" /opt/mssql-tools18/bin/sqlcmd \
         -S localhost -U sa -P "${PW}" -C -Q "SELECT 1" >/dev/null 2>&1; then
      ready=1; break
    fi
    sleep 2
  done
  if [ "${ready}" -ne 1 ]; then
    echo "  ❌ SQL Server ${major} did not become ready — skipping"
    docker logs --tail 20 "${name}" || true
    docker rm -f "${name}" >/dev/null 2>&1 || true
    overall=1
    continue
  fi

  MSYS_NO_PATHCONV=1 docker exec "${name}" /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P "${PW}" -C -Q "IF DB_ID('${DB}') IS NULL CREATE DATABASE ${DB};"

  # MSSQL_ACCEPT_TARGET_ONLY=1 skips the app-context/reporting step (step 4) so the matrix
  # runner needs only Docker + a SQL Server container — no internal Postgres / S3 / Keycloak.
  MSSQL_HOST=localhost MSSQL_PORT="${port}" MSSQL_DATABASE="${DB}" \
    MSSQL_USER=sa MSSQL_PASSWORD="${PW}" MSSQL_ACCEPT_TARGET_ONLY=1 \
    pnpm mssql:accept
  rc=$?
  if [ "${rc}" -ne 0 ]; then
    echo "  ❌ acceptance FAILED on SQL Server ${major} (exit ${rc})"
    overall=1
  else
    echo "  ✅ acceptance PASSED on SQL Server ${major}"
  fi

  docker rm -f "${name}" >/dev/null 2>&1 || true
done

echo ""
if [ "${overall}" -eq 0 ]; then
  echo "✅ MSSQL matrix acceptance PASSED for all supported versions (2017/2019/2022)"
else
  echo "❌ MSSQL matrix acceptance had FAILURES — see above"
fi
exit "${overall}"
