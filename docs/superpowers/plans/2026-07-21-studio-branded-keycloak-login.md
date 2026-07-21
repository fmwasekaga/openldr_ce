# Studio-Branded Keycloak Login Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stock Keycloak login with a minimal, Studio-branded login theme baked into a published `openldr-keycloak` image, wire the realm to use it, and harden first-load with a Keycloak healthcheck + theme warm-up.

**Architecture:** A `parent=base` Keycloak login theme (one `theme.properties` + one `login.css` + a one-line `messages` override — no FreeMarker template copying) styled from Studio's design tokens, dark by default with a `prefers-color-scheme: light` variant, no external fonts/images. Baked into a new `openldr-keycloak` image. The realm sets `loginTheme: "openldr"`. Compose gets a real Keycloak healthcheck (so the gateway waits for `service_healthy`) plus a best-effort warm-up sidecar that renders the login page once on startup.

**Tech Stack:** Keycloak 26 themes (FreeMarker `base` + CSS), Docker/Docker Compose, `scripts/build-and-push.sh` (buildx), Vitest.

## Global Constraints

- **Commits:** never add a `Co-Authored-By: Claude`/`Codex` trailer.
- **Theme parent:** `parent=base` — NOT `keycloak` (avoids PatternFly weight; principle behind the fast first load).
- **No external resources:** no `@font-face`, no Google Fonts, no CDN, no images. Font stack verbatim: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`.
- **Palette (from `apps/studio/src/tokens.css`), exact hex:** brand `#4682B4`, link `#5A9BD6`, link-hover `#7BB3D9`, danger `#ef4444`, warning `#f59e0b`, success `#22c55e`, focus ring `rgba(70,130,180,0.5)`, brand wash `rgba(70,130,180,0.15)`. Dark (default): bg `#171717`, card `#1e1e1e`, border `#2e2e2e`, text `#fafafa`, muted `#898989`. Light (`prefers-color-scheme: light`): bg `#ffffff`, card `#ffffff`, border `#e4e4e7`, text `#18181b`, muted `#71717a`.
- **Radii:** card `8px`, inputs `6px`, primary button pill `9999px`.
- **Header copy:** wordmark `OpenLDR` (brand color, weight 500), subtitle `Studio` (muted). No "laboratory" wording.
- **Image name:** `openldr-keycloak`, tagged like the others (`ghcr.io/open-laboratory-data-repository/openldr-keycloak:${OPENLDR_VERSION:-latest}` and `:<version>`).
- **Theme source path:** `deploy/keycloak/themes/openldr/login/…` (co-located with the image's build context `deploy/keycloak`, mirroring how `deploy/nginx` holds the gateway image's files).
- **Keycloak health:** enable `KC_HEALTH_ENABLED=true`; healthcheck probes the management port `9000` `/health/ready` using a `bash` `/dev/tcp` request (the Keycloak image ships no `curl`).
- **Realm field lives in TWO files kept in sync:** `infra/keycloak/openldr-realm.json` AND `infra/keycloak/openldr-realm.json.template`.

## Testing note (read before starting)

Two verification regimes apply:
- **Real unit test:** the realm `loginTheme` field is asserted by `apps/server/src/keycloak-realm.test.ts` — Task 3 is proper red/green TDD.
- **No unit harness (live-verified by convention):** theme CSS/properties, the Dockerfile, and Compose wiring have no unit tests. In-loop verification is a **parse/lint/config check** (`.properties` sanity, `docker compose config`, `build-and-push.sh --dry-run`); the behavioral acceptance is the **live task (Task 5)**, which is expected to be held for the user (needs Docker to build the image + run the stack).

---

### Task 1: Login theme files

**Files:**
- Create: `deploy/keycloak/themes/openldr/login/theme.properties`
- Create: `deploy/keycloak/themes/openldr/login/resources/css/login.css`
- Create: `deploy/keycloak/themes/openldr/login/messages/messages_en.properties`

**Interfaces:**
- Produces: a Keycloak login theme named `openldr` (directory name). Consumed by the realm's `loginTheme` (Task 3) and baked into the image (Task 2). The `theme.properties` `kc*Class` keys define the CSS class names the `base` templates emit; `login.css` styles both those classes and the stable Keycloak element ids as a fallback.

- [ ] **Step 1: Create `theme.properties`**

The `kc*Class` keys make Keycloak's `base` templates emit semantic class names we can style; `styles` replaces `base`'s (empty) stylesheet list with ours.

```properties
parent=base
styles=css/login.css

kcBodyClass=ldr-body
kcLoginClass=ldr-shell
kcHeaderClass=ldr-header
kcHeaderWrapperClass=ldr-wordmark
kcFormCardClass=ldr-card
kcFormHeaderClass=ldr-card-header
kcContentWrapperClass=ldr-content
kcFormGroupClass=ldr-group
kcLabelClass=ldr-label
kcLabelWrapperClass=ldr-label-wrap
kcInputClass=ldr-input
kcInputWrapperClass=ldr-input-wrap
kcFormOptionsClass=ldr-options
kcFormButtonsClass=ldr-buttons
kcButtonClass=ldr-btn
kcButtonPrimaryClass=ldr-btn-primary
kcButtonBlockClass=ldr-btn-block
kcCheckboxInputClass=ldr-checkbox
kcAlertClass=ldr-alert
kcInfoAreaWrapperClass=ldr-info
```

- [ ] **Step 2: Create `messages/messages_en.properties`**

Overrides only the header title (rendered by `base`'s `#kc-header-wrapper`). Everything else keeps Keycloak's default English labels.

```properties
loginTitleHtml=OpenLDR
```

- [ ] **Step 3: Create `resources/css/login.css`**

Styles the `ldr-*` classes from `theme.properties` and, as a fallback, the stable Keycloak element ids/classes (`#kc-page-title`, `#kc-form-options`, `#kc-info`, `.alert-*`, bare `input`/submit) so the page is styled even if a `kc*Class` key name differs by Keycloak point-release. The subtitle "Studio" is a CSS `::after` on the wordmark (no markup, so it survives Keycloak's HTML sanitizer).

```css
:root {
  --ldr-bg:#171717; --ldr-card:#1e1e1e; --ldr-border:#2e2e2e; --ldr-input-bg:#171717;
  --ldr-text:#fafafa; --ldr-muted:#898989;
  --ldr-brand:#4682B4; --ldr-link:#5A9BD6; --ldr-link-hover:#7BB3D9;
  --ldr-ring:rgba(70,130,180,0.5); --ldr-wash:rgba(70,130,180,0.15); --ldr-brd:rgba(70,130,180,0.3);
  --ldr-font:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
}
@media (prefers-color-scheme: light) {
  :root {
    --ldr-bg:#ffffff; --ldr-card:#ffffff; --ldr-border:#e4e4e7; --ldr-input-bg:#ffffff;
    --ldr-text:#18181b; --ldr-muted:#71717a;
  }
}
* { box-sizing:border-box; }
html, body { height:100%; }
body.ldr-body, body {
  margin:0; padding:24px; background:var(--ldr-bg); color:var(--ldr-text);
  font-family:var(--ldr-font); font-size:14px; line-height:1.5;
  display:flex; align-items:center; justify-content:center;
}
.ldr-shell { width:100%; max-width:340px; }
.ldr-header { text-align:center; margin-bottom:16px; }
.ldr-wordmark { color:var(--ldr-brand); font-weight:500; font-size:22px; line-height:1.2; }
.ldr-wordmark::after {
  content:"Studio"; display:block; margin-top:2px;
  color:var(--ldr-muted); font-weight:400; font-size:13px;
}
.ldr-card { background:var(--ldr-card); border:1px solid var(--ldr-border); border-radius:8px; padding:24px; }
.ldr-card-header { margin:0 0 16px; }
#kc-page-title { margin:0; font-size:16px; font-weight:500; color:var(--ldr-text); }
.ldr-group { margin-bottom:14px; }
.ldr-label, label { display:block; font-size:12px; color:var(--ldr-muted); margin-bottom:5px; }
.ldr-input,
input[type="text"], input[type="password"], input[type="email"], input[type="number"] {
  width:100%; height:36px; background:var(--ldr-input-bg); color:var(--ldr-text);
  border:1px solid var(--ldr-border); border-radius:6px; padding:0 10px; font:inherit;
}
.ldr-input:focus,
input[type="text"]:focus, input[type="password"]:focus, input[type="email"]:focus {
  outline:none; border-color:var(--ldr-brand); box-shadow:0 0 0 2px var(--ldr-ring);
}
.ldr-options, #kc-form-options {
  display:flex; align-items:center; justify-content:space-between;
  margin:14px 0; font-size:12px; color:var(--ldr-muted);
}
a { color:var(--ldr-link); text-decoration:none; }
a:hover { color:var(--ldr-link-hover); }
.ldr-checkbox, input[type="checkbox"] { accent-color:var(--ldr-brand); margin-right:6px; }
.ldr-buttons { margin-top:4px; }
.ldr-btn-primary,
input[type="submit"], button[type="submit"] {
  width:100%; background:var(--ldr-brand); color:#fff; border:none; border-radius:9999px;
  padding:9px 24px; font:500 14px var(--ldr-font); cursor:pointer;
}
.ldr-btn-primary:hover,
input[type="submit"]:hover, button[type="submit"]:hover { background:var(--ldr-link); }
.ldr-alert, div[class*="alert-"] {
  border-radius:6px; padding:8px 10px; font-size:12px; margin-bottom:14px;
  border:1px solid transparent;
}
.alert-error   { background:rgba(239,68,68,0.12);  border-color:rgba(239,68,68,0.3);  color:#f0999a; }
.alert-warning { background:rgba(245,158,11,0.12); border-color:rgba(245,158,11,0.3); color:#f5c37a; }
.alert-info    { background:var(--ldr-wash);       border-color:var(--ldr-brd);       color:var(--ldr-link-hover); }
.alert-success { background:rgba(34,197,94,0.12);  border-color:rgba(34,197,94,0.3);  color:#7ed99f; }
@media (prefers-color-scheme: light) {
  .alert-error   { color:#b91c1c; }
  .alert-warning { color:#92610a; }
  .alert-info    { color:#365F8A; }
  .alert-success { color:#15803d; }
}
#kc-info, .ldr-info { margin-top:16px; text-align:center; font-size:12px; color:var(--ldr-muted); }
#kc-locale { position:absolute; top:16px; right:16px; font-size:12px; }
#kc-locale a, #kc-locale { color:var(--ldr-muted); }
```

- [ ] **Step 4: Sanity-check the files**

Run (from repo root):

```bash
test -f deploy/keycloak/themes/openldr/login/theme.properties \
  && test -s deploy/keycloak/themes/openldr/login/resources/css/login.css \
  && grep -q '^parent=base' deploy/keycloak/themes/openldr/login/theme.properties \
  && grep -q 'prefers-color-scheme: light' deploy/keycloak/themes/openldr/login/resources/css/login.css \
  && grep -q '^loginTitleHtml=OpenLDR' deploy/keycloak/themes/openldr/login/messages/messages_en.properties \
  && echo OK
```

Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add deploy/keycloak/themes/openldr
git commit -m "feat(auth): Studio-branded Keycloak login theme (base parent, dark+light)"
```

---

### Task 2: `openldr-keycloak` image + build pipeline

**Files:**
- Create: `deploy/keycloak/Dockerfile`
- Modify: `scripts/build-and-push.sh`
- Modify: `RELEASE.md`

**Interfaces:**
- Consumes: the theme dir from Task 1 (`deploy/keycloak/themes/openldr`), which is inside this Dockerfile's build context (`deploy/keycloak`).
- Produces: the image `openldr-keycloak`, referenced by the compose files in Task 4.

- [ ] **Step 1: Create `deploy/keycloak/Dockerfile`**

```dockerfile
# OpenLDR CE Keycloak image: stock Keycloak 26 with the OpenLDR login theme baked in
# so it is on local disk (fast, cached by production `start` mode) rather than mounted
# at runtime. Build context is deploy/keycloak (see scripts/build-and-push.sh).
FROM quay.io/keycloak/keycloak:26.0
COPY themes/openldr /opt/keycloak/themes/openldr
```

- [ ] **Step 2: Add the image to `scripts/build-and-push.sh`**

Find:

```bash
build_one openldr-gateway deploy/nginx/Dockerfile deploy/nginx
echo "Done. Images: $REGISTRY/openldr-{api,studio,web,gateway}:{$TAG,$VERSION}"
```

Replace those two lines with:

```bash
build_one openldr-gateway  deploy/nginx/Dockerfile     deploy/nginx
build_one openldr-keycloak deploy/keycloak/Dockerfile  deploy/keycloak
echo "Done. Images: $REGISTRY/openldr-{api,studio,web,gateway,keycloak}:{$TAG,$VERSION}"
```

- [ ] **Step 3: Update `RELEASE.md` counts**

Find:

```
OpenLDR CE ships four images to GHCR:
`ghcr.io/open-laboratory-data-repository/openldr-{api,studio,web,gateway}`.
```

Replace with:

```
OpenLDR CE ships five images to GHCR:
`ghcr.io/open-laboratory-data-repository/openldr-{api,studio,web,gateway,keycloak}`.
```

- [ ] **Step 4: Verify the pipeline wiring (dry run — no build)**

Run:

```bash
bash scripts/build-and-push.sh --dry-run | grep -E "openldr-keycloak"
```

Expected: a line containing `docker buildx build ... -t <registry>/openldr-keycloak:latest ... -f deploy/keycloak/Dockerfile ... deploy/keycloak`. (The actual image build runs in Task 5 — it pulls the ~450MB Keycloak base.)

- [ ] **Step 5: Commit**

```bash
git add deploy/keycloak/Dockerfile scripts/build-and-push.sh RELEASE.md
git commit -m "build(auth): publish openldr-keycloak image with the baked login theme"
```

---

### Task 3: Realm `loginTheme` (TDD)

**Files:**
- Modify: `apps/server/src/keycloak-realm.test.ts`
- Modify: `infra/keycloak/openldr-realm.json`
- Modify: `infra/keycloak/openldr-realm.json.template`

**Interfaces:**
- Consumes: the theme name `openldr` from Task 1.
- Produces: `loginTheme: "openldr"` in the realm import, so Keycloak selects the theme.

- [ ] **Step 1: Write the failing test**

In `apps/server/src/keycloak-realm.test.ts`, add `loginTheme` to the `Realm` interface. Find:

```typescript
interface Realm {
  realm: string; enabled: boolean;
  roles: { realm: RealmRole[] };
  clients: RealmClient[];
  users: RealmUser[];
}
```

Replace with:

```typescript
interface Realm {
  realm: string; enabled: boolean;
  loginTheme?: string;
  roles: { realm: RealmRole[] };
  clients: RealmClient[];
  users: RealmUser[];
}
```

Then add this test after the existing `it('declares the openldr realm, enabled', …)` block:

```typescript
  it('selects the openldr login theme', () => {
    expect(realm.loginTheme).toBe('openldr');
  });
```

- [ ] **Step 2: Run the test — expect RED**

Run:

```bash
pnpm --filter @openldr/server test -- keycloak-realm
```

Expected: FAIL — `selects the openldr login theme` fails with `expected undefined to be 'openldr'` (the field is not in the JSON yet).

- [ ] **Step 3: Add `loginTheme` to both realm files**

In BOTH `infra/keycloak/openldr-realm.json` AND `infra/keycloak/openldr-realm.json.template`, find:

```json
  "realm": "openldr",
  "enabled": true,
  "sslRequired": "external",
```

Replace with:

```json
  "realm": "openldr",
  "enabled": true,
  "loginTheme": "openldr",
  "sslRequired": "external",
```

- [ ] **Step 4: Run the test — expect GREEN**

Run:

```bash
pnpm --filter @openldr/server test -- keycloak-realm
```

Expected: PASS — all `openldr realm export` tests pass, including `selects the openldr login theme`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/keycloak-realm.test.ts infra/keycloak/openldr-realm.json infra/keycloak/openldr-realm.json.template
git commit -m "feat(auth): select the openldr login theme in the realm import"
```

---

### Task 4: Compose wiring — baked image, healthcheck, warm-up, dev mount

**Files:**
- Modify: `deploy/install/docker-compose.yml` (installer-target prod stack)
- Modify: `docker-compose.prod.yml` (repo prod stack)
- Modify: `docker-compose.yml` (dev stack)

**Interfaces:**
- Consumes: the `openldr-keycloak` image (Task 2) and the theme dir (Task 1).
- Produces: a Keycloak that serves the baked theme, reports health on `:9000`, is depended on with `service_healthy`, and is warmed once on startup.

**Note on the warm-up (one live-validated assumption):** the warm-up issues an internal GET to Keycloak's authorization endpoint with a redirect_uri (`http://localhost/*`) that the base realm already registers, so Keycloak returns the login page (200) and compiles the theme. Whether an internal-host request renders vs. redirects under `KC_HOSTNAME` is confirmed in Task 5; the sidecar is best-effort (`|| true`) and never fails the stack, so a mis-tuned URL degrades to "no warm-up," not a broken install.

- [ ] **Step 1: `deploy/install/docker-compose.yml` — point Keycloak at the baked image + enable health + healthcheck**

Find:

```yaml
  keycloak:
    image: quay.io/keycloak/keycloak:26.0
```

Replace with:

```yaml
  keycloak:
    image: ghcr.io/open-laboratory-data-repository/openldr-keycloak:${OPENLDR_VERSION:-latest}
```

Then find, in the same `keycloak` service:

```yaml
      KC_HTTP_ENABLED: "true"
      KC_PROXY_HEADERS: xforwarded
```

Replace with (adds the health flag):

```yaml
      KC_HTTP_ENABLED: "true"
      KC_PROXY_HEADERS: xforwarded
      KC_HEALTH_ENABLED: "true"
```

Then find the end of the `keycloak` service block:

```yaml
    volumes:
      - ./config/keycloak/openldr-realm.json:/opt/keycloak/data/import/openldr-realm.json:ro
    expose: ["8080"]
    restart: unless-stopped
```

Replace with (adds a healthcheck — `bash` `/dev/tcp` to the management port, since the image has no `curl`):

```yaml
    volumes:
      - ./config/keycloak/openldr-realm.json:/opt/keycloak/data/import/openldr-realm.json:ro
    expose: ["8080"]
    healthcheck:
      test: ["CMD", "bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/9000; printf 'GET /health/ready HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3; grep -q UP <&3"]
      interval: 10s
      timeout: 5s
      retries: 30
      start_period: 30s
    restart: unless-stopped
```

- [ ] **Step 2: `deploy/install/docker-compose.yml` — depend on Keycloak `service_healthy`**

Find the `api` service's dependency:

```yaml
    depends_on:
      postgres: { condition: service_healthy }
      minio: { condition: service_started }
      keycloak: { condition: service_started }
```

Replace with:

```yaml
    depends_on:
      postgres: { condition: service_healthy }
      minio: { condition: service_started }
      keycloak: { condition: service_healthy }
```

Then find the `gateway` service's dependency (list form):

```yaml
    depends_on: ["api", "studio", "web", "keycloak"]
```

Replace with (map form so Keycloak can require `service_healthy`):

```yaml
    depends_on:
      api: { condition: service_started }
      studio: { condition: service_started }
      web: { condition: service_started }
      keycloak: { condition: service_healthy }
```

- [ ] **Step 3: `deploy/install/docker-compose.yml` — add the warm-up sidecar**

Find the `keycloak` service block's start:

```yaml
  keycloak:
    image: ghcr.io/open-laboratory-data-repository/openldr-keycloak:${OPENLDR_VERSION:-latest}
```

Insert a new service immediately BEFORE the `keycloak:` line:

```yaml
  # Renders the themed login page once, after Keycloak is healthy, so the first real user never
  # pays the cold FreeMarker compile. Best-effort — never fails the stack. Internal back-channel;
  # redirect_uri http://localhost/* is registered in the base realm, so Keycloak returns the login
  # page (200) and compiles the theme rather than an invalid_redirect error.
  keycloak-warmup:
    image: curlimages/curl:latest
    depends_on:
      keycloak: { condition: service_healthy }
    entrypoint:
      - sh
      - -c
      - "curl -fsS -o /dev/null 'http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/auth?client_id=openldr-web&response_type=code&scope=openid&redirect_uri=http%3A%2F%2Flocalhost%2Fstudio' || true; echo 'login theme warmed'"
    restart: "no"

```

- [ ] **Step 4: `docker-compose.prod.yml` — apply the identical four edits**

`docker-compose.prod.yml` has the same-shaped `keycloak`, `api`, and `gateway` blocks. Apply the same changes as Steps 1–3:

1. `image: quay.io/keycloak/keycloak:26.0` → `image: ghcr.io/open-laboratory-data-repository/openldr-keycloak:${OPENLDR_VERSION:-latest}`.
2. After `KC_PROXY_HEADERS: xforwarded`, add `KC_HEALTH_ENABLED: "true"`.
3. Add the same `healthcheck:` block to the `keycloak` service (after its `volumes:`/`expose:` — match the existing block's final keys; keep `restart: unless-stopped` last).
4. `api` `depends_on` `keycloak: { condition: service_started }` → `service_healthy`.
5. `gateway` `depends_on: ["api", "studio", "web", "keycloak"]` → the map form with `keycloak: { condition: service_healthy }` (others `service_started`).
6. Insert the same `keycloak-warmup` service immediately before the `keycloak:` service.

- [ ] **Step 5: `docker-compose.yml` (dev) — mount the theme so dev sees it**

The dev stack runs stock Keycloak in `start-dev`; mount the theme dir so the imported realm's `loginTheme` resolves without building the image. Find:

```yaml
    volumes:
      - ./infra/keycloak/openldr-realm.json:/opt/keycloak/data/import/openldr-realm.json:ro
    ports:
      - "8180:8080"
```

Replace with:

```yaml
    volumes:
      - ./infra/keycloak/openldr-realm.json:/opt/keycloak/data/import/openldr-realm.json:ro
      - ./deploy/keycloak/themes/openldr:/opt/keycloak/themes/openldr:ro
    ports:
      - "8180:8080"
```

- [ ] **Step 6: Validate all three compose files parse/merge**

Run:

```bash
docker compose -f docker-compose.yml config >/dev/null && echo "dev OK"
docker compose -f deploy/install/docker-compose.yml --env-file .env config >/dev/null && echo "install OK"
docker compose -f docker-compose.prod.yml --env-file .env.prod.example config >/dev/null && echo "prod OK"
```

Expected: `dev OK`, `install OK`, `prod OK` (Compose validates the merged config; no containers start). If a required `${VAR:?…}` in the prod file is unset, set it in the env file used or export it for the check.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml deploy/install/docker-compose.yml docker-compose.prod.yml
git commit -m "feat(auth): serve baked Keycloak theme + healthcheck, gate gateway on KC healthy, warm login"
```

---

### Task 5: Live verification (held — needs Docker to build the image + run the stack)

**Files:** none (verification only).

- [ ] **Step 1: Build the image**

```bash
bash scripts/build-and-push.sh --no-push --tag dev-login
```

Expected: `openldr-keycloak:dev-login` builds and loads locally (pulls the Keycloak base once).

- [ ] **Step 2: Bring up the dev stack and view the themed login**

The dev stack mounts the theme, so no image build is needed to eyeball it:

```bash
docker compose down -v   # wipe volumes so --import-realm re-imports with loginTheme
docker compose up -d keycloak
```

Open `http://localhost:8180/realms/openldr/account` (or trigger a login) and confirm: dark card, `OpenLDR` wordmark + `Studio` subtitle, steel-blue pill "Sign In", no PatternFly styling, no external font/network requests (check devtools Network — nothing to fonts.googleapis.com). Toggle the OS to light mode and reload — confirm the light palette.

- [ ] **Step 3: Verify the forced-password-change page is themed**

Sign in as `labadmin` / `labadmin` (dev seed). Confirm the forced "update password" page renders in the theme (same card/inputs/button), not stock Keycloak.

- [ ] **Step 4: Verify the baked image + healthcheck + warm-up on a prod-mode stack**

On a machine that can run the full prod stack (per DEPLOYMENT.md), bring it up with the built `openldr-keycloak` image and confirm:
- `docker inspect --format '{{.State.Health.Status}}' <keycloak-container>` reaches `healthy`.
- The `gateway` does not start serving `/auth` until Keycloak is healthy (no `502` window on `/auth/...` during boot).
- `docker compose logs keycloak-warmup` shows `login theme warmed`; the first human login is not slow (compare to a stock-theme baseline). If the internal warm-up GET returned a redirect instead of rendering (theme not compiled), switch the warm-up target to the gateway/public origin and re-verify.

- [ ] **Step 5: Publish the image (when ready to release)**

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <username> --password-stdin
pnpm run publish:images   # now builds + pushes all FIVE images
```

---

## Self-Review

**Spec coverage:**
- FreeMarker theme, `parent=base`, no external fonts/images → Task 1 (theme.properties `parent=base`, `login.css` font stack, no `@font-face`). ✓
- Dark default + light via `prefers-color-scheme` → Task 1 `login.css`. ✓
- `OpenLDR` wordmark + `Studio` subtitle, no "laboratory" → Task 1 (`messages_en.properties` + `.ldr-wordmark::after`). ✓
- Page scope incl. forced password change → covered by base shared wrapper + `login.css` (Task 1); verified Task 5 Step 3. ✓
- Baked `openldr-keycloak` image in the pipeline → Task 2. ✓
- Realm `loginTheme` in both files + test → Task 3 (TDD). ✓
- KC healthcheck + gateway waits `service_healthy` + warm-up → Task 4 (both prod composes) + dev mount. ✓
- Testing: TDD for realm; parse/config/dry-run in-loop; live acceptance held → Task 3 (red/green), Tasks 1/2/4 checks, Task 5. ✓

**Placeholder scan:** No TBD/TODO; every file's full contents are shown. The one deliberately live-validated assumption (warm-up render-vs-redirect) is called out with a concrete fallback, not left vague. ✓

**Type/name consistency:** theme dir name `openldr` matches `loginTheme: "openldr"` (Task 3) and the image COPY path (Task 2). `ldr-*` class names in `theme.properties` match `login.css` selectors. Image name `openldr-keycloak` identical across Task 2 (build script), Task 4 (compose `image:`), and RELEASE.md. `KC_HEALTH_ENABLED` + management port `9000` consistent between the env var and the healthcheck probe. ✓
