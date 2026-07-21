# Studio-Branded Keycloak Login Theme — Design

**Date:** 2026-07-21
**Status:** Approved — ready for implementation plan
**Scope:** New Keycloak login theme + baked `openldr-keycloak` image + realm `loginTheme` + first-load hardening (KC healthcheck + theme warm-up).

## Problem

Studio authenticates via OIDC Authorization Code + PKCE, redirecting the browser
to Keycloak's **server-rendered** login page (`apps/studio/src/auth/oidc.ts`).
That page is stock Keycloak — PatternFly styling that does not resemble Studio,
breaking the visual experience at the one moment every user passes through.

A prior attempt at a custom theme worked but was **slow on the first load after
Keycloak (re)started** — the classic cold-cache symptom of a heavy theme
(extending Keycloak's PatternFly base and/or pulling external fonts) and/or a
theme mounted at runtime rather than baked into the image.

## Goal

Ship a login (and full login-flow) experience that blends into Studio's design,
with first-load cost driven down to near-nothing and no external network
dependencies on the login page.

## Non-negotiable design principles (each targets the slow-load root cause)

1. **Extend `base`, not `keycloak`.** The theme derives from Keycloak's minimal
   `base` theme (semantic HTML, no styling), not the PatternFly-heavy `keycloak`
   theme. Far less to compile and serve on the cold first hit.
2. **No external fonts, no CDN, no remote resources.** The CSS uses Studio's
   exact font stack — `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI',
   sans-serif` — with **no `@font-face` and no Google Fonts import**, mirroring
   how Studio itself loads fonts (it bundles none; it relies on the system
   stack). One small CSS file, no image assets (brand is a text wordmark).
3. **Bake the theme into the image.** The theme lives on the image's local disk,
   read once and cached by production `start` mode — not a runtime volume mount.
4. **Warm the theme on startup.** A startup warm-up renders the login page once
   before any real user arrives, so the cold FreeMarker compile never lands in a
   user's request.

## Approach

### 1. Delivery — new baked `openldr-keycloak` image

Add a fifth published image alongside `openldr-{api,studio,web,gateway}`:

- `FROM quay.io/keycloak/keycloak:26.0`
- `COPY` the theme into `/opt/keycloak/themes/openldr`

The installer-target compose (`deploy/install/docker-compose.yml`) and the dev
compose reference this image in place of the stock `quay.io/keycloak/keycloak`.
The installer pulls it with the rest. Production `start` mode (already in use)
keeps theme caching on.

### 2. Theme structure

Under a repo path (e.g. `infra/keycloak/themes/openldr/login/`):

- `theme.properties` — `parent=base`, `styles=css/login.css`. No `import=` of
  `common/keycloak` (that would pull in the PatternFly common resources we are
  deliberately avoiding per principle #1).
- `resources/css/login.css` — the single stylesheet (Studio tokens; see §3).
- `template.ftl` — a small override of `base`'s wrapper to place the `OpenLDR`
  text wordmark (semibold, brand color) as the header. All login-flow pages
  render through this wrapper, so styling it + the form controls themes every
  page at once.

The realm sets `"loginTheme": "openldr"` (see §5).

### 3. Styling — Studio tokens, dark default + light via `prefers-color-scheme`

Values copied from `apps/studio/src/tokens.css`. The CSS defines the dark palette
at `:root` (Studio's default) and overrides to the light palette inside
`@media (prefers-color-scheme: light)`:

| Token | Dark (default) | Light |
|---|---|---|
| page background | `#171717` | `#ffffff` |
| card | `#1e1e1e` | `#ffffff` |
| card border | `#2e2e2e` | `#e4e4e7` |
| text | `#fafafa` | `#18181b` |
| muted text | `#898989` | `#71717a` |

Shared (both schemes): brand `#4682B4`, link `#5A9BD6`, danger `#ef4444`;
card radius `8px`, input radius `6px`; **pill** primary button
(`border-radius: 9999px`, brand background, white text, `#5A9BD6` on hover) —
matching Studio's `.btn-primary`. Inputs, labels, checkbox ("remember me"),
links, and Keycloak's alert/error and info message blocks are all styled to
match. Focus ring: `0 0 0 2px rgba(70,130,180,0.5)` (Studio's `:focus-visible`).

> Note: Studio defaults to dark regardless of OS, whereas this login follows the
> OS `prefers-color-scheme`. A user whose OS prefers light will see a light login
> then a dark Studio. Accepted as a reasonable, low-cost tradeoff.

### 4. Page scope

Themed by the shared wrapper + form CSS (no per-page template work beyond the
wrapper):

- **Login** — primary page.
- **Forced password change** (`login-update-password`) — on the first-login
  critical path: the seeded `labadmin` credential is `temporary:true`
  (`infra/keycloak/openldr-realm.json`), so a brand-new operator hits this
  immediately after their first sign-in. Must look right.
- **Forgot/reset password** (`login-reset-password`), and the generic
  **error / info** pages.

### 5. Realm wiring

`"loginTheme": "openldr"` is set in the realm so Keycloak selects the theme:

- The import JSON used by compose: `infra/keycloak/openldr-realm.json` (and its
  `.template`).
- The server-side realm provisioning path, if it independently manages realm
  settings (`apps/server/src/keycloak-realm*`), so both the imported and the
  provisioned realm agree. The existing `apps/server/src/keycloak-realm.test.ts`
  is updated to assert the `loginTheme` field.

### 6. First-load hardening — KC healthcheck + theme warm-up

Two additions, both in compose:

- **Keycloak healthcheck.** Enable Keycloak's health endpoint
  (`KC_HEALTH_ENABLED=true`, management port 9000) and add a `healthcheck` to the
  `keycloak` service. This is also a structural fix: `gateway` (and `api`)
  currently `depends_on` Keycloak with only `service_started`; upgrade the
  dependency to `service_healthy` so nothing routes to Keycloak before it is
  actually serving. (This closes a gap noted during the installer readiness-gate
  work.)
- **Theme warm-up.** A lightweight warm-up (a small sidecar service in the
  minio-init mould, using a tiny curl image) waits for Keycloak to be healthy,
  then issues one GET that renders the themed login page — forcing the FreeMarker
  compile before a real user arrives. Runs on every `docker compose up`, so it
  also covers restarts/redeploys, not just fresh installs.

The exact healthcheck command and warm-up target URL are pinned in the
implementation plan (the Keycloak image ships without `curl`, so the healthcheck
uses a bash `/dev/tcp` probe against the health endpoint, and the warm-up runs in
a separate curl-capable container).

## Testing

- **Unit:** `apps/server/src/keycloak-realm.test.ts` updated to assert
  `loginTheme: "openldr"`. Themes themselves have no unit harness (like the
  installer scripts) — verified live.
- **Live verification:**
  1. Build the `openldr-keycloak` image, bring up the stack, sign in — confirm
     the login page matches Studio (dark), and light under an OS light
     preference.
  2. Walk the forced password-change path with a fresh `labadmin` — confirm that
     page is themed, not stock.
  3. Confirm first-load timing: on a cold container, the warm-up has already
     rendered the page, so the first human login is not slow. Compare against the
     stock-theme baseline.
  4. Confirm the gateway waits for Keycloak `service_healthy` (no window where
     `/auth` 502s during boot).

## Non-goals

- No change to the OIDC flow (still Authorization Code + PKCE redirect).
- No in-app / direct-grant login form.
- No account-console theme, no email theme, no admin-console theme — login theme
  only.
- No per-page bespoke layouts beyond theming the shared wrapper.
- No theme toggle on the login page (Keycloak login pages have no session to
  hold a preference); OS `prefers-color-scheme` is the only switch.
