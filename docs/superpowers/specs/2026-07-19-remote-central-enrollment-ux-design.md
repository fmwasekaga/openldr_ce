# Remote-central enrollment UX + live sync

**Date:** 2026-07-19
**Status:** Approved — ready for implementation plans (per-slice)
**Branch:** `claude/remote-central-ux`

## Problem / motivation

The LAN live test surfaced friction that will bite harder when the central is remote
(DigitalOcean/WAN). Bringing a lab online today requires undocumented manual steps: hand-copying
the central's TLS cert, and **restarting the api** after enabling sync (the toggle writes config the
running process never re-reads). The bar (user's words): *"I need to be able to follow docs and it
should just work."* Five asks, grouped into three slices:

1. Download the central's public cert from the Sites page ⋯ menu. *(Slice 2)*
2. Move the standalone **Enroll site** button into the ⋯ menu. *(Slice 2)*
3. Docs: why the cert is needed + where it goes. *(Slice 3)*
4. Enabling sync must NOT require a server restart. *(Slice 1)*
5. The whole remote-enroll flow must be followable from docs and "just work". *(Slice 3, ties the rest)*

## Decisions (agreed during brainstorming)

- **D1 — cert serving:** an **authed api endpoint** serves the central's TLS cert, and the enroll-success
  dialog offers the same download (so a freshly-enrolled lab gets the cert in the same step as its
  credentials). Not the public-gateway-static option.
- **D2 — scope/order:** all three slices this round; **Slice 1 (live reload) first**, then Slice 2, then Slice 3.

---

## Slice 1 — Live sync reconcile (no restart)

### Today
`createAppContext` reads `readSyncConfig` **once** and starts the push/pull workers inside a single
`if (syncCfg)` block (`packages/bootstrap/src/index.ts` ~L779-980); `SyncHandle` is built with a
boot-time `enabled: !!syncCfg` (L977). The workers are `DrainWorker`s with `stop()` (already called at
shutdown, L1157-1158). `setSyncConfig` (`sync-settings.ts`, S4a) persists the discrete `sync.*` keys but
nothing re-reads them, so the toggle appears to save yet the workers stay in their boot state → `now`
returns 409 disabled, status shows "not started".

### Design
Introduce a **`SyncRuntime`** (new `packages/bootstrap/src/sync-runtime.ts`) that owns the sync worker
lifecycle and the live enabled/mode state:

- Holds mutable `pushWorker?`, `pullWorker?`, and derived `enabled`/`mode`/`centralUrl`/`siteId`.
- `reconcile()`: serialized via an in-flight lock (no overlapping reconciles). Steps: (a) `stop()` any
  running workers and await their loop settling; (b) `readSyncConfig(appSettings, decrypt, logger)`;
  (c) if `null` → leave workers stopped, `enabled=false`; (d) else rebuild the shared token
  provider + `postJson`/`postPush`/`fetchContent` closures for the CURRENT config (central URL /
  credentials / interval can all have changed), then start `createSyncPushWorker`/`createSyncPullWorker`
  gated by `shouldStartPush(mode)`/`shouldStartPull(mode)`, and set `enabled=true`, mode, etc.
- `triggerNow()` / `isRunning` delegate to the current workers.

Wiring:
- The worker-building block currently inline in `createAppContext` moves into `SyncRuntime.reconcile()`
  (single source of truth). Boot calls `syncRuntime.reconcile()` once (replaces the inline `if (syncCfg)`
  start); shutdown calls `syncRuntime.stop()`.
- `SyncHandle` delegates `enabled`/`mode`/`centralUrl`/`siteId`/workers to the runtime (live), so
  `status()` and the `now` gate reflect reality on the next poll — no restart.
- **`setSyncConfig` calls `ctx.syncRuntime.reconcile()` after it commits** the config. The Settings
  toggle's Save already calls `setSyncConfig`, so enable/disable/reconfigure takes effect immediately.
  Also expose it so the CLI `openldr settings sync` path reconciles the same way (best-effort — a CLI
  process reconciling its own ephemeral context is a no-op against the server; the server reconciles when
  it next serves the settings write — see Open questions).

### Invariants / edge cases
- A reconcile while a cycle is running: `stop()` sets the DrainWorker's stop flag; await the in-flight
  cycle (bounded) before rebuilding. Never start a second worker for the same direction.
- Config incomplete-but-enabled → `readSyncConfig` returns null (existing behavior) → workers stopped,
  `enabled=false`, warning logged. The UI status reflects "not started".
- Disable → reconcile stops workers; cursors are durable (no data loss); re-enable restarts from cursor.
- No change to the wire, the push/pull endpoints, `applyRemote`, or cursors.

### Testing
- Unit (`sync-runtime.test.ts`): reconcile from disabled→enabled starts the right workers per mode;
  enabled→disabled stops them; mode change (push→bidirectional) starts the pull worker; concurrent
  `reconcile()` calls serialize; incomplete config → no workers + `enabled=false`.
- Live acceptance: on the running lab stack, `POST /api/settings/sync` toggling enabled true→false→true
  (no restart) and observing `GET /api/settings/sync/status` flip `enabled`/`push.running` and `now`
  return `triggered:true` — all without restarting the container.

---

## Slice 2 — Sites page ⋯ menu + cert download

### Backend
- Installer mounts the central's cert into the api read-only, e.g.
  `./config/nginx/certs/fullchain.pem:/etc/openldr/tls-cert.pem:ro` (both `install.sh` + `install.ps1`
  generated compose, and the repo `deploy` compose). New config key `TLS_CERT_PATH`
  (default `/etc/openldr/tls-cert.pem`, optional) so the api knows where to read it.
- `GET /api/settings/sync/central-certificate` (`requireRole('lab_admin')`): reads the PEM file at
  `TLS_CERT_PATH`; returns it with `Content-Type: application/x-pem-file` and
  `Content-Disposition: attachment; filename="central-<host>.pem"`. 404 (coded) when the path is unset or
  the file is absent — with a message telling the operator to mount the cert. PEM is public (not a
  secret), but the route is authed for consistency with the rest of `/api/settings/*`.

### Frontend (`apps/studio/src/pages/settings/Sites.tsx`)
- Remove the standalone **Enroll site** button; the page header keeps only the ⋯ menu.
- ⋯ menu items: **Enroll site** (opens the existing enroll dialog) and **Download central certificate**
  (hits the endpoint, saves the `.pem`). Use the existing shadcn DropdownMenu (per repo UI conventions —
  no native controls) and lucide icons.
- The one-time enroll-success dialog gains a **Download central certificate** action next to the copyable
  credentials, so the operator captures cert + credentials together.
- api client (`apps/studio/src/api.ts`) gains `downloadCentralCertificate()`; i18n en/fr/pt strings for
  the new labels (EnShape parity).

### Testing
- Server unit: endpoint returns the PEM with the right headers when the file exists; coded 404 when
  unset/missing; role-gated (403 without lab_admin).
- Live: click-through on the Sites page ⋯ → Download returns the central's actual `fullchain.pem`.

---

## Slice 3 — Docs + "just works" remote-enroll flow

A single documented walkthrough (studio + web docs `sync.md`/equivalents, versioned `0.1.0`), covering:
1. **On the central:** Settings → Sites → ⋯ → Enroll site (siteId, name, central URL) → copy credentials
   → ⋯ → Download central certificate.
2. **On the lab:** place the cert (WHERE: mount into the api + set `NODE_EXTRA_CA_CERTS`; WHY: the lab's
   sync worker makes a server-to-server HTTPS call to the central and must trust its cert — browsers
   don't, Node doesn't by default; for an IP/self-signed central the cert must carry an **IP SAN**, cross-ref
   the installer fix). Paste the credentials into Settings → Sync. Toggle **Enable sync** → Save. Done —
   **no restart** (Slice 1).
3. Troubleshooting table mapping the exact errors we hit to fixes: `IdentityAdminNotConfigured` (503),
   `ECONNREFUSED` (internal issuer), `self-signed certificate` / `ERR_TLS_CERT_ALTNAME_INVALID`,
   "Sync disabled — nothing to trigger".
- Fold in the two filed installer fixes (KEYCLOAK_ADMIN_CLIENT_* wiring — merged; cert IP-SAN — pending)
  so a fresh `curl … install.sh | bash` central + a lab both land in a state the walkthrough assumes.

---

## Out of scope / follow-ups
- Centralised cross-lab cert distribution / rotation UI.
- Auto-mounting the cert on the LAB side (still an operator step; documented, not automated this round).
- The CDR `cdr-ingest` webhook seeding (separate concern; tracked in memory).

## Open questions (resolve in per-slice plans)
- CLI-triggered `setSyncConfig` reconcile: the server owns the live workers; a CLI process can't reconcile
  the server's runtime. Options: CLI writes config + prints "restart or toggle in UI to apply", OR a
  lightweight NOTIFY the server listens for. Lean: document that the UI/live path reconciles; CLI stays
  config-write-only for now (no regression — matches today).
