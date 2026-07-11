#!/usr/bin/env bash
# Boot each supported MySQL/MariaDB engine in an isolated container, create the target DB, run
# the live acceptance against it, then tear it down. Engines/ports are kept in lockstep with
# packages/adapter-mysql-store/src/supported-versions.ts (mysql:8.4, mariadb:11.4).
#
# Usage: scripts/mysql-matrix-accept.sh
# Requires: docker, pnpm. Safe to re-run (containers are removed on entry + exit).
set -uo pipefail

PW='Openldr_Local_2026!'
DB='openldr_target'
# engine:version:hostPort triples — one free port each so engines can run sequentially without conflict.
ENGINES=( "mysql:8.4:13306" "mariadb:11.4:13307" )

overall=0

for triple in "${ENGINES[@]}"; do
  engine="${triple%%:*}"
  rest="${triple#*:}"
  version="${rest%%:*}"
  port="${rest##*:}"
  name="openldr-mysql-${engine}"
  image="${engine}:${version}"

  echo ""
  echo "=================================================================="
  echo " ${image}  (host port ${port})"
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

  MYSQL_HOST=127.0.0.1 MYSQL_PORT="${port}" MYSQL_DATABASE="${DB}" \
    MYSQL_USER=root MYSQL_PASSWORD="${PW}" \
    node_modules/.bin/tsx scripts/mysql-live-acceptance.ts
  rc=$?
  if [ "${rc}" -ne 0 ]; then
    echo "  ❌ acceptance FAILED on ${image} (exit ${rc})"
    overall=1
  else
    echo "  ✅ acceptance PASSED on ${image}"
  fi

  docker rm -f "${name}" >/dev/null 2>&1 || true
done

echo ""
if [ "${overall}" -eq 0 ]; then
  echo "✅ MySQL matrix PASSED (mysql 8.4 + mariadb 11.4)"
else
  echo "❌ MySQL matrix FAILED — see above"
fi
exit "${overall}"
