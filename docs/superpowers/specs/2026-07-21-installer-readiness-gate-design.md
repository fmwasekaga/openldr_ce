# Installer Readiness Gate — Design

**Date:** 2026-07-21
**Status:** Approved — ready for implementation plan
**Scope:** `install/install.sh`, `install/install.ps1`

## Problem

The one-line installer runs `docker compose up -d`, which returns the instant
containers are *created* — not when they are *serving* — and then immediately
prints "Open $ORIGIN". On a slow first boot, Keycloak (production `start` mode:
auto-build + wait-for-Postgres + realm import) is still coming up when the user
opens the URL. Studio's login redirect then lands on a Keycloak that isn't
serving yet, producing a broken browser page.

The gateway only `depends_on` Keycloak with `service_started` (not
`service_healthy`), and Keycloak has no healthcheck, so nothing in the stack or
the installer gates the handover. The "done" message races the stack.

## Goal

Before the installer declares the stack ready, poll the **full user path** over
the local gateway until every service a first visit touches is actually serving,
then print a truthful "ready" message. A slow or genuinely-broken stack must not
hang the installer or tear anything down — it warns and exits successfully.

## Approach

Installer-side readiness poll (not `docker compose up --wait` + healthchecks).
Compose's `--wait` only knows *container* health — not gateway-routed
reachability — aborts hard on an unhealthy container, and cannot emit per-check
status lines. An installer-side curl loop matches the chosen behavior exactly,
needs zero compose changes, and mirrors the existing non-fatal Let's Encrypt
readiness poll already in `install.sh`.

## What it probes

Probes run against the **loopback** base `https://127.0.0.1:$HTTPS_PORT`, not
`$ORIGIN`. The gateway's nginx is a single `default_server` block with no vhost
split, so a loopback request with any Host routes correctly. Loopback makes the
gate immune to external DNS / a `--server-name` domain that does not yet resolve
to this host, while still validating the real local stack end-to-end. DNS and
trusted-TLS concerns remain the Let's Encrypt block's responsibility.

Four checks, printed in this order (which is also roughly their
readiness order — static nginx first, migrate/seed-bound api next, Keycloak
realm last):

| Label | Path | Proves |
|---|---|---|
| `gateway (TLS)` | `/` | gateway terminating TLS + landing (web) up |
| `studio` | `/studio/` | studio SPA served |
| `api` | `/health` | api up + gateway→api routing (waits out migrate/seed) |
| `keycloak realm` | `/auth/realms/openldr/.well-known/openid-configuration` | realm imported & serving — the studio login redirect will succeed |

These paths are exactly what the gateway template
(`deploy/nginx/openldr.conf.template`) routes today. `/health` is proxied to the
api's public `/health` route (`apps/server/src/app.ts`), which is unauthenticated
and returns 200 only once the server is listening (i.e. after migrations).

## Probe mechanics

- **Command:** `curl -fsSk <url>` (sh) / `curl.exe -fsSk <url>` (ps1).
  - `-f` — non-2xx (e.g. Keycloak's 404 before the realm import completes)
    counts as *not ready*, so the loop keeps polling.
  - `-s -S` — quiet, but still surface hard errors.
  - `-k` — accept the self-signed cert the installer generates.
  - `install.ps1` calls `curl.exe` explicitly (Windows ships it since Win10
    1803) to avoid the PowerShell `curl` → `Invoke-WebRequest` alias and Windows
    PowerShell 5.1's lack of `-SkipCertificateCheck`. Output is discarded with
    `-o /dev/null` (sh) / `-o NUL` (ps1); readiness is read from the exit code
    (`$?` / `$LASTEXITCODE`).
- **Loop:** poll every ~3 seconds. Each check prints `✓ <label>` the first time
  it passes and is never re-probed. A single `… waiting for: <remaining labels>`
  line reports what is still pending each pass.
- **Placement:** runs immediately after `docker compose … up -d` and **before**
  the Let's Encrypt block, so the stack is warm before LE issuance. The LE
  block's own `:80` nginx poll is left untouched (harmless belt-and-suspenders).
- **Applies only when the stack is started:** `--no-start` / `-NoStart` already
  returns before the start step, so the gate is naturally skipped there.

## Timeout & failure behavior

- **Knob:** `--ready-timeout <seconds>` (sh) / `-ReadyTimeout <n>` (ps1), default
  **180**. `0` disables the gate entirely — an escape hatch for CI/automation
  that wants the current instant-handover behavior.
- **On timeout (warn + keep stack up, exit 0):** print `! <label> still starting`
  for each check that never passed, plus a hint:
  `give it another minute, or inspect: docker compose logs -f keycloak`.
  Nothing is torn down; the installer exits 0. This mirrors the existing
  non-fatal Let's Encrypt failure path.

## Final message

The handover message becomes truthful based on the gate outcome:

- **All checks passed:** `✓ OpenLDR is ready. Open $ORIGIN`
- **Timed out:** keep the current `OpenLDR is starting. Open $ORIGIN` wording.

The credentials / next-steps block (Keycloak admin password, `labadmin`
sign-in, demo DB passwords, ports, Distributed Sync note) prints in both cases,
unchanged.

## Parity

Both installers get the identical gate (per the repo's CLI-operator-parity
convention). `install.sh` and `install.ps1` share a symmetric tail today; the
gate is inserted at the same point in each, with the same labels, checks,
default timeout, and messaging.

## Non-goals

- No Compose healthcheck / `depends_on: service_healthy` changes.
- No new HTTP endpoints; reuses existing routes.
- No teardown/rollback on failure — the stack always stays up.

## Testing

The install scripts have no unit-test harness in this repo; they are live-verified
on the test droplet by convention. Verification for this change is a live re-run:

1. Fresh install on a clean host — watch the four `✓` lines appear in order and
   confirm `✓ OpenLDR is ready` prints only after the Keycloak discovery doc
   returns 200 (open `$ORIGIN` immediately after and confirm the login redirect
   works, no broken page).
2. `--ready-timeout 0` — confirm instant handover (current behavior) with the
   `is starting` message.
3. Timeout path — e.g. a very low `--ready-timeout 5` on a cold first boot —
   confirm the `! … still starting` warnings, the log hint, exit 0, and that the
   stack is still running.
4. Windows `install.ps1` — confirm `curl.exe` probing works against the
   self-signed cert and the same `✓` lines / messaging appear.
