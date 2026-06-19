# Keycloak realm: `openldr`

`docker-compose.yml` runs Keycloak 26 (`start-dev --import-realm`) and imports
`openldr-realm.json` on first boot into the `openldr` realm.

## Bring it up

    docker compose up -d keycloak
    # Admin console: http://localhost:8180  (master realm: admin / admin)
    # App realm:     http://localhost:8180/realms/openldr

## Seeded for local dev

- Realm roles: `lab_admin`, `lab_manager`, `lab_technician`, `data_analyst`, `system_auditor`.
- `openldr-web` — public login client (PKCE S256), redirect URIs for the Vite dev
  server (5173) and the single-port app (3000).
- `openldr-api` — bearer-only audience (set `OIDC_AUDIENCE=openldr-api`).
- `openldr-admin` — confidential service-account client (client_credentials) granted
  `realm-management` roles `manage-users`/`view-users`/`query-users`/`view-realm`. Used by
  the server's identity-admin actions (password reset / force sign-out / user directory).
- `labadmin` / `labadmin` — a seed user holding `lab_admin`.

The matching app env lives in `.env.example` (`OIDC_ISSUER_URL`, `OIDC_AUDIENCE`,
`KEYCLOAK_ADMIN_CLIENT_ID`, `KEYCLOAK_ADMIN_CLIENT_SECRET`).

## ⚠️ Dev-only secrets

`openldr-admin`'s secret and `labadmin`'s password in `openldr-realm.json` are
**development values committed for convenience**. In any real deployment, rotate the
service-account secret (Keycloak admin console → Clients → openldr-admin → Credentials)
and set `KEYCLOAK_ADMIN_CLIENT_SECRET` from a secret store; never reuse the committed value.

## Regenerating the export

Export from a configured realm with:

    docker compose exec keycloak /opt/keycloak/bin/kc.sh export \
      --realm openldr --file /tmp/openldr-realm.json
    docker compose cp keycloak:/tmp/openldr-realm.json infra/keycloak/openldr-realm.json

Then re-run the structural test: `pnpm --filter @openldr/server test -- keycloak-realm`.

## Deferred: live acceptance (needs Docker; not in the automated suite)

Run these once on a machine that can start the stack:

- [ ] **Wipe any stale volume first** — `--import-realm` is silently skipped if the realm already exists from a previous run: `docker compose down -v` before the first import.
- [ ] `docker compose up -d keycloak` → `http://localhost:8180/realms/openldr/.well-known/openid-configuration` returns 200.
- [ ] **Verify the service-account role grant took effect** (the high-risk silent failure): in the admin console (or `GET /admin/realms/openldr/users?search=service-account-openldr-admin`), confirm the `openldr-admin` service account holds the `realm-management` roles `manage-users`/`view-users`/`query-users`/`view-realm`.
- [ ] Server boots with the `.env` issuer/admin creds; `GET /health` shows the `auth` check up.
- [ ] `client_credentials` token request for `openldr-admin` succeeds and can `GET /admin/realms/openldr/users`.
- [ ] SP4 actions against `labadmin`: reset-password (204), force-logout (204); send-reset-email needs realm SMTP.
- [ ] (after SP6) Users list/create/update round-trips to Keycloak.
- [ ] (after SP1b) Browser login via `openldr-web` (PKCE) signs in as `labadmin`.

> Note: `bearerOnly` on `openldr-api` works in Keycloak 26 but is soft-deprecated; revisit if upgrading to 27+.
