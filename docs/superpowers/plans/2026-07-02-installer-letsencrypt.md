# Installer Let's Encrypt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `install.sh --server-name <domain> --letsencrypt <email>` issue a trusted, auto-renewing Let's Encrypt cert on a clean droplet with no repo clone.

**Architecture:** Mirror the source path's LE tooling into the pull-based installer: add a profile-gated `certbot` service + a shared `certbot-www` webroot to the installer compose, mount it on the gateway (whose baked nginx already serves `/.well-known/acme-challenge/`), and have `install.sh` issue the cert after the stack is up, then install a host cron that runs a downloaded `renew-cert.sh`.

**Tech Stack:** Docker Compose, certbot/certbot image, nginx (baked gateway), POSIX sh, cron.

**Conventions:**
- The actual cert issuance needs a public domain + reachable port 80, so it's a **droplet-only** test (the user runs it). Everything else is verifiable locally.
- Verify with `docker compose config`, `sh -n`, guard/scaffold runs. No `pnpm build`.
- Work on local `main`; frequent commits; push (deploy-relevant — the user tests on DO).
- `install.sh` already has: vars `DIR`/`VERSION`/`HOST`/`NO_START`/`NO_PULL`/`ORIGIN`, a `fetch()` helper, realm-redirect injection, `.env` generation, self-signed cert generation, and a start section (`cd "$DIR"; docker compose pull; docker compose up -d`).

---

## File Structure

- **Modify** `deploy/install/docker-compose.yml` — add `certbot` service, gateway `certbot-www` mount, `certbot-www` + `letsencrypt` volumes.
- **Create** `deploy/install/renew-cert.sh` — cron-invoked renew + reload.
- **Modify** `install/install.sh` — `--letsencrypt`/`--staging` flags, localhost guard, issuance flow, `renew-cert.sh` fetch, cron install, non-fatal failure handling, `LETSENCRYPT_EMAIL` in `.env`.
- **Modify** `install/install.ps1` — `-Letsencrypt` warn-only note.
- **Modify** `DEPLOYMENT.md` — document the `--letsencrypt` install + renewal.

---

## Task 1: Installer compose — certbot service + webroot

**Files:**
- Modify: `deploy/install/docker-compose.yml`

- [ ] **Step 1: Add the certbot-www mount to the gateway service**

In `deploy/install/docker-compose.yml`, the `gateway` service currently has:
```yaml
    volumes:
      - ./config/nginx/certs:/etc/nginx/certs:ro
```
Change it to:
```yaml
    volumes:
      - ./config/nginx/certs:/etc/nginx/certs:ro
      - certbot-www:/var/www/certbot
```

- [ ] **Step 2: Add the certbot service + volumes**

At the end of the `services:` block (after `keycloak`), add the `certbot` service, and extend the `volumes:` section:
```yaml
  # Let's Encrypt helper (profile-gated: does NOT start with `up`). Invoked by the installer's
  # --letsencrypt flag and by renew-cert.sh (cron). Issued certs land in ./config/nginx/certs,
  # where the gateway reads them; the shared certbot-www volume carries the http-01 challenge.
  certbot:
    image: certbot/certbot:latest
    profiles: ["letsencrypt"]
    volumes:
      - letsencrypt:/etc/letsencrypt
      - ./config/nginx/certs:/certs-out
      - certbot-www:/var/www/certbot

volumes:
  pgdata:
  miniodata:
  certbot-www:
  letsencrypt:
```
Note: replace the EXISTING `volumes:` block (which currently lists only `pgdata:` and `miniodata:`) with this expanded one — do not add a second `volumes:` key.

- [ ] **Step 3: Validate the compose renders with the certbot profile**

Run:
```bash
cd deploy/install
printf 'SERVER_NAME=localhost\nOPENLDR_VERSION=latest\n' > .env
docker compose --profile letsencrypt config >/dev/null && echo BASE_OK
docker compose --profile letsencrypt config | grep -A3 "certbot:" | grep -q "certbot/certbot" && echo CERTBOT_OK
docker compose config | grep -q "certbot-www" && echo WEBROOT_OK
rm -f .env
cd ../..
```
Expected: `BASE_OK`, `CERTBOT_OK`, `WEBROOT_OK` (the gateway mounts `certbot-www`, the `certbot` service exists under the profile, and the volumes resolve).

- [ ] **Step 4: Commit**

```bash
git add deploy/install/docker-compose.yml
git commit -m "feat(install): add certbot service + webroot to the installer compose"
```

---

## Task 2: `renew-cert.sh`

**Files:**
- Create: `deploy/install/renew-cert.sh`

- [ ] **Step 1: Write the script**

Create `deploy/install/renew-cert.sh`:
```sh
#!/bin/sh
# Renew the Let's Encrypt cert for THIS install dir's domain and reload the gateway.
# Run from cron (see /etc/cron.d/openldr-cert). Idempotent: certbot renew only re-issues near
# expiry; the copy + reload run either way so a fresh cert is always picked up.
set -eu
cd "$(dirname "$0")"
HOST="$(grep -E '^SERVER_NAME=' .env | head -1 | cut -d= -f2- | tr -d '\r')"
[ -n "$HOST" ] || { echo "renew-cert: no SERVER_NAME in .env" >&2; exit 1; }
docker compose --profile letsencrypt run --rm --entrypoint certbot certbot \
  renew --webroot -w /var/www/certbot --quiet
docker compose --profile letsencrypt run --rm --entrypoint sh certbot -c \
  "cp /etc/letsencrypt/live/$HOST/fullchain.pem /certs-out/fullchain.pem && \
   cp /etc/letsencrypt/live/$HOST/privkey.pem /certs-out/privkey.pem"
docker compose exec gateway nginx -s reload
```

- [ ] **Step 2: Syntax check + mark executable**

Run:
```bash
sh -n deploy/install/renew-cert.sh && echo "renew-cert.sh OK"
git add deploy/install/renew-cert.sh
git update-index --chmod=+x deploy/install/renew-cert.sh
git ls-files -s deploy/install/renew-cert.sh | grep -q 100755 && echo "exec bit OK"
```
Expected: `renew-cert.sh OK` and `exec bit OK` (`core.filemode=false` on Windows drops the +x bit on `chmod`; `git update-index --chmod=+x` sets it in the index, matching `install/*.sh`).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(install): renew-cert.sh (cron-driven LE renewal + gateway reload)"
```

---

## Task 3: `install.sh` — `--letsencrypt` issuance + cron

**Files:**
- Modify: `install/install.sh`

- [ ] **Step 1: Add the flags + the localhost guard**

In `install/install.sh`, update the flags doc comment (top) to include the new flags:
```sh
# Flags: --dir <path> (default ./openldr), --version <tag> (default latest),
#        --server-name <host> (default localhost — the public hostname/domain),
#        --letsencrypt <email> (issue a trusted Let's Encrypt cert for --server-name),
#        --staging (use the LE staging CA — for testing, avoids rate limits),
#        --no-start (scaffold + config only), --no-pull (skip image pull).
```

Add `LE_EMAIL=""` and `LE_STAGING=""` to the var block (next to `HOST="localhost"`), add the two cases to the `while`/`case` arg parser:
```sh
    --letsencrypt) LE_EMAIL="$2"; shift 2 ;;
    --staging) LE_STAGING=1; shift ;;
```
Immediately after `ORIGIN="https://$HOST"`, add the guard:
```sh
# Let's Encrypt needs a public hostname reachable over :80 — reject localhost / bare IPs.
if [ -n "$LE_EMAIL" ]; then
  if [ "$HOST" = "localhost" ] || echo "$HOST" | grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
    err "--letsencrypt needs a public --server-name (a domain), not localhost or an IP."
  fi
fi
```

- [ ] **Step 2: Fetch renew-cert.sh + record the LE email in .env**

In the scaffold `fetch` section (after the `init-target-db.sql` fetch), add:
```sh
fetch "deploy/install/renew-cert.sh" "$DIR/renew-cert.sh"
chmod +x "$DIR/renew-cert.sh" 2>/dev/null || true
```
In the `.env` heredoc, add a line right after `SEED_ON_START=true`:
```sh
LETSENCRYPT_EMAIL=$LE_EMAIL
```
(When `--letsencrypt` isn't passed this is an empty `LETSENCRYPT_EMAIL=` line — harmless; `renew-cert.sh` keys off `SERVER_NAME`, not the email.)

- [ ] **Step 3: Add the issuance + cron block after `docker compose up -d`**

The start section currently ends:
```sh
cd "$DIR"
[ "$NO_PULL" -eq 1 ] || docker compose pull
docker compose up -d
echo ""
echo "✓ OpenLDR is starting. Open $ORIGIN"
```
Insert this block BETWEEN `docker compose up -d` and the `echo ""` banner:
```sh

# Let's Encrypt: the stack is up (nginx serving the http-01 webroot on :80). Issue a trusted cert,
# install it where the gateway reads it, reload, and wire up auto-renewal. Non-fatal: on failure the
# stack stays up on the self-signed cert.
if [ -n "$LE_EMAIL" ]; then
  echo "→ Requesting Let's Encrypt cert for $HOST ${LE_STAGING:+(staging)}..."
  # give nginx a moment to be ready to serve the challenge
  i=0; while [ "$i" -lt 12 ]; do curl -fsS -o /dev/null "http://localhost/.well-known/acme-challenge/" 2>/dev/null && break; i=$((i+1)); sleep 2; done
  if docker compose --profile letsencrypt run --rm --entrypoint certbot certbot \
       certonly --webroot -w /var/www/certbot -d "$HOST" --email "$LE_EMAIL" \
       --agree-tos --no-eff-email --keep-until-expiring --non-interactive ${LE_STAGING:+--staging}; then
    docker compose --profile letsencrypt run --rm --entrypoint sh certbot -c \
      "cp /etc/letsencrypt/live/$HOST/fullchain.pem /certs-out/fullchain.pem && cp /etc/letsencrypt/live/$HOST/privkey.pem /certs-out/privkey.pem"
    docker compose exec gateway nginx -s reload
    echo "✓ Trusted cert installed for $ORIGIN"
    ABS_DIR="$(pwd)"
    if [ "$(id -u)" = "0" ]; then
      printf '0 3,15 * * * root cd %s && sh renew-cert.sh >> /var/log/openldr-cert.log 2>&1\n' "$ABS_DIR" > /etc/cron.d/openldr-cert
      chmod 0644 /etc/cron.d/openldr-cert
      echo "→ Installed auto-renewal cron: /etc/cron.d/openldr-cert"
    else
      echo "! Not root — add this to your crontab (crontab -e) for auto-renewal:"
      echo "  0 3,15 * * * cd $ABS_DIR && sh renew-cert.sh >> /tmp/openldr-cert.log 2>&1"
    fi
  else
    echo "! Let's Encrypt issuance failed (DNS not pointing at this host yet? port 80 blocked?)."
    echo "  The stack is UP on the self-signed cert. Once DNS/ports are ready, re-run the installer"
    echo "  with the same --server-name $HOST --letsencrypt $LE_EMAIL to retry."
  fi
fi
```
Note: the `${LE_STAGING:+--staging}` expansion adds `--staging` only when `--staging` was passed.

- [ ] **Step 4: Update the closing tip**

Replace the closing tip block (the `For a public domain…` / `For trusted TLS…` lines added earlier) with:
```sh
echo ""
echo "  Public domain + trusted TLS in one shot:"
echo "    install.sh --server-name your.domain.com --letsencrypt you@email.com"
echo "  (add --staging first to test without hitting Let's Encrypt rate limits)"
```

- [ ] **Step 5: Verify syntax, guard, and the no-start scaffold**

Run:
```bash
sh -n install/install.sh && echo "SYNTAX OK"
# guard: localhost + LE must error
bash install/install.sh --dir /tmp/le-guard --server-name localhost --letsencrypt x@y.com 2>&1 | grep -q "needs a public" && echo "GUARD OK"
# guard: bare IP + LE must error
bash install/install.sh --dir /tmp/le-guard --server-name 203.0.113.5 --letsencrypt x@y.com 2>&1 | grep -q "needs a public" && echo "IP GUARD OK"
# scaffold a domain install without starting → no issuance attempted, renew-cert.sh fetched, .env has the email
rm -rf /tmp/le-scaf
bash install/install.sh --dir /tmp/le-scaf --server-name example.com --letsencrypt me@example.com --no-start 2>&1 | tail -3
test -f /tmp/le-scaf/renew-cert.sh && echo "RENEW FETCHED"
grep -q "LETSENCRYPT_EMAIL=me@example.com" /tmp/le-scaf/.env && echo "ENV EMAIL OK"
rm -rf /tmp/le-guard /tmp/le-scaf
```
Expected: `SYNTAX OK`, `GUARD OK`, `IP GUARD OK`, the scaffold prints the `--no-start` banner (no certbot output — issuance only runs after `up`), `RENEW FETCHED`, `ENV EMAIL OK`.

- [ ] **Step 6: Commit**

```bash
git add install/install.sh
git commit -m "feat(install): --letsencrypt issues a trusted cert + installs auto-renewal cron"
```

---

## Task 4: `install.ps1` — warn-only LE note

**Files:**
- Modify: `install/install.ps1`

- [ ] **Step 1: Add the param + warning**

In `install/install.ps1`, add `[string]$Letsencrypt = ""` to the `param(...)` block (after `$ServerName`). After `$Origin = "https://$ServerName"`, add:
```powershell
if ($Letsencrypt) {
  Write-Host "! Let's Encrypt is only automated by the Linux installer (install.sh --letsencrypt)."
  Write-Host "  On Windows the cert is self-signed; for public TLS run install.sh on the server, or"
  Write-Host "  drop a real fullchain.pem + privkey.pem into $Dir/config/nginx/certs/ and restart."
}
```

- [ ] **Step 2: Verify PowerShell parses (best-effort on non-Windows)**

Run (if `pwsh` is available; otherwise eyeball against the param block):
```bash
command -v pwsh >/dev/null 2>&1 && pwsh -NoProfile -Command "\$null = [ScriptBlock]::Create((Get-Content -Raw install/install.ps1)); echo PS_PARSE_OK" || echo "pwsh not available — verified by reading: param has \$Letsencrypt, warning block after \$Origin"
```
Expected: `PS_PARSE_OK` (or the read-only confirmation). Confirm the `param()` block now lists `$Letsencrypt` and the warning references `install.sh --letsencrypt`.

- [ ] **Step 3: Commit**

```bash
git add install/install.ps1
git commit -m "feat(install): install.ps1 notes LE is Linux-only (self-signed on Windows)"
```

---

## Task 5: Docs + local verification gate

**Files:**
- Modify: `DEPLOYMENT.md`

- [ ] **Step 1: Document the LE install + renewal**

In `DEPLOYMENT.md`, in the install section (near the "One-line install" / installer text), add:
```markdown
### Trusted TLS (Let's Encrypt)

For a public domain, issue a trusted, auto-renewing cert in the install command:

```bash
curl -fsSL https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main/install/install.sh \
  | bash -s -- --server-name your.domain.com --letsencrypt you@email.com
```

Prereqs: the domain's DNS A-record points at the host, and ports 80 + 443 are reachable. Add
`--staging` first to test the flow without hitting Let's Encrypt's rate limits. Renewal is automatic
via `/etc/cron.d/openldr-cert` (running `renew-cert.sh` twice daily); if the installer isn't root it
prints the cron line to add manually. Without `--letsencrypt` the installer generates a self-signed
cert (browser warning; not usable on a domain that already served a trusted cert with HSTS).
```

- [ ] **Step 2: Full local gate**

Run:
```bash
cd deploy/install && printf 'SERVER_NAME=localhost\nOPENLDR_VERSION=latest\n' > .env
docker compose --profile letsencrypt config >/dev/null && echo COMPOSE_OK
rm -f .env; cd ../..
sh -n install/install.sh && sh -n deploy/install/renew-cert.sh && echo "SH SYNTAX OK"
# NUL-byte hygiene on the edited scripts (Windows checkout guard)
for f in install/install.sh deploy/install/renew-cert.sh; do test "$(tr -cd '\000' < "$f" | wc -c)" = "0" || echo "NUL in $f"; done; echo "NUL CHECK DONE"
```
Expected: `COMPOSE_OK`, `SH SYNTAX OK`, `NUL CHECK DONE` (no "NUL in ..." lines).

- [ ] **Step 3: Commit**

```bash
git add DEPLOYMENT.md
git commit -m "docs(install): document Let's Encrypt install + auto-renewal"
```

---

## Post-plan: droplet issuance (user-driven)

The real cert issuance needs the public domain + port 80, so the user runs it on the droplet:
```bash
# staging first (proves the http-01 flow without burning the rate limit):
curl -fsSL https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main/install/install.sh \
  | bash -s -- --dir ~/openldr --server-name openldr.online --letsencrypt you@email.com --staging
#   → a staging cert issues (browser shows a staging-CA warning, but the flow works)
# then the real cert (re-run without --staging; --keep-until-expiring makes it swap cleanly):
curl -fsSL …/install.sh | bash -s -- --dir ~/openldr --server-name openldr.online --letsencrypt you@email.com
curl -sI https://openldr.online/studio/   # 200 with a Let's Encrypt chain, no -k needed
ls -l /etc/cron.d/openldr-cert            # renewal cron present
```
Note: switching from staging to prod may need `--force-renewal` or clearing the staging cert
(`docker compose --profile letsencrypt run --rm --entrypoint sh certbot -c "rm -rf /etc/letsencrypt/live/openldr.online /etc/letsencrypt/archive/openldr.online /etc/letsencrypt/renewal/openldr.online.conf"`) since certbot keeps the staging cert until near expiry — call this out to the user.

## Self-Review notes (author)

- **Spec coverage:** A (compose certbot+webroot+volumes) → Task 1; C renew script → Task 2; B (flags/guard/issuance/cron/env) → Task 3; D (ps warn) → Task 4; docs + testing → Task 5; droplet issuance → Post-plan. All covered.
- **Consistency:** `certbot` `/certs-out` ↔ gateway `./config/nginx/certs`; `certbot-www` shared gateway↔certbot; `renew-cert.sh` uses the same `--profile letsencrypt` + copy paths as the issuance block; `SERVER_NAME` read in renew matches what `install.sh` writes.
- **Non-fatal issuance** honored (Task 3 Step 3 else-branch keeps the stack up).
- **Verify-then-adjust:** Task 5 Step 1 adapt the doc insertion to DEPLOYMENT.md's real headings.
