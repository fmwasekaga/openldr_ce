# SP5 — Keycloak Realm Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision a self-contained `openldr` Keycloak realm the stack actually uses — app roles, a web login client, a user-management service-account client, and a seed admin — imported on container start, with compose + env wired and a structural test that validates the realm export without a running container.

**Architecture:** A committed `infra/keycloak/openldr-realm.json` is imported via `keycloak … start-dev --import-realm`. `docker-compose.yml` mounts it; `.env.example` points the app at `…/realms/openldr` and supplies the admin service-account creds (consumed by SP4 / SP6). A Vitest structural test parses the JSON and asserts the required realm/roles/clients/service-account/seed-user are present — the automated gate, since bringing the container up is a manual/CI step.

**Tech Stack:** Keycloak 26.0, Docker Compose, JSON, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-19-sp5-sp6-keycloak-realm-and-decoupled-users-design.md` (Phase A).

**Conventions:** pnpm + turbo. The structural test runs in `@openldr/server` (the app that uses the realm), reading the repo-root file. Full gate: `pnpm turbo typecheck lint test build`. Commit after each task.

**Constraint:** The author/operator cannot run Docker/Keycloak right now. Every step here is verifiable by reading files + running the Vitest structural test + `pnpm turbo` — no running container required. Bringing Keycloak up and a live login is a DEFERRED manual step (Task 5 documents the checklist).

**Verified facts:**
- `docker-compose.yml` keycloak service: `image: quay.io/keycloak/keycloak:26.0`, `command: start-dev`, `KC_BOOTSTRAP_ADMIN_USERNAME/PASSWORD: admin`, host port `8180:8080`. `docker-compose.override.yml` remaps ports for the sibling corlix stack.
- `.env.example` has `OIDC_ISSUER_URL=http://localhost:8180/realms/master`.
- App roles (`USER_ROLES`): `lab_admin`, `lab_manager`, `lab_technician`, `data_analyst`, `system_auditor`.
- Config already accepts `OIDC_AUDIENCE`, `KEYCLOAK_ADMIN_CLIENT_ID`, `KEYCLOAK_ADMIN_CLIENT_SECRET` (SP4).

---

## File Structure

- `infra/keycloak/openldr-realm.json` — the realm export (create)
- `infra/keycloak/README.md` — bring-up + seed creds + regenerate notes (create)
- `apps/server/src/keycloak-realm.test.ts` — structural validation of the export (create)
- `docker-compose.yml` — keycloak: import the realm (modify)
- `.env.example` — issuer → openldr realm + admin creds (modify)

---

## Task 1: Realm export + structural validation test

**Files:**
- Create: `infra/keycloak/openldr-realm.json`
- Create: `apps/server/src/keycloak-realm.test.ts`

- [ ] **Step 1: Write the failing structural test** — create `apps/server/src/keycloak-realm.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const realmPath = resolve(here, '../../../infra/keycloak/openldr-realm.json');

interface RealmRole { name: string }
interface RealmClient { clientId: string; publicClient?: boolean; serviceAccountsEnabled?: boolean; secret?: string }
interface RealmUser { username: string; realmRoles?: string[]; credentials?: { type: string }[]; serviceAccountClientId?: string }
interface Realm {
  realm: string; enabled: boolean;
  roles: { realm: RealmRole[] };
  clients: RealmClient[];
  users: RealmUser[];
}

const APP_ROLES = ['lab_admin', 'lab_manager', 'lab_technician', 'data_analyst', 'system_auditor'];

describe('openldr realm export', () => {
  const realm = JSON.parse(readFileSync(realmPath, 'utf8')) as Realm;

  it('declares the openldr realm, enabled', () => {
    expect(realm.realm).toBe('openldr');
    expect(realm.enabled).toBe(true);
  });

  it('defines all app realm roles', () => {
    const names = realm.roles.realm.map((r) => r.name);
    for (const role of APP_ROLES) expect(names).toContain(role);
  });

  it('has a public web login client with PKCE + redirect URIs', () => {
    const web = realm.clients.find((c) => c.clientId === 'openldr-web');
    expect(web).toBeTruthy();
    expect(web!.publicClient).toBe(true);
    const raw = JSON.stringify(web);
    expect(raw).toContain('pkce'); // pkce.code.challenge.method attribute present
    expect(raw).toContain('redirectUris');
  });

  it('has a confidential admin service-account client with user-management roles', () => {
    const admin = realm.clients.find((c) => c.clientId === 'openldr-admin');
    expect(admin).toBeTruthy();
    expect(admin!.serviceAccountsEnabled).toBe(true);
    expect(typeof admin!.secret).toBe('string');
    // realm-management client roles must be granted to the service account
    const raw = JSON.stringify(realm);
    expect(raw).toContain('manage-users');
    expect(raw).toContain('view-users');
  });

  it('seeds a labadmin user holding lab_admin with a password credential', () => {
    const u = realm.users.find((x) => x.username === 'labadmin');
    expect(u).toBeTruthy();
    expect(u!.realmRoles).toContain('lab_admin');
    expect(u!.credentials?.some((c) => c.type === 'password')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (file missing → JSON.parse throws)

Run: `pnpm --filter @openldr/server test -- keycloak-realm`
Expected: FAIL (cannot read `openldr-realm.json`).

- [ ] **Step 3: Create the realm export** — create `infra/keycloak/openldr-realm.json` with this exact content (Keycloak 26 import format; the `openldr-admin` service account is granted the `realm-management` roles via `scopeMappings`/`clientScopeMappings` — Keycloak resolves the service-account user's client-role grants on import through `clients[].serviceAccountClientId` + a service-account user entry):

```json
{
  "realm": "openldr",
  "enabled": true,
  "sslRequired": "external",
  "registrationAllowed": false,
  "loginWithEmailAllowed": true,
  "roles": {
    "realm": [
      { "name": "lab_admin", "description": "Lab administrator" },
      { "name": "lab_manager", "description": "Lab manager" },
      { "name": "lab_technician", "description": "Lab technician" },
      { "name": "data_analyst", "description": "Data analyst" },
      { "name": "system_auditor", "description": "System auditor" }
    ]
  },
  "clients": [
    {
      "clientId": "openldr-web",
      "name": "OpenLDR Web",
      "enabled": true,
      "publicClient": true,
      "standardFlowEnabled": true,
      "directAccessGrantsEnabled": false,
      "redirectUris": ["http://localhost:5173/*", "http://localhost:3000/*", "http://localhost:8180/*"],
      "webOrigins": ["+"],
      "attributes": { "pkce.code.challenge.method": "S256" }
    },
    {
      "clientId": "openldr-api",
      "name": "OpenLDR API audience",
      "enabled": true,
      "bearerOnly": true
    },
    {
      "clientId": "openldr-admin",
      "name": "OpenLDR Admin (service account)",
      "enabled": true,
      "publicClient": false,
      "serviceAccountsEnabled": true,
      "standardFlowEnabled": false,
      "secret": "openldr-admin-dev-secret",
      "attributes": { "use.refresh.tokens": "false" }
    }
  ],
  "users": [
    {
      "username": "labadmin",
      "enabled": true,
      "emailVerified": true,
      "email": "labadmin@openldr.local",
      "firstName": "Lab",
      "lastName": "Admin",
      "credentials": [{ "type": "password", "value": "labadmin", "temporary": false }],
      "realmRoles": ["lab_admin"]
    },
    {
      "username": "service-account-openldr-admin",
      "enabled": true,
      "serviceAccountClientId": "openldr-admin",
      "clientRoles": {
        "realm-management": ["manage-users", "view-users", "query-users", "view-realm"]
      }
    }
  ]
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @openldr/server test -- keycloak-realm`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add infra/keycloak/openldr-realm.json apps/server/src/keycloak-realm.test.ts
git commit -m "feat(keycloak): openldr realm export (roles, web + admin clients, seed admin) + structural test"
```

---

## Task 2: Import the realm in docker-compose

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Mount the realm + import it**

In `docker-compose.yml`, update the `keycloak` service so it imports the realm on start. Change the `command` and add a volume (keep the image, bootstrap-admin env, and the `8180:8080` port):

```yaml
  keycloak:
    image: quay.io/keycloak/keycloak:26.0
    command: start-dev --import-realm
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
    volumes:
      - ./infra/keycloak/openldr-realm.json:/opt/keycloak/data/import/openldr-realm.json:ro
    ports:
      - "8180:8080"
```

- [ ] **Step 2: Validate compose syntax (no container needed)**

Run: `docker compose config >/dev/null && echo OK` (if Docker CLI is unavailable in this environment, SKIP and instead verify by reading the file: the `volumes:` maps the repo path to `/opt/keycloak/data/import/…` and `command` ends with `--import-realm`).
Expected: `OK`, or a confirmed manual read.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(keycloak): import the openldr realm on container start"
```

---

## Task 3: Point the app env at the openldr realm

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Update the env example**

In `.env.example`, change the OIDC issuer and add the audience + admin client creds (matching the realm export's `openldr-admin` secret):

```ini
OIDC_ISSUER_URL=http://localhost:8180/realms/openldr
OIDC_AUDIENCE=openldr-api
KEYCLOAK_ADMIN_CLIENT_ID=openldr-admin
KEYCLOAK_ADMIN_CLIENT_SECRET=openldr-admin-dev-secret
```

(Replace the existing `OIDC_ISSUER_URL=…/realms/master` line; add the three new lines near it.)

- [ ] **Step 2: Verify**

Run: `grep -nE "OIDC_ISSUER_URL|OIDC_AUDIENCE|KEYCLOAK_ADMIN_CLIENT" .env.example`
Expected: the four lines above, issuer pointing at `/realms/openldr`, secret matching `infra/keycloak/openldr-realm.json`.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "feat(config): point .env.example at the openldr realm + admin client"
```

---

## Task 4: Keycloak README (bring-up + seed creds + security note)

**Files:**
- Create: `infra/keycloak/README.md`

- [ ] **Step 1: Write the README** — create `infra/keycloak/README.md`:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add infra/keycloak/README.md
git commit -m "docs(keycloak): realm bring-up, seed creds, dev-secret note, regen steps"
```

---

## Task 5: Gate + deferred live-acceptance checklist

**Files:**
- (no code) — verification + a committed manual checklist appended to `infra/keycloak/README.md`

- [ ] **Step 1: Full gate (automated, no container)**

Run: `pnpm turbo typecheck lint test build`
Expected: all PASS (the new structural test runs under `@openldr/server`).

- [ ] **Step 2: depcruise**

Run: `pnpm depcruise`
Expected: no violations (no source-graph change — only JSON/yaml/env/test added).

- [ ] **Step 3: Append the DEFERRED live-acceptance checklist to `infra/keycloak/README.md`**

Append this section (it documents what must be verified once a machine with Docker is available — explicitly out of the automated suite):

```markdown
## Deferred: live acceptance (needs Docker; not in the automated suite)

Run these once on a machine that can start the stack:

- [ ] `docker compose up -d keycloak` → `…/realms/openldr/.well-known/openid-configuration` returns 200.
- [ ] Server boots with the `.env` issuer/admin creds; `GET /health` shows the `auth` check up.
- [ ] `client_credentials` token request for `openldr-admin` succeeds and can `GET /admin/realms/openldr/users`.
- [ ] SP4 actions against `labadmin`: reset-password (204), force-logout (204); send-reset-email needs realm SMTP.
- [ ] (after SP6) Users list/create/update round-trips to Keycloak.
- [ ] (after SP1b) Browser login via `openldr-web` (PKCE) signs in as `labadmin`.
```

- [ ] **Step 4: Commit**

```bash
git add infra/keycloak/README.md
git commit -m "docs(keycloak): deferred live-acceptance checklist"
```

---

## Self-Review notes (coverage vs spec Phase A)

- Spec A1 realm export (roles, web client, api audience, admin service account, seed admin) → Task 1 (+ structural test as the automated gate).
- A2 compose `--import-realm` + volume → Task 2. A3 `.env.example` issuer/audience/admin creds → Task 3. A4 README (bring-up, seed creds, dev-secret note, regen) → Task 4.
- Deferred live acceptance documented → Task 5.
- No-placeholder: the realm JSON + README + env are complete literal content; the structural test asserts the spec's required pieces. The only environment-dependent step (`docker compose config`) has a read-only fallback for the no-Docker constraint.
- SP6 (decoupled user model) is intentionally a SEPARATE plan, authored next against this concrete realm.
