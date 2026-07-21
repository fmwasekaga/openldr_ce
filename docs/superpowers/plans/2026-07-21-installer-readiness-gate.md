# Installer Readiness Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both one-line installers poll the full user path over the local gateway and only declare the stack "ready" once every service a first visit touches is actually serving — so a slow first boot no longer hands over a URL that lands on a not-yet-up Keycloak.

**Architecture:** After `docker compose up -d`, an installer-side `curl` loop probes four loopback HTTPS URLs (`/`, `/studio/`, `/health`, the Keycloak realm's OIDC discovery doc) until all pass or a timeout. Each check prints a status line the first time it passes. On timeout the installer warns, leaves the stack up, and exits 0. No Compose changes.

**Tech Stack:** POSIX `sh` (`install/install.sh`), Windows PowerShell (`install/install.ps1`), `curl` / `curl.exe`, Docker Compose.

## Global Constraints

- **Commits:** never add a `Co-Authored-By: Claude` (or `Codex`) trailer.
- **Loopback base:** probe `https://127.0.0.1:$HTTPS_PORT` (NOT `$ORIGIN`) — DNS/domain-independent; nginx is a single `default_server` so loopback routes correctly.
- **Probe flags:** `curl -f -s -k` — `-f` treats non-2xx (e.g. Keycloak's pre-import 404) as not-ready so the loop keeps polling; `-k` accepts the self-signed cert.
- **Default timeout:** `180` seconds. `0` disables the gate (restores current instant-handover behavior).
- **Failure = non-fatal:** on timeout, warn + keep the stack up + exit 0 (mirrors the existing Let's Encrypt failure path).
- **Glyph conventions (match each script's existing style):** `install.sh` uses Unicode `✓` / `→` / `…` / `!`; `install.ps1` uses ASCII `OK` / `->` / `...` / `!`.
- **Checks & labels (identical in both scripts), probed in this order:**
  | Label | Path |
  |---|---|
  | `gateway (TLS)` | `/` |
  | `studio` | `/studio/` |
  | `api` | `/health` |
  | `keycloak realm` | `/auth/realms/openldr/.well-known/openid-configuration` |
- **On timeout hint (both):** `Give it another minute, or inspect: docker compose logs -f keycloak`

## Testing note (read before starting)

The install scripts have **no unit-test harness** in this repo — by convention they are live-verified on a Docker host (see project memory: installers are verified live on the droplet). So these tasks do **not** use red/green unit tests. In-loop verification is a **syntax/parse check** (`sh -n`, PowerShell parser); the behavioral acceptance test is a **live smoke run** (Task 3). This is a deliberate, honest adaptation of TDD to shell/PowerShell installer scripts, not an omission.

---

### Task 1: `install.sh` — readiness gate

**Files:**
- Modify: `install/install.sh`

**Interfaces:**
- Consumes: existing vars `$HTTPS_PORT`, `$ORIGIN`, `$NO_START`, and the `$COMPOSE_FILES` `docker compose … up -d` invocation.
- Produces: new flag `--ready-timeout <seconds>`; new var `READY_OK` (0/1) consumed only by the final handover message.

- [ ] **Step 1: Document the flag in the header comment**

In `install/install.sh`, find the flags comment line:

```sh
#        --no-start (scaffold + config only), --no-pull (skip image pull).
```

Insert a new line immediately after it:

```sh
#        --ready-timeout <seconds> (default 180; 0 disables the post-start readiness wait),
```

- [ ] **Step 2: Add the default**

Find the defaults block line:

```sh
NO_PULL=0
```

Insert immediately after it:

```sh
READY_TIMEOUT=180
```

- [ ] **Step 3: Parse the flag**

Find the arg-parse case line:

```sh
    --no-pull) NO_PULL=1; shift ;;
```

Insert immediately after it:

```sh
    --ready-timeout) READY_TIMEOUT="$2"; shift 2 ;;
```

- [ ] **Step 4: Validate the flag is a non-negative integer**

Find the target-db validation block:

```sh
if [ "$TARGET_DB" != "postgres" ] && [ "$TARGET_DB" != "mssql" ] && [ "$TARGET_DB" != "mysql" ]; then
  echo "✗ --target-db must be 'postgres', 'mssql', or 'mysql' (got '$TARGET_DB')" >&2; exit 2
fi
```

Insert immediately after that closing `fi` (guards against `[ "$READY_TIMEOUT" -gt 0 ]` erroring under `set -eu` on non-numeric input):

```sh
case "$READY_TIMEOUT" in
  ''|*[!0-9]*) echo "✗ --ready-timeout must be a non-negative integer (got '$READY_TIMEOUT')" >&2; exit 2 ;;
esac
```

- [ ] **Step 5: Insert the readiness gate after `up -d`**

Find the start block:

```sh
[ "$NO_PULL" -eq 1 ] || docker compose $COMPOSE_FILES pull
docker compose $COMPOSE_FILES up -d
```

Insert immediately after the `up -d` line (this places the gate **before** the Let's Encrypt block that follows):

```sh

# Readiness gate: poll the full user path over the local gateway until every service a first
# visit touches is serving, so we only hand over a URL that actually works. Probes loopback
# (127.0.0.1) so external DNS / a not-yet-resolving --server-name can't cause a false timeout.
# Non-fatal: on timeout we warn and leave the stack up (exit 0), like the Let's Encrypt path.
ready_check() { curl -fsSk -o /dev/null "https://127.0.0.1:$HTTPS_PORT$1" 2>/dev/null; }
READY_OK=0
if [ "$READY_TIMEOUT" -gt 0 ]; then
  echo ""
  echo "→ Waiting for services to be ready (up to ${READY_TIMEOUT}s)..."
  ok_gw=0; ok_studio=0; ok_api=0; ok_kc=0
  deadline=$(( $(date +%s) + READY_TIMEOUT ))
  while : ; do
    if [ "$ok_gw" -eq 0 ] && ready_check "/"; then ok_gw=1; echo "  ✓ gateway (TLS)"; fi
    if [ "$ok_studio" -eq 0 ] && ready_check "/studio/"; then ok_studio=1; echo "  ✓ studio"; fi
    if [ "$ok_api" -eq 0 ] && ready_check "/health"; then ok_api=1; echo "  ✓ api"; fi
    if [ "$ok_kc" -eq 0 ] && ready_check "/auth/realms/openldr/.well-known/openid-configuration"; then ok_kc=1; echo "  ✓ keycloak realm"; fi
    if [ "$ok_gw" -eq 1 ] && [ "$ok_studio" -eq 1 ] && [ "$ok_api" -eq 1 ] && [ "$ok_kc" -eq 1 ]; then
      READY_OK=1; break
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then break; fi
    remain=""
    [ "$ok_gw" -eq 0 ] && remain="${remain}gateway (TLS), "
    [ "$ok_studio" -eq 0 ] && remain="${remain}studio, "
    [ "$ok_api" -eq 0 ] && remain="${remain}api, "
    [ "$ok_kc" -eq 0 ] && remain="${remain}keycloak realm, "
    echo "  … waiting for: ${remain%, }"
    sleep 3
  done
  if [ "$READY_OK" -eq 0 ]; then
    echo ""
    [ "$ok_gw" -eq 0 ] && echo "  ! gateway (TLS) still starting"
    [ "$ok_studio" -eq 0 ] && echo "  ! studio still starting"
    [ "$ok_api" -eq 0 ] && echo "  ! api still starting"
    [ "$ok_kc" -eq 0 ] && echo "  ! keycloak realm still starting"
    echo "  Give it another minute, or inspect: docker compose logs -f keycloak"
  fi
fi
```

- [ ] **Step 6: Make the final handover message truthful**

Find the final message:

```sh
echo ""
echo "✓ OpenLDR is starting. Open $ORIGIN"
```

Replace those two lines with:

```sh
echo ""
if [ "$READY_OK" -eq 1 ]; then
  echo "✓ OpenLDR is ready. Open $ORIGIN"
else
  echo "✓ OpenLDR is starting. Open $ORIGIN"
fi
```

(When `--ready-timeout 0` skips the gate, `READY_OK` stays `0`, so the message keeps the honest "is starting" wording — the stack was not verified.)

- [ ] **Step 7: Syntax check**

Run: `sh -n install/install.sh`
Expected: no output, exit 0 (script parses). If `shellcheck` is available, also run `shellcheck install/install.sh` and confirm no **new** errors versus the pre-change baseline.

- [ ] **Step 8: Commit**

```bash
git add install/install.sh
git commit -m "feat(installer): wait for the full user path before declaring the stack ready (sh)"
```

---

### Task 2: `install.ps1` — readiness gate (Windows parity)

**Files:**
- Modify: `install/install.ps1`

**Interfaces:**
- Consumes: existing `param()` vars `$HttpsPort`, `$Origin`, `$NoStart`; the `docker compose … up -d` call inside the `Push-Location`/`Pop-Location` block.
- Produces: new param `[int]$ReadyTimeout = 180`; new var `$ReadyOk` (bool) consumed only by the final handover message.

- [ ] **Step 1: Document the flag in the header comment**

In `install/install.ps1`, find:

```powershell
#   -NoStart / -NoPull
```

Insert immediately after it:

```powershell
#   -ReadyTimeout <n>   post-start readiness wait in seconds (default 180; 0 disables)
```

- [ ] **Step 2: Add the parameter**

In the `param(...)` block, find:

```powershell
  [int]$HttpsPort = 443,
```

Insert immediately after it:

```powershell
  [int]$ReadyTimeout = 180,
```

- [ ] **Step 3: Insert the readiness gate after the start block**

Find the end of the start block and the current final message:

```powershell
  Write-Host "-> Starting the stack..."
  Invoke-NativeProcessChecked "docker" (@("compose") + $ComposeFiles + @("up", "-d")) "docker compose up failed"
} finally { Pop-Location }
Write-Host ""
Write-Host "OK OpenLDR is starting. Open $Origin"
```

Replace from the `} finally { Pop-Location }` line through the `Write-Host "OK OpenLDR is starting. Open $Origin"` line with:

```powershell
} finally { Pop-Location }

# Readiness gate: poll the full user path over the local gateway until every service a first
# visit touches is serving, so we only hand over a URL that actually works. Uses curl.exe (NOT
# the PowerShell `curl`->Invoke-WebRequest alias) because Windows PowerShell 5.1 has no
# -SkipCertificateCheck; curl.exe -k accepts the self-signed cert. Probes loopback (127.0.0.1)
# so external DNS can't cause a false timeout. Non-fatal: on timeout we warn and leave the stack up.
$ReadyOk = $false
if ($ReadyTimeout -gt 0) {
  Write-Host ""
  Write-Host "-> Waiting for services to be ready (up to ${ReadyTimeout}s)..."
  $readyBase = "https://127.0.0.1:$HttpsPort"
  $checks = @(
    @{ Label = "gateway (TLS)";  Path = "/";                                                          Ok = $false },
    @{ Label = "studio";         Path = "/studio/";                                                    Ok = $false },
    @{ Label = "api";            Path = "/health";                                                     Ok = $false },
    @{ Label = "keycloak realm"; Path = "/auth/realms/openldr/.well-known/openid-configuration";       Ok = $false }
  )
  $deadline = (Get-Date).AddSeconds($ReadyTimeout)
  $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  try {
    while ($true) {
      foreach ($c in $checks) {
        if (-not $c.Ok) {
          # -s keeps curl silent even on connection-refused, so nothing hits PowerShell's
          # error stream (avoids a NativeCommandError under ErrorActionPreference).
          & curl.exe -f -s -k -o NUL "$readyBase$($c.Path)"
          if ($LASTEXITCODE -eq 0) { $c.Ok = $true; Write-Host "   OK $($c.Label)" }
        }
      }
      if (-not ($checks | Where-Object { -not $_.Ok })) { $ReadyOk = $true; break }
      if ((Get-Date) -ge $deadline) { break }
      $remain = ($checks | Where-Object { -not $_.Ok } | ForEach-Object { $_.Label }) -join ", "
      Write-Host "   ... waiting for: $remain"
      Start-Sleep -Seconds 3
    }
  } finally { $ErrorActionPreference = $prevEAP }
  if (-not $ReadyOk) {
    Write-Host ""
    foreach ($c in ($checks | Where-Object { -not $_.Ok })) { Write-Host "   ! $($c.Label) still starting" }
    Write-Host "   Give it another minute, or inspect: docker compose logs -f keycloak"
  }
}
Write-Host ""
if ($ReadyOk) { Write-Host "OK OpenLDR is ready. Open $Origin" }
else { Write-Host "OK OpenLDR is starting. Open $Origin" }
```

- [ ] **Step 4: Parse check**

Run (Windows PowerShell):

```powershell
$errs = $null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path install/install.ps1), [ref]$null, [ref]$errs); $errs
```

Expected: `$errs` is empty (no parse errors).

- [ ] **Step 5: Commit**

```bash
git add install/install.ps1
git commit -m "feat(installer): wait for the full user path before declaring the stack ready (ps1)"
```

---

### Task 3: Live smoke verification

**Files:** none (verification only).

This is the behavioral acceptance test. It needs a running Docker host. Use non-default ports so it never collides with a real install on 80/443. Adjust the raw path if testing the local working copy vs. the published script — here we run the local copy directly.

- [ ] **Step 1: Fresh install with the gate, watch the ✓ lines**

Run:

```bash
sh install/install.sh --dir /tmp/openldr-readytest --http-port 8080 --https-port 8443
```

Expected: after `docker compose up -d`, a `→ Waiting for services to be ready (up to 180s)...` line, then `✓ gateway (TLS)`, `✓ studio`, `✓ api`, `✓ keycloak realm` appearing over time (keycloak last), and finally `✓ OpenLDR is ready. Open https://localhost:8443`. The "ready" line must NOT appear before `✓ keycloak realm`.

- [ ] **Step 2: Confirm the realm discovery doc is actually live at handover**

Run:

```bash
curl -fsSk -o /dev/null -w "%{http_code}\n" https://127.0.0.1:8443/auth/realms/openldr/.well-known/openid-configuration
```

Expected: `200`.

- [ ] **Step 3: Confirm the escape hatch restores instant handover**

Tear down, then re-run with the gate disabled:

```bash
(cd /tmp/openldr-readytest && docker compose down -v)
rm -rf /tmp/openldr-readytest
sh install/install.sh --dir /tmp/openldr-readytest --http-port 8080 --https-port 8443 --ready-timeout 0
```

Expected: no `Waiting for services...` block; the message reads `✓ OpenLDR is starting. Open https://localhost:8443` (unverified wording).

- [ ] **Step 4: Confirm the timeout warns and keeps the stack up**

Tear down and re-run with a deliberately tiny timeout against a cold boot:

```bash
(cd /tmp/openldr-readytest && docker compose down -v)
rm -rf /tmp/openldr-readytest
sh install/install.sh --dir /tmp/openldr-readytest --http-port 8080 --https-port 8443 --ready-timeout 5; echo "exit=$?"
```

Expected: one or more `! <label> still starting` lines, the `Give it another minute...` hint, `✓ OpenLDR is starting.` (not "ready"), `exit=0`, and `docker compose -f /tmp/openldr-readytest/docker-compose.yml ps` shows containers still running (nothing torn down).

- [ ] **Step 5: Tear down the test stack**

```bash
(cd /tmp/openldr-readytest && docker compose down -v)
rm -rf /tmp/openldr-readytest
```

- [ ] **Step 6 (optional, if on Windows): parity smoke for `install.ps1`**

Run `install/install.ps1 -Dir C:\Temp\openldr-readytest -HttpPort 8080 -HttpsPort 8443` and confirm the ASCII `OK gateway (TLS)` / `OK studio` / `OK api` / `OK keycloak realm` lines and the `OK OpenLDR is ready.` message appear, `curl.exe` probing works against the self-signed cert, then `docker compose down -v`.

---

## Self-Review

**Spec coverage:**
- Full-user-path probe (4 checks, loopback base) → Task 1 Step 5, Task 2 Step 3, Global Constraints table. ✓
- Warn + keep stack up, exit 0 on timeout → Task 1 Step 5 (warn block, no `exit`), Task 2 Step 3. ✓
- Per-check status lines → `✓ <label>` / `OK <label>` printed once per check. ✓
- `--ready-timeout` knob, default 180, 0 disables → Task 1 Steps 1–4, Task 2 Steps 1–2, honest-message handling in Step 6/3. ✓
- Runs before Let's Encrypt block → Task 1 Step 5 inserts right after `up -d`. ✓
- Truthful final message → Task 1 Step 6, Task 2 Step 3. ✓
- Both installers (parity) → Task 1 (sh) + Task 2 (ps1), identical labels/checks/timeout. ✓
- curl.exe on Windows for self-signed / 5.1 → Task 2 Step 3 comment + `-k`. ✓
- Live verification (no unit harness) → Task 3. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code. ✓

**Type/name consistency:** `READY_TIMEOUT`/`READY_OK`/`ready_check` (sh) and `$ReadyTimeout`/`$ReadyOk`/`$checks[].Ok` (ps1) used consistently within each script; labels and the four paths are identical across both scripts and match the gateway routes in `deploy/nginx/openldr.conf.template`. ✓
