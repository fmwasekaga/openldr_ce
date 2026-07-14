# Distributed Sync — S4 (a+b+c): Config Reconcile + Status/Control + Working Sync UI

**Date:** 2026-07-14
**Slice:** S4a+b+c (first of the S4 sub-slices) — "make the Sync card real"
**Branch:** `feat/sync-s4-ui` (to cut)
**Parent architecture:** `docs/superpowers/specs/2026-07-02-distributed-sync-architecture-design.md` (north-star, `6fc9bb75`)
**Predecessors:** S1 push (`c5131a31`), S2 pull config (`fd7fee91`), S3 terminology pull (`84304da7`) — all pushed.
**Follows-with:** S4d (enrollment automation — central mints the Keycloak client + `site_id` mapper) is a SEPARATE later slice.

## Context & the bug this fixes

The sync engine (S1–S3) is fully built and config-gated by six discrete `app_settings` keys read by `readSyncConfig` (`packages/sync/src/config.ts`): `sync.enabled`, `sync.central_url`, `sync.oidc_issuer`, `sync.client_id`, `sync.client_secret` (encrypted), `sync.site_id`. The bootstrap `if (syncCfg)` block (`packages/bootstrap/src/index.ts:684`) starts the push + pull workers from those keys.

But there is a **disjoint pre-existing operator surface**: `packages/bootstrap/src/sync-settings.ts` (`getSyncConfig`/`setSyncConfig`) reads/writes a single JSON blob under `sync.config` (`packages/config/src/sync.ts`, `SyncConfigSchema` = `{enabled, mode, centralUrl, siteId, intervalMinutes}`). That blob is what the **Studio Sync card** (`apps/studio/src/pages/settings/General.tsx:184`, carrying a "not implemented" banner), the **`PUT /api/settings/sync`** route (`apps/server/src/settings-routes.ts:28`), and **`openldr settings sync`** (`packages/cli/src/settings.ts`) all write. The two key namespaces never intersect and the blob has NO credential fields, so **enabling sync through the UI/CLI writes a blob the workers never read → sync silently stays off.** The S2 and S3 specs both explicitly defer this reconciliation to S4.

This slice reconciles the surfaces, honors `mode`/`interval`, exposes worker status + a "sync now" control, and turns the existing Sync card into a live, working card.

## Scope (this slice = S4a + S4b + S4c)

**In:**
- **S4a — config reconcile:** discrete `sync.*` keys become the single source of truth; the operator surface writes them; the `sync.config` blob is retired with a one-time migration; `mode`/`interval_minutes` folded in and honored by the workers.
- **S4b — status + control:** a `sync` handle on `AppContext`; `GET /api/settings/sync/status` + `POST /api/settings/sync/now`; `openldr sync status|now`.
- **S4c — Sync UI:** rework the existing Sync card to the reconciled config + live status + sync-now.

**Out (later slices):** S4d enrollment automation (`openldr sync enroll`, central-mints Keycloak client + `site_id` protocol-mapper + secret + site registry); `openldr sync export|import` (store-and-forward, S5); disabling the lab's local terminology-import UI (optional, dropped from this slice); pull-pending count (needs central's head — deferred).

## Design

### S4a — config reconciliation

**Storage model:** the six existing discrete keys + two new ones become the sole source of truth (the workers and `fhir-store.resolveSiteId` already read `sync.*`):
- `sync.enabled` (`'true'`/`'1'`), `sync.central_url`, `sync.site_id`, `sync.oidc_issuer`, `sync.client_id`, `sync.client_secret` (encrypted at rest via `SECRETS_ENCRYPTION_KEY`), plus NEW `sync.mode` (`'push'|'pull'|'bidirectional'`, default `'bidirectional'`) and `sync.interval_minutes` (int 1–1440, default from the blob's default 15).

**`readSyncConfig` (`packages/sync/src/config.ts`)** — extend `SyncConfig` with `mode: 'push'|'pull'|'bidirectional'` and `intervalMinutes: number`, read from the two new keys with sane defaults. The existing null-when-disabled/misconfigured semantics stay (credentials still required when enabled).

**Operator write surface — rewrite to the discrete keys:**
- `sync-settings.ts` `setSyncConfig` writes the discrete keys (not the blob). It now also accepts/writes `oidcIssuer`/`clientId`/`clientSecret` (secret encrypted via the same helper the connector store uses; write-only). `getSyncConfig` reads the discrete keys and returns a shape WITHOUT the secret (a `clientSecretSet: boolean` instead), so the UI/CLI never receive the secret. Keep `mode`/`intervalMinutes`.
- `PUT /api/settings/sync` (`settings-routes.ts`) + `openldr settings sync set` accept the extended field set (enabled/mode/centralUrl/siteId/oidcIssuer/clientId/clientSecret/intervalMinutes); `GET`/`show` never return the secret.

**One-time migration:** a helper `migrateLegacySyncConfig(appSettings)` run once at boot (in `createAppContext`, before `readSyncConfig`): if `sync.config` blob exists AND `sync.enabled` (discrete) is absent, copy the blob's `enabled/mode/centralUrl/siteId/intervalMinutes` into the discrete keys, then delete (or leave-and-ignore) the blob. Idempotent (guarded by "discrete keys absent"). Existing installs that configured via the old UI self-heal; new installs never touch the blob. Document that credentials still must be supplied (the old blob never had them).

### S4b — worker gating + status/control

**Mode gating (bootstrap `index.ts`):** in the `if (syncCfg)` block, start the push worker only when `mode !== 'pull'` and the pull worker only when `mode !== 'push'` (bidirectional starts both). Replace the hardcoded `intervalMs: 5000` on both workers with `syncCfg.intervalMinutes * 60_000`.

**Expose a sync handle on `AppContext`:** the push/pull workers are currently local vars. Add `sync?: SyncHandle` to `AppContext` where
```ts
interface SyncHandle {
  status(): Promise<SyncStatus>;
  triggerNow(): void;   // triggers the started worker(s)
}
interface SyncStatus {
  enabled: boolean; mode: 'push'|'pull'|'bidirectional'; centralUrl: string; siteId: string;
  push: { running: boolean; lastSeq: number; lastSyncedAt: string | null } | null;   // null when push not started
  pull: { running: boolean; lastSeq: number; lastSyncedAt: string | null } | null;
  pendingPush: number;   // local change_log max(seq) − 'sync-push' cursor (0 when caught up / push off)
}
```
`status()` reads the `'sync-push'`/`'sync-pull'` cursors (`change_cursors.last_seq` + `updated_at`) and the local `change_log` max seq for `pendingPush`; `running` from the worker (add a `running()`/`isRunning` getter to the worker host loops, which currently only expose start/stop/trigger). When sync is disabled, `AppContext.sync` is still present but `status()` returns `enabled:false` with null push/pull (so the UI/CLI can always render "sync off").

**Endpoints (user-authed, under `/api/settings/sync/*` — NOT `/api/sync/*`, which the machine-auth bypass skips):**
- `GET /api/settings/sync/status` (`requireRole('lab_admin')`) → `SyncStatus` from `ctx.sync.status()`.
- `POST /api/settings/sync/now` (`requireRole('lab_admin')`) → `ctx.sync.triggerNow()`; 200 `{triggered:true}`; if sync disabled → 409/`{triggered:false, reason:'disabled'}`.
Both audited via the existing settings-route audit pattern.

**CLI (`packages/cli/src/sync.ts` + a new `openldr sync` group in `cli/src/index.ts`):** `openldr sync status` (prints the status table) + `openldr sync now` (calls `ctx.sync.triggerNow()`), following the `createAppContext(loadConfig())` → `finally ctx.close()` pattern. (These run in-process against the lab's own db + workers.)

### S4c — Sync UI (rework the existing card)

`apps/studio/src/pages/settings/General.tsx` Sync card + `apps/studio/src/api.ts` helpers:
- Remove the "not implemented" preview banner.
- **Config form** (writes the reconciled `PUT /api/settings/sync`): enabled (`Switch`), mode (`Select`: Push only / Pull only / Bidirectional), central URL (`Input`), site id (`Input`), OIDC issuer (`Input`), client id (`Input`), client secret (`Input type=password`, write-only — placeholder shows "•••• set" when `clientSecretSet`, blank submit = unchanged), interval minutes (`Input type=number`). shadcn primitives only.
- **Status panel** (reads `GET /api/settings/sync/status`, refetch on load + after "Sync now"): enabled badge, per-direction "last synced <relativetime> · seq N · running/idle", pending-push count; a **Sync now** button (`POST /api/settings/sync/now`, toast on result). Poll/refetch status every ~10s while the card is mounted (or a manual refresh button — keep it simple).
- i18n: add the new labels to en/fr/pt (the repo requires all three per the i18n workstream); reuse/extend the existing `settings.general.sync.*` keys, drop the `preview` key.
- Update `api.ts` `SyncConfig` type (+ `mode`/`intervalMinutes`/`oidcIssuer`/`clientId`/`clientSecretSet`, secret write-only) + add `fetchSyncStatus`/`triggerSyncNow`.

## Testing

- **Unit:** `migrateLegacySyncConfig` (blob→discrete once; idempotent; no-op when discrete present; leaves credentials for the operator); `readSyncConfig` mode/interval parsing + defaults; `getSyncConfig`/`setSyncConfig` round-trip the discrete keys + never returns the secret + encrypts it; mode-gated worker startup (push-only starts only push; pull-only only pull; bidirectional both; interval respected); the status handle (`status()` reads cursors + pendingPush; `triggerNow` calls the started workers); the two endpoints (auth 401/403, status shape, now-when-disabled → 409); the CLI commands.
- **Studio:** a component test (or a throwaway Playwright e2e per the repo's live-drive convention) that the Sync card loads config, saves, shows status, and "Sync now" hits the endpoint. Gate: studio typecheck + the studio api.test mirror stays green.
- **Live smoke (deliberate, per repo convention):** with `AUTH_DEV_BYPASS` + dev PG, load `/settings`, toggle enabled + set central/site/mode, confirm the discrete keys land and (with a reachable central or a stub) the workers start per mode; confirm `openldr sync status` prints and `sync now` triggers. Flag any dev shortcut used.

## Deliberate shortcuts / deferrals (S4a-c)

- Credentials entered manually in the card (paste from enrollment output) — automated minting is S4d.
- `pendingPull` count deferred (needs central's head).
- No new migration table — `sync.mode`/`sync.interval_minutes` are just new `app_settings` keys.
- Status polling is client-side refetch (no websockets).
- Retiring the blob: migrate-on-boot once; the `sync.config` key is left in place but ignored (or deleted) — pick delete for cleanliness in the plan.

## Build order (implementation plan will detail)

1. `readSyncConfig` + `SyncConfig` extend (`mode`/`intervalMinutes`).
2. `migrateLegacySyncConfig` + wire at boot.
3. Rewrite `getSyncConfig`/`setSyncConfig` onto discrete keys (+ credentials, secret write-only/encrypted) + `PUT/GET /api/settings/sync` + `openldr settings sync`.
4. Mode-gating + interval in bootstrap; worker `isRunning()` getter.
5. `SyncHandle` on `AppContext` + `status()`/`triggerNow()`.
6. `GET/POST /api/settings/sync/{status,now}` + `openldr sync status|now`.
7. Sync card rework + `api.ts` helpers + i18n.
8. Gate (incl. S1/S2/S3 acceptance regressions — shared config/bootstrap touched) + whole-slice review + merge + (push on user go).

## Relates to

[[distributed-sync-central-workstream]] (parent), S1/S2/S3 (the engine this makes operable), [[settings-general-feature-flags]] (the Settings→General card home + feature-flag pattern), [[cli-operator-parity]] (new operator features need CLI parity — `openldr sync …`), [[i18n-workstream]] (en/fr/pt for the new UI), [[use-shadcn-components]]/[[corlix-design-source-of-truth]] (UI conventions). S4d enrollment automation follows.
