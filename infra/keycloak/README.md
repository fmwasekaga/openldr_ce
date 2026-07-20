# Keycloak realm: `openldr`

`docker-compose.yml` (local dev) runs Keycloak 26 (`start-dev --import-realm`) on the throwaway H2
database and imports `openldr-realm.json` on first boot into the `openldr` realm.

**Production** (`docker-compose.prod.yml` / the installers) instead runs `start --import-realm`
(production mode) and persists to a **`keycloak` database inside the same internal Postgres** the app
uses — there is no second Postgres. That database is created on first Postgres init by
`scripts/init-keycloak-db.sql` (alongside `openldr_target`), and Keycloak connects as the `openldr` role
with `POSTGRES_PASSWORD` (`KC_DB`/`KC_DB_URL`/`KC_DB_USERNAME`/`KC_DB_PASSWORD`). Upgrading a stack whose
Postgres volume predates this change? The first-init script won't re-run, so create the DB once by hand:
`docker compose exec postgres psql -U openldr -d openldr -c 'CREATE DATABASE keycloak OWNER openldr;'`
then restart Keycloak. The stock image auto-builds for Postgres on the first `start` (no `--optimized`).

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
- `labadmin` / `labadmin` — a seed user holding `lab_admin`. The password is marked **temporary**, so
  the first sign-in forces a password change. The installers (`install.sh` / `install.ps1`) and the
  `pnpm run init` wizard replace it with a generated per-install password (surfaced once at the end of
  the run) before the realm is imported.

The matching app env lives in `.env.example` (`OIDC_ISSUER_URL`, `OIDC_AUDIENCE`,
`KEYCLOAK_ADMIN_CLIENT_ID`, `KEYCLOAK_ADMIN_CLIENT_SECRET`).

## ⚠️ Dev-only secrets

`openldr-admin`'s secret and `labadmin`'s password in `openldr-realm.json` are
**development values committed for convenience**. The installers and `pnpm run init` rotate BOTH to
per-install values before importing the realm, and `labadmin`'s password is marked temporary so it must
be changed on first login. If you import this realm **manually** (raw `docker compose up` with the
committed file), rotate the service-account secret (Keycloak admin console → Clients → openldr-admin →
Credentials), set `KEYCLOAK_ADMIN_CLIENT_SECRET` from a secret store, and change `labadmin`'s password;
never reuse the committed values.

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
- [ ] **(SP1b) Browser login end-to-end** — with `AUTH_DEV_BYPASS` OFF + the realm up + the web dev server: loading the app redirects to Keycloak; sign in as `labadmin`/`labadmin`; it lands back via `/auth/callback`; `/api/me` resolves; subsequent API calls carry the bearer; the token silently renews; sign-out (shell header) ends the session; the ontology build/rebuild SSE streams (token via `?access_token=`, redacted in logs).
- [ ] **(SP1b) Dev-bypass unchanged** — with `AUTH_DEV_BYPASS` ON: no redirect; the app works anonymously (dev actor); existing Playwright e2e pass.
- [ ] **(SP1b) Fail-closed** — stop Keycloak (or break `OIDC_ISSUER_URL`) with auth enforced: the app shows the "Cannot reach the server" card (it does NOT silently fall through to anonymous).

> Note: `bearerOnly` on `openldr-api` works in Keycloak 26 but is soft-deprecated; revisit if upgrading to 27+.
