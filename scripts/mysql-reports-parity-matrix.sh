#!/usr/bin/env bash
# Boot a Postgres reference container + each supported MySQL/MariaDB engine in an isolated
# container, run the pg-vs-<engine> report parity harness against the pair, then tear down. Engine
# versions are kept in lockstep with packages/adapter-mysql-store/src/supported-versions.ts
# (mysql:8.4, mariadb:11.4), mirroring scripts/mysql-matrix-accept.sh's container lifecycle.
#
# Usage: scripts/mysql-reports-parity-matrix.sh
# Requires: docker, pnpm. Safe to re-run (containers are removed on entry + exit).
set -uo pipefail

PG_PW='openldr'
PG_DB='openldr_target'
PG_PORT=5544
PG_NAME='openldr-parity-pg'

PW='Openldr_Local_2026'
DB='openldr_target'
# engine:version:hostPort triples — one free port each so engines can run sequentially without conflict.
ENGINES=( "mysql:8.4:13306" "mariadb:11.4:13306" )

overall=0

echo ""
echo "=================================================================="
echo " postgres:16  (reference, host port ${PG_PORT})"
echo "=================================================================="

docker rm -f "${PG_NAME}" >/dev/null 2>&1 || true
if ! docker run -d --name "${PG_NAME}" \
     -e "POSTGRES_PASSWORD=${PG_PW}" -e "POSTGRES_DB=${PG_DB}" \
     -p "${PG_PORT}:5432" postgres:16 >/dev/null; then
  echo "  ❌ docker run failed for postgres:16 (image pull / port ${PG_PORT} in use / daemon?) — aborting"
  exit 1
fi

echo "  waiting for postgres:16 to become ready..."
ready=0
for _ in $(seq 1 40); do
  if docker exec "${PG_NAME}" pg_isready -U postgres >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 3
done
if [ "${ready}" -ne 1 ]; then
  echo "  ❌ postgres:16 did not become ready — aborting"
  docker logs --tail 30 "${PG_NAME}" || true
  docker rm -f "${PG_NAME}" >/dev/null 2>&1 || true
  exit 1
fi

for triple in "${ENGINES[@]}"; do
  engine="${triple%%:*}"
  rest="${triple#*:}"
  version="${rest%%:*}"
  port="${rest##*:}"
  name="openldr-mysql-${engine}"
  image="${engine}:${version}"

  echo ""
  echo "=================================================================="
  echo " ${image}  (host port ${port})  vs  postgres:16"
  echo "=================================================================="

  docker rm -f "${name}" >/dev/null 2>&1 || true
  if ! docker run -d --name "${name}" \
       -e "MYSQL_ROOT_PASSWORD=${PW}" -e "MARIADB_ROOT_PASSWORD=${PW}" \
       -p "${port}:3306" "${image}" >/dev/null; then
    echo "  ❌ docker run failed for ${image} (image pull / port ${port} in use / daemon?) — skipping"
    overall=1
    continue
  fi

  # Wait for the server to accept connections. MySQL 8.4's first-start init (generating the data
  # dir, applying grants) can take 30-60s+; the mariadb image is usually faster. ~40 tries * 3s
  # gives ~2 minutes of headroom. The mariadb image's client binary is `mariadb` (with `mysql` kept
  # as a deprecated-but-working symlink in some tags) — try `mysql` first, fall back to `mariadb`.
  echo "  waiting for ${image} to become ready..."
  ready=0
  for _ in $(seq 1 40); do
    if docker exec "${name}" sh -c "mysql -uroot -p'${PW}' -e 'select 1' >/dev/null 2>&1 || mariadb -uroot -p'${PW}' -e 'select 1' >/dev/null 2>&1"; then
      ready=1; break
    fi
    sleep 3
  done
  if [ "${ready}" -ne 1 ]; then
    echo "  ❌ ${image} did not become ready — skipping"
    docker logs --tail 30 "${name}" || true
    docker rm -f "${name}" >/dev/null 2>&1 || true
    overall=1
    continue
  fi

  docker exec "${name}" sh -c "mysql -uroot -p'${PW}' -e 'create database if not exists ${DB}' 2>/dev/null || mariadb -uroot -p'${PW}' -e 'create database if not exists ${DB}'"

  TARGET_DATABASE_URL="postgresql://postgres:${PG_PW}@localhost:${PG_PORT}/${PG_DB}" \
    MYSQL_HOST=127.0.0.1 MYSQL_PORT="${port}" MYSQL_DATABASE="${DB}" \
    MYSQL_USER=root MYSQL_PASSWORD="${PW}" \
    node_modules/.bin/tsx scripts/mysql-reports-parity.ts
  rc=$?
  if [ "${rc}" -ne 0 ]; then
    echo "  ❌ parity FAILED on ${image} (exit ${rc})"
    overall=1
  else
    echo "  ✅ parity PASSED on ${image}"
  fi

  docker rm -f "${name}" >/dev/null 2>&1 || true
done

docker rm -f "${PG_NAME}" >/dev/null 2>&1 || true

echo ""
if [ "${overall}" -eq 0 ]; then
  echo "✅ MySQL report-parity matrix PASSED (mysql 8.4 + mariadb 11.4 vs postgres 16)"
else
  echo "❌ MySQL report-parity matrix FAILED — see above"
fi
exit "${overall}"
