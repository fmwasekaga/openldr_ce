# OIDC Internal Back-Channel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the api reach Keycloak's token + admin (+ JWKS) endpoints over the internal docker network so site enrollment and identity-admin actions work in the containerized production topology.

**Architecture:** Add one optional config var `OIDC_INTERNAL_ISSUER_URL` (internal realm base). `adapter-auth` derives the token endpoint, admin REST base, and (when no explicit `OIDC_INTERNAL_JWKS_URL`) the JWKS URL from it, falling back to the public `OIDC_ISSUER_URL` when unset. Token **validation** (`verifyToken`'s `issuer`) stays on the public issuer — unchanged — so login is unaffected. The installer writes the new var plus the two `KEYCLOAK_ADMIN_CLIENT_*` vars.

**Tech Stack:** TypeScript, Zod (`@openldr/config`), Vitest, Fastify (`@openldr/bootstrap`/server), Keycloak, Docker/compose, bash + PowerShell installers.

**Spec:** `docs/superpowers/specs/2026-07-19-oidc-internal-issuer-url-design.md`

**Working tree:** worktree `D:\Projects\openldr-oidc-internal`, branch `claude/oidc-internal-issuer`.

---

## File Structure

- `packages/adapter-auth/src/index.ts` — add `internalIssuerUrl` to `AuthConfig`; derive back-channel endpoints. (Task 1)
- `packages/adapter-auth/src/index.test.ts` — new tests for internal routing + iss invariant. (Task 1)
- `packages/config/src/schema.ts` — add `OIDC_INTERNAL_ISSUER_URL`. (Task 2)
- `packages/config/src/schema.test.ts` — parse test. (Task 2)
- `packages/bootstrap/src/index.ts` — pass the var into `createAuth`. (Task 3)
- `install/install.sh` + `install/install.ps1` — write the three env lines. (Task 4)
- Live acceptance against the laptop production stack. (Task 5)

---

## Task 1: adapter-auth — internal back-channel for token/admin/JWKS

**Files:**
- Modify: `packages/adapter-auth/src/index.ts` (`AuthConfig` ~L6-15; `createAuth` body ~L32-61; `getKeySet` L40-57; `healthCheck` L119-136)
- Test: `packages/adapter-auth/src/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Append these four tests to `packages/adapter-auth/src/index.test.ts` (the `adminFetchMock` helper is defined at the bottom of the file; `localKeySet` at L40):

```ts
describe('internal issuer back-channel', () => {
  it('routes admin token + admin REST to internalIssuerUrl when set', async () => {
    const { calls, fetchFn } = adminFetchMock();
    const auth = createAuth(
      { issuerUrl: 'https://public/realms/openldr', internalIssuerUrl: 'http://kc:8080/realms/openldr', adminClientId: 'svc', adminClientSecret: 'sek' },
      { fetchFn },
    );
    await auth.resetPassword('u1', 'pw', true);
    const token = calls.find((c) => c.url.endsWith('/protocol/openid-connect/token'))!;
    expect(token.url).toBe('http://kc:8080/realms/openldr/protocol/openid-connect/token');
    const reset = calls.find((c) => c.url.includes('/reset-password'))!;
    expect(reset.url).toBe('http://kc:8080/admin/realms/openldr/users/u1/reset-password');
  });

  it('routes admin calls to the public issuerUrl when internalIssuerUrl is absent', async () => {
    const { calls, fetchFn } = adminFetchMock();
    const auth = createAuth(adminCfg, { fetchFn });
    await auth.resetPassword('u1', 'pw', true);
    const token = calls.find((c) => c.url.endsWith('/protocol/openid-connect/token'))!;
    expect(token.url).toBe('https://kc/realms/openldr/protocol/openid-connect/token');
    const reset = calls.find((c) => c.url.includes('/reset-password'))!;
    expect(reset.url).toBe('https://kc/admin/realms/openldr/users/u1/reset-password');
  });

  it('healthCheck derives the JWKS url from internalIssuerUrl when no explicit internalJwksUrl', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    const auth = createAuth({ issuerUrl: 'https://public/realms/openldr', internalIssuerUrl: 'http://kc:8080/realms/openldr' }, { fetchFn });
    const r = await auth.healthCheck();
    expect(r.status).toBe('up');
    expect(r.detail).toContain('internal');
    expect(fetchFn).toHaveBeenCalledWith('http://kc:8080/realms/openldr/protocol/openid-connect/certs', expect.anything());
    expect(fetchFn).not.toHaveBeenCalledWith(expect.stringContaining('.well-known'), expect.anything());
  });

  it('verifyToken still validates against the PUBLIC issuer even when internalIssuerUrl differs', async () => {
    const { sign, keySet } = await localKeySet();
    const auth = createAuth(
      { issuerUrl: 'https://kc/realms/openldr', internalIssuerUrl: 'http://kc:8080/realms/openldr' },
      { keySet },
    );
    const token = await sign({ preferred_username: 'ada' }, { iss: 'https://kc/realms/openldr' });
    const claims = await auth.verifyToken(token);
    expect(claims.sub).toBe('user-123');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/adapter-auth test -- --run`
Expected: the first three FAIL (`internalIssuerUrl` not honored — admin URLs still built from the public issuer; healthCheck probes discovery). The fourth may already pass (it pins the invariant).

- [ ] **Step 3: Add `internalIssuerUrl` to `AuthConfig`**

In `packages/adapter-auth/src/index.ts`, inside `interface AuthConfig` (after `internalJwksUrl?: string;` ~L14):

```ts
  /** Internal (back-channel) realm base URL, e.g. http://keycloak:8080/auth/realms/openldr.
   *  When set, the token endpoint, admin REST base, and (absent an explicit internalJwksUrl)
   *  the JWKS URL are derived from it instead of the public issuer. The issuer CLAIM is still
   *  validated against issuerUrl. */
  internalIssuerUrl?: string;
```

- [ ] **Step 4: Derive the back-channel base + effective JWKS url**

In `createAuth`, immediately after `const discoveryUrl = ...` (L35), add:

```ts
  // Server-side calls to Keycloak (token, admin REST, JWKS) must use the internal docker-network
  // URL when configured — the public issuer resolves to the app container itself. Token CLAIM
  // validation still uses the public issuerUrl (see verifyToken).
  const backChannelIssuer = cfg.internalIssuerUrl ?? cfg.issuerUrl;
  const internalJwksUrl = cfg.internalJwksUrl
    ?? (cfg.internalIssuerUrl ? `${cfg.internalIssuerUrl}/protocol/openid-connect/certs` : undefined);
```

Then change the token/admin derivations (L59-60) from `cfg.issuerUrl` to `backChannelIssuer`:

```ts
  const tokenEndpoint = `${backChannelIssuer}/protocol/openid-connect/token`;
  const adminBase = backChannelIssuer.replace('/realms/', '/admin/realms/');
```

- [ ] **Step 5: Point JWKS + health-probe + admin guard at the derived values**

Three edits in the same file:

1. `getKeySet` (L43-44): replace `cfg.internalJwksUrl` with the local `internalJwksUrl`:
```ts
        if (internalJwksUrl) {
          return jwksFactory(new URL(internalJwksUrl));
        }
```

2. `healthCheck` (L128, L130-131): replace the three `cfg.internalJwksUrl` references with `internalJwksUrl`:
```ts
          const probeUrl = internalJwksUrl ?? discoveryUrl;
          const res = await fetchFn(probeUrl, { signal: controller.signal });
          if (!res.ok) throw new Error(`OIDC ${internalJwksUrl ? 'JWKS' : 'discovery'} returned ${res.status}`);
          return internalJwksUrl ? 'OIDC JWKS reachable (internal)' : 'OIDC issuer reachable';
```

3. `adminFetchRaw` guard (L82): validate the base actually used for admin:
```ts
    if (!backChannelIssuer.includes('/realms/')) {
      throw new Error('OIDC_ISSUER_URL/OIDC_INTERNAL_ISSUER_URL must be a Keycloak realm URL (containing /realms/) to use identity-admin actions');
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @openldr/adapter-auth test -- --run`
Expected: PASS (all new tests + the existing suite green — the pre-existing internalJwksUrl and verifyToken tests must still pass, proving back-compat).

- [ ] **Step 7: Typecheck the package**

Run: `pnpm --filter @openldr/adapter-auth typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/adapter-auth/src/index.ts packages/adapter-auth/src/index.test.ts
git commit -m "feat(auth): derive token/admin/JWKS from OIDC internal issuer URL"
```

---

## Task 2: config — add `OIDC_INTERNAL_ISSUER_URL`

**Files:**
- Modify: `packages/config/src/schema.ts` (~L70, beside `OIDC_INTERNAL_JWKS_URL`)
- Test: `packages/config/src/schema.test.ts` (mirror the `KEYCLOAK_ADMIN_CLIENT_*` test ~L91-97)

- [ ] **Step 1: Write the failing test**

Add to `packages/config/src/schema.test.ts` (uses the existing `base` fixture the other tests use):

```ts
  it('accepts OIDC_INTERNAL_ISSUER_URL and defaults it to undefined', () => {
    const withVal = ConfigSchema.parse({ ...base, OIDC_INTERNAL_ISSUER_URL: 'http://keycloak:8080/auth/realms/openldr' });
    expect(withVal.OIDC_INTERNAL_ISSUER_URL).toBe('http://keycloak:8080/auth/realms/openldr');
    const without = ConfigSchema.parse({ ...base });
    expect(without.OIDC_INTERNAL_ISSUER_URL).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/config test -- --run`
Expected: FAIL — `OIDC_INTERNAL_ISSUER_URL` is not a known key (parsed value is `undefined` even when provided).

- [ ] **Step 3: Add the schema field**

In `packages/config/src/schema.ts`, immediately after the `OIDC_INTERNAL_JWKS_URL` line (L70):

```ts
    // Internal (back-channel) Keycloak realm base URL, e.g. http://keycloak:8080/auth/realms/openldr.
    // When set, server-side token/admin REST/JWKS calls use it instead of the public issuer (which,
    // inside a container, resolves to the app itself). Issuer CLAIM validation still uses OIDC_ISSUER_URL.
    OIDC_INTERNAL_ISSUER_URL: z.string().url().optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/config test -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/config/src/schema.ts packages/config/src/schema.test.ts
git commit -m "feat(config): add OIDC_INTERNAL_ISSUER_URL"
```

---

## Task 3: bootstrap — wire the var into `createAuth`

**Files:**
- Modify: `packages/bootstrap/src/index.ts:336-342` (the `createAuth({...})` call)

- [ ] **Step 1: Add the wiring line**

In the `createAuth({ ... })` object, after `internalJwksUrl: cfg.OIDC_INTERNAL_JWKS_URL,` (L339):

```ts
    internalIssuerUrl: cfg.OIDC_INTERNAL_ISSUER_URL,
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openldr/bootstrap typecheck`
Expected: no errors (the new `AuthConfig` field from Task 1 makes this assignable).

- [ ] **Step 3: Commit**

```bash
git add packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): pass OIDC_INTERNAL_ISSUER_URL to createAuth"
```

---

## Task 4: installer — write the admin-client + internal-issuer env vars

**Files:**
- Modify: `install/install.sh` (the `.env` heredoc, after L310 and after L314)
- Modify: `install/install.ps1` (the `@"..."@` here-string, after L309 and after L313)

- [ ] **Step 1: Edit `install/install.sh`**

After the `OIDC_INTERNAL_JWKS_URL=...` line (L310), add:

```
OIDC_INTERNAL_ISSUER_URL=http://keycloak:8080/auth/realms/openldr
```

After the `KEYCLOAK_ADMIN_PASSWORD=$KC_PW` line (L314), add:

```
KEYCLOAK_ADMIN_CLIENT_ID=openldr-admin
KEYCLOAK_ADMIN_CLIENT_SECRET=openldr-admin-dev-secret
```

- [ ] **Step 2: Edit `install/install.ps1`**

After the `OIDC_INTERNAL_JWKS_URL=...` line (L309), add:

```
OIDC_INTERNAL_ISSUER_URL=http://keycloak:8080/auth/realms/openldr
```

After the `KEYCLOAK_ADMIN_PASSWORD=$kc` line (L313), add:

```
KEYCLOAK_ADMIN_CLIENT_ID=openldr-admin
KEYCLOAK_ADMIN_CLIENT_SECRET=openldr-admin-dev-secret
```

- [ ] **Step 3: Verify both installers contain the three keys**

Run:
```bash
grep -nE 'OIDC_INTERNAL_ISSUER_URL|KEYCLOAK_ADMIN_CLIENT_ID|KEYCLOAK_ADMIN_CLIENT_SECRET' install/install.sh install/install.ps1
```
Expected: three matches in each file (6 total).

- [ ] **Step 4: Commit**

```bash
git add install/install.sh install/install.ps1
git commit -m "fix(install): wire KEYCLOAK_ADMIN_CLIENT_* + OIDC_INTERNAL_ISSUER_URL into .env"
```

---

## Task 5: Live acceptance — build api image, redeploy, enroll returns 200

This runs against the laptop production stack (`D:\Downloads\openldr`, compose project `openldr-de68886f`). Its `.env` already has the two `KEYCLOAK_ADMIN_CLIENT_*` vars from earlier diagnosis; this task adds `OIDC_INTERNAL_ISSUER_URL` and the rebuilt image.

- [ ] **Step 1: Build the api image locally (amd64, no push)**

From the worktree root:
```bash
docker buildx build --platform linux/amd64 --load -f apps/server/Dockerfile -t ghcr.io/open-laboratory-data-repository/openldr-api:oidc-fix-test .
```
Expected: build succeeds, image loaded. (If buildx errors with "short read/unexpected EOF": `docker builder prune -af` then rebuild.)

- [ ] **Step 2: Point the deployed stack at the test image + set the internal issuer**

```bash
ENV=/d/Downloads/openldr/.env
grep -q '^OPENLDR_VERSION=oidc-fix-test' "$ENV" || sed -i 's/^OPENLDR_VERSION=.*/OPENLDR_VERSION=oidc-fix-test/' "$ENV"
grep -q '^OIDC_INTERNAL_ISSUER_URL=' "$ENV" || printf 'OIDC_INTERNAL_ISSUER_URL=http://keycloak:8080/auth/realms/openldr\n' >> "$ENV"
docker compose --project-directory /d/Downloads/openldr -f /d/Downloads/openldr/docker-compose.yml up -d api
```
Wait for `docker inspect -f '{{.State.Health.Status}}' openldr-de68886f-api-1` to report `healthy`.

- [ ] **Step 2b: Verify the api loaded the internal issuer**

```bash
docker exec openldr-de68886f-api-1 sh -c 'echo "internal issuer: ${OIDC_INTERNAL_ISSUER_URL:-UNSET}"'
```
Expected: `internal issuer: http://keycloak:8080/auth/realms/openldr`.

- [ ] **Step 3: Run the enroll acceptance (labadmin token → POST enroll → 200)**

Copy `verify-enroll.mjs` (the harness from diagnosis: mints a labadmin token via a temporary direct-grant toggle it restores, POSTs enroll with siteId `verify-fix-01` / centralUrl `https://10.233.202.217`, then revokes the test site) into the container and run it:
```bash
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
docker cp <scratchpad>/verify-enroll.mjs openldr-de68886f-api-1:/tmp/verify-enroll.mjs
docker exec openldr-de68886f-api-1 node /tmp/verify-enroll.mjs
```
Expected output includes:
```
4) POST /api/settings/sync/enroll → 200
   ENROLL OK. Returned fields: clientId, clientSecret, siteId, centralUrl, oidcIssuer, signingPrivateKey, centralPublicKey
   clientSecret present: true | signingPrivateKey present: true | centralPublicKey present: true
5) cleanup revoke → 200
```

- [ ] **Step 4: Confirm no residue**

```bash
docker exec openldr-de68886f-api-1 node -e '
const b=new URLSearchParams({grant_type:"client_credentials",client_id:"openldr-admin",client_secret:"openldr-admin-dev-secret"});
fetch("http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:b}).then(r=>r.json()).then(j=>
 fetch("http://keycloak:8080/auth/admin/realms/openldr/clients?clientId=sync-verify-fix-01",{headers:{Authorization:"Bearer "+j.access_token}})).then(r=>r.json()).then(a=>console.log("leftover sync-verify-fix-01 clients:",a.length));'
```
Expected: `leftover sync-verify-fix-01 clients: 0` (revoke deleted it).

- [ ] **Step 5: Record the result** in `docs/sync-live-test-phase1-lan.md` (a short note: prod enroll 503→500→200 after this slice) and commit that doc if changed.

---

## Rollout (after acceptance passes — separate from task execution, gated on user approval)

- Run the full gate: `pnpm turbo typecheck test` (expect green; known `cli#build` flake per repo conventions).
- Whole-slice review before merge.
- `--no-ff` merge `claude/oidc-internal-issuer` → local `main`.
- Rebuild + **push** `openldr-api` to GHCR via `scripts/build-and-push.sh` (`--no-push` first to certify locally, then push): `:latest`, `:0.1.0`, and an immutable pin tag. studio/web/gateway unchanged — not rebuilt.
- **Ask the user before pushing** (per repo conventions).

## Follow-ups (filed, not in this plan)
- Installer generates a random `openldr-admin` secret + realm-import `${ENV}` substitution.
- Prod smoke-test of server-side user management (same code path, now repaired).
