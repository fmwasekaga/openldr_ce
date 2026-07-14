# Distributed Sync S4 (a+b+c) — Config Reconcile + Status/Control + Working Sync UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enabling sync in the Settings UI / CLI actually starts the workers (fixes the disjoint-config bug), the workers honor `mode`/`interval`, and the Sync card shows live per-direction status with a "Sync now" control — proven end-to-end.

**Architecture:** The six discrete `sync.*` `app_settings` keys the workers already read become the single source of truth; the operator surface (`sync-settings.ts` + `PUT /api/settings/sync` + `openldr settings sync` + the Studio card) is rewritten to write them (adding `sync.mode`/`sync.interval_minutes` + the OIDC/client credentials, secret write-only/encrypted); a one-time boot migration folds any legacy `sync.config` blob into the discrete keys. Bootstrap gates worker startup by `mode` and uses `interval_minutes`. A `SyncHandle` on `AppContext` exposes `status()` (reads `change_cursors` + local `change_log` head) and `triggerNow()`; new user-authed `GET/POST /api/settings/sync/{status,now}` + `openldr sync status|now` surface them; the Sync card is reworked to the reconciled config + live status.

**Tech Stack:** TypeScript, Kysely, Zod (`@openldr/config`), Fastify (`apps/server`), commander (`@openldr/cli`), React + shadcn (`apps/studio`), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-distributed-sync-s4-reconcile-status-ui-design.md`

**Key substrate to read first (all exist):**
- `packages/sync/src/config.ts` — worker `SyncConfig` (6 fields) + `readSyncConfig(appSettings, decrypt, logger?)` + the `sync.*` key consts + `isTruthy`. (EXTEND here.)
- `packages/config/src/sync.ts` — operator `SyncConfigSchema`/`SyncConfig`/`SyncMode`/`SYNC_CONFIG_KEY`/`parseSyncConfig`/`DEFAULT_SYNC_CONFIG`. **NOTE the naming collision:** `@openldr/config` exports a `SyncConfig` (operator DTO) AND `@openldr/sync` exports a `SyncConfig` (resolved worker cfg) — keep them distinct; import with aliases where both are needed.
- `packages/bootstrap/src/sync-settings.ts` — `getSyncConfig`/`setSyncConfig` (currently blob). (REWRITE to discrete keys.)
- `apps/server/src/settings-routes.ts` — `GET/PUT /api/settings/sync` (+ the audit + `requireRole('lab_admin')` pattern; this is where `/status` + `/now` go).
- `packages/cli/src/settings.ts:72-118` — `SYNC_FIELDS`/`runSettingsSyncShow`/`runSettingsSyncSet`; `packages/cli/src/index.ts:122,141` — command registration (where a new `openldr sync` group attaches).
- `packages/bootstrap/src/index.ts:673-794` — the `if (syncCfg)` block (worker construction, cursors `readChangeCursor('sync-push'|'sync-pull')`, `intervalMs: 5000` at ~:722,:787, `syncDecrypt` at ~:675), the `AppContext` interface (~:243-296), and `close()` (~:960).
- `packages/bootstrap/src/sync-push-worker.ts` + `sync-pull-worker.ts` — the host loops (`start/stop/trigger`, internal `running`/`stopped`). (ADD `isRunning()`.)
- `packages/db/src/projection/cursor.ts` — `readCursor(db, consumer)` (returns `Number(last_seq)`); you'll also read `updated_at` for `lastSyncedAt`.
- `apps/studio/src/pages/settings/General.tsx:184-249` (the Sync card) + `apps/studio/src/api.ts:348-360` (`SyncConfig`/`SyncMode`, `fetchSyncConfig`/`saveSyncConfig`, `authFetch`) — the UI to rework.
- How the connector store encrypts secrets (`seal`/`open` + `parseSecretKey` from `@openldr/core`, keyed by `cfg.SECRETS_ENCRYPTION_KEY`) — reuse for `sync.client_secret`.

**Global rules:** `pnpm exec`/`pnpm --filter`, never raw `node_modules/.bin/*`. NEVER a `Co-Authored-By` trailer. shadcn primitives only (never native `<select>`). All three locales (en/fr/pt) for new UI strings.

---

## Task 0: Cut the branch

- [ ] `git checkout main && git checkout -b feat/sync-s4-ui && git branch --show-current` → `feat/sync-s4-ui`, clean tree.

---

## Task 1: extend the worker `SyncConfig` + `readSyncConfig` with `mode` + `intervalMinutes`

**Files:** Modify `packages/sync/src/config.ts` + `packages/sync/src/config.test.ts`.

- [ ] **Step 1:** extend the interface + key consts:
```ts
export type SyncMode = 'push' | 'pull' | 'bidirectional';
export interface SyncConfig {
  enabled: boolean; centralUrl: string; oidcIssuer: string; clientId: string;
  clientSecret: string; siteId: string;
  mode: SyncMode;            // NEW
  intervalMinutes: number;   // NEW
}
const KEY_MODE = 'sync.mode';
const KEY_INTERVAL = 'sync.interval_minutes';
```
- [ ] **Step 2:** in `readSyncConfig`, after the required fields resolve, read the two new keys with defaults + validation:
```ts
const modeRaw = (await readValue(appSettings, KEY_MODE)).toLowerCase();
const mode: SyncMode = modeRaw === 'push' || modeRaw === 'pull' ? modeRaw : 'bidirectional';
const intervalRaw = Number(await readValue(appSettings, KEY_INTERVAL));
const intervalMinutes = Number.isFinite(intervalRaw) && intervalRaw >= 1 && intervalRaw <= 1440 ? Math.floor(intervalRaw) : 15;
```
Return them in the `SyncConfig`. Everything else unchanged (still null-when-disabled/misconfigured).

- [ ] **Step 3:** tests — add cases: `sync.mode='push'`/`'pull'`/absent→'bidirectional'/garbage→'bidirectional'; `sync.interval_minutes='30'`→30, absent→15, out-of-range→15. Keep existing tests green.
- [ ] **Step 4:** `pnpm --filter @openldr/sync exec tsc --noEmit && pnpm --filter @openldr/sync exec vitest run src/config.test.ts` → clean/green. Commit `feat(sync): readSyncConfig mode + interval_minutes (sync S4)`.

---

## Task 2: rework the operator config surface onto the discrete keys + legacy migration

**Files:** Modify `packages/config/src/sync.ts` (operator DTO schema); Rewrite `packages/bootstrap/src/sync-settings.ts`; Create `packages/bootstrap/src/sync-settings-migrate.ts`; Tests for both.

- [ ] **Step 1: operator DTO schema (`packages/config/src/sync.ts`)** — extend to the full operator field set; the secret is WRITE-ONLY (input accepts it, output reports only `clientSecretSet`). Keep `SYNC_CONFIG_KEY`/`SyncMode`/`SyncModeSchema` (blob key still referenced by the migration). Add:
```ts
// Input accepted by setSyncConfig / PUT / CLI. clientSecret optional & write-only: blank/absent = leave unchanged.
export const SyncConfigInputSchema = z.object({
  enabled: z.boolean().default(false),
  mode: SyncModeSchema.default('bidirectional'),
  centralUrl: z.string().default(''),
  siteId: z.string().default(''),
  oidcIssuer: z.string().default(''),
  clientId: z.string().default(''),
  clientSecret: z.string().optional(),        // write-only; undefined/'' = unchanged
  intervalMinutes: z.number().int().positive().max(1440).default(15),
}).superRefine((c, ctx) => {
  if (c.centralUrl && !/^https?:\/\//i.test(c.centralUrl)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['centralUrl'], message: 'centralUrl must be an http(s) URL' });
  if (c.oidcIssuer && !/^https?:\/\//i.test(c.oidcIssuer)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['oidcIssuer'], message: 'oidcIssuer must be an http(s) URL' });
  if (c.enabled) for (const [f, v] of [['centralUrl', c.centralUrl], ['siteId', c.siteId], ['oidcIssuer', c.oidcIssuer], ['clientId', c.clientId]] as const)
    if (!v) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [f], message: `${f} is required when sync is enabled` });
});
export type SyncConfigInput = z.infer<typeof SyncConfigInputSchema>;
// Output returned by getSyncConfig / GET / show. No secret value — a boolean instead.
export interface SyncConfigView {
  enabled: boolean; mode: SyncMode; centralUrl: string; siteId: string;
  oidcIssuer: string; clientId: string; clientSecretSet: boolean; intervalMinutes: number;
}
```
Keep the legacy `SyncConfigSchema`/`SyncConfig`/`parseSyncConfig`/`DEFAULT_SYNC_CONFIG` (the migration reads old blobs with them). Add a deprecation comment.

- [ ] **Step 2: rewrite `sync-settings.ts`** to read/write the discrete `sync.*` keys (NOT the blob). Inject `encrypt` for the secret:
```ts
import { SyncConfigInputSchema, type SyncConfigView, type SyncMode } from '@openldr/config';
import type { AppSettingStore } from '@openldr/db';

const K = { enabled: 'sync.enabled', mode: 'sync.mode', centralUrl: 'sync.central_url', siteId: 'sync.site_id',
  oidcIssuer: 'sync.oidc_issuer', clientId: 'sync.client_id', clientSecret: 'sync.client_secret', interval: 'sync.interval_minutes' };

export async function getSyncConfig(store: AppSettingStore): Promise<SyncConfigView> {
  const g = async (k: string) => (await store.get(k))?.value ?? '';
  const secret = await g(K.clientSecret);
  const intervalRaw = Number(await g(K.interval));
  const modeRaw = (await g(K.mode)).toLowerCase();
  return {
    enabled: ['true', '1'].includes((await g(K.enabled)).trim().toLowerCase()),
    mode: (modeRaw === 'push' || modeRaw === 'pull' ? modeRaw : 'bidirectional') as SyncMode,
    centralUrl: await g(K.centralUrl), siteId: await g(K.siteId),
    oidcIssuer: await g(K.oidcIssuer), clientId: await g(K.clientId),
    clientSecretSet: secret.length > 0,
    intervalMinutes: Number.isFinite(intervalRaw) && intervalRaw >= 1 && intervalRaw <= 1440 ? Math.floor(intervalRaw) : 15,
  };
}

export async function setSyncConfig(
  store: AppSettingStore, input: unknown, actor: string | null, encrypt: (plain: string) => string,
): Promise<SyncConfigView> {
  const c = SyncConfigInputSchema.parse(input);
  await store.set(K.enabled, String(c.enabled), actor);
  await store.set(K.mode, c.mode, actor);
  await store.set(K.centralUrl, c.centralUrl, actor);
  await store.set(K.siteId, c.siteId, actor);
  await store.set(K.oidcIssuer, c.oidcIssuer, actor);
  await store.set(K.clientId, c.clientId, actor);
  await store.set(K.interval, String(c.intervalMinutes), actor);
  // Secret is write-only: only overwrite when a non-empty value is supplied (blank submit / CLI patch preserves it).
  if (typeof c.clientSecret === 'string' && c.clientSecret.length > 0) await store.set(K.clientSecret, encrypt(c.clientSecret), actor);
  return getSyncConfig(store);
}
```
(`sync.site_id` MUST stay the key `fhir-store.resolveSiteId` reads.)

- [ ] **Step 3: `sync-settings-migrate.ts`** — one-time blob→discrete migration:
```ts
import { SYNC_CONFIG_KEY, parseSyncConfig } from '@openldr/config';
import type { AppSettingStore } from '@openldr/db';

/** If a legacy `sync.config` blob exists AND the discrete `sync.enabled` key is absent, copy the blob's
 *  fields into the discrete keys once (credentials were never in the blob — the operator must still supply
 *  them). Idempotent: a no-op once discrete keys exist. Returns true if it migrated. */
export async function migrateLegacySyncConfig(store: AppSettingStore, actor: string | null = 'migration'): Promise<boolean> {
  const blob = await store.get(SYNC_CONFIG_KEY);
  if (!blob?.value) return false;
  const discrete = await store.get('sync.enabled');
  if (discrete) return false; // already reconciled
  const cfg = parseSyncConfig(blob.value);
  await store.set('sync.enabled', String(cfg.enabled), actor);
  await store.set('sync.mode', cfg.mode, actor);
  await store.set('sync.central_url', cfg.centralUrl, actor);
  await store.set('sync.site_id', cfg.siteId, actor);
  await store.set('sync.interval_minutes', String(cfg.intervalMinutes), actor);
  await store.set(SYNC_CONFIG_KEY, '', actor); // tombstone the blob (empty value = ignored henceforth)
  return true;
}
```
Export both from the `@openldr/bootstrap` barrel.

- [ ] **Step 4: tests** — `getSyncConfig` reads discrete keys + never returns a secret value (`clientSecretSet` reflects presence); `setSyncConfig` writes all keys, encrypts the secret (assert the stored `sync.client_secret` ≠ plaintext and a blank/absent secret leaves the existing one untouched), validates (enabled requires central/site/oidc/clientId); `migrateLegacySyncConfig` migrates a blob once, is a no-op when discrete keys exist, no-op when no blob. Use a fake/real `AppSettingStore` + a fake `encrypt`.
- [ ] **Step 5:** typecheck (`@openldr/config` + `@openldr/bootstrap`) + tests + commit `feat(sync): operator sync config on discrete keys + legacy-blob migration (sync S4)`.

---

## Task 3: update `PUT/GET /api/settings/sync` + `openldr settings sync` for the extended fields

**Files:** Modify `apps/server/src/settings-routes.ts`; Modify `packages/cli/src/settings.ts`; Tests.

- [ ] **Step 1: route** — `GET` unchanged shape-wise (returns `SyncConfigView`, no secret). `PUT` now needs the `encrypt` fn: build it once where routes are registered (or add `ctx.encryptSecret`/`ctx.decryptSecret` to `AppContext` in Task 5 and use it — decide: simplest is a small `encryptSecret(plain)` on `AppContext` since Task 5 already touches AppContext; for Task 3 you may thread a local `encrypt` built from `cfg.SECRETS_ENCRYPTION_KEY` via `seal`+`parseSecretKey`, OR depend on the Task 5 `ctx.encryptSecret` — if so, reorder so Task 5's AppContext addition lands first; SIMPLEST: add `ctx.encryptSecret` in THIS task on AppContext and reuse in Task 5). Pass `ctx.encryptSecret` to `setSyncConfig(ctx.appSettings, req.body, actor, ctx.encryptSecret)`. Keep the audit (`action: 'settings.sync.update'`, but change `entityId` from `SYNC_CONFIG_KEY` to `'sync.*'` and don't log the secret — `before`/`after` are `SyncConfigView`, already secret-free).
- [ ] **Step 2: `AppContext.encryptSecret`** — add `encryptSecret(plain: string): string` (and optionally `decryptSecret`) to the `AppContext` interface + construct it in `createAppContext` as `(p) => seal(p, parseSecretKey(cfg.SECRETS_ENCRYPTION_KEY ?? ''))` (mirror `syncDecrypt`). This gives routes/CLI a single secret helper.
- [ ] **Step 3: CLI** — extend `SYNC_FIELDS` to `['enabled','mode','centralUrl','siteId','oidcIssuer','clientId','clientSecret','intervalMinutes']`; `coerceSyncField` handles the new string fields (clientSecret passthrough); `runSettingsSyncSet` reads current `SyncConfigView` (no secret) + patches the one field + calls `setSyncConfig(..., ctx.encryptSecret)`. `runSettingsSyncShow` prints the view (shows `clientSecretSet` not the secret). The patch preserves the existing secret because `SyncConfigView` has no `clientSecret` field, so a non-secret field patch never overwrites `sync.client_secret` (setSyncConfig only writes it when a non-empty `clientSecret` is in the input).
- [ ] **Step 4: tests** — `settings-routes.test.ts`: PUT with the extended body persists + returns a secret-free view; PUT with a `clientSecret` stores it encrypted; GET never returns the secret; 400 on enabled-without-oidc. CLI test if present. 401/403 via `requireRole` (existing pattern).
- [ ] **Step 5:** typecheck (`@openldr/server` + `@openldr/cli` + `@openldr/bootstrap`) + tests + commit `feat(server): sync settings route + CLI on discrete keys (credentials, secret write-only) (sync S4)`.

---

## Task 4: mode-gated worker startup + interval + boot migration + `isRunning()`

**Files:** Modify `packages/bootstrap/src/index.ts`, `sync-push-worker.ts`, `sync-pull-worker.ts`; Tests.

- [ ] **Step 1: `isRunning()` getter** — add to `SyncPushWorker`/`SyncPullWorker` interfaces + impls: `isRunning(): boolean` returning `!stopped && timer !== undefined` (or the real "started and not stopped" state — read the host loop). Keep start/stop/trigger.
- [ ] **Step 2: boot migration** — in `createAppContext`, BEFORE `readSyncConfig`, call `await migrateLegacySyncConfig(appSettings).catch(() => false)` (best-effort; a failure must not crash boot, consistent with the existing readSyncConfig try/catch).
- [ ] **Step 3: mode-gating + interval** — in the `if (syncCfg)` block, gate:
```ts
const intervalMs = syncCfg.intervalMinutes * 60_000;
if (syncCfg.mode !== 'pull') { /* build + start push worker */ syncPushWorker = createSyncPushWorker({ runner, intervalMs, logger }); syncPushWorker.start(); }
if (syncCfg.mode !== 'push') { /* build + start pull worker */ syncPullWorker = createSyncPullWorker({ runner: pullRunner, intervalMs, logger }); syncPullWorker.start(); }
```
Replace both hardcoded `intervalMs: 5000`. The token provider + `postJson` + cursors are shared as today; ensure a pull-only lab still builds the token provider (it's needed by pull too). Keep the shutdown `stop()` for whichever started.
- [ ] **Step 4: tests** — a bootstrap-level test (mirror the existing sync-wiring test) constructing config with `mode='push'` → only push worker started (pull undefined); `mode='pull'` → only pull; `mode='bidirectional'` → both; `intervalMinutes` flows to `intervalMs`. The whole-boot `index.test.ts` must stay green. Test `migrateLegacySyncConfig` is invoked (a boot with a legacy blob → discrete keys present after).
- [ ] **Step 5:** typecheck + whole `@openldr/bootstrap` suite + commit `feat(bootstrap): mode-gated sync workers + interval + legacy-config migration at boot (sync S4)`.

---

## Task 5: `SyncHandle` on `AppContext` — `status()` + `triggerNow()`

**Files:** Modify `packages/bootstrap/src/index.ts` (AppContext + construction); Create `packages/bootstrap/src/sync-handle.ts` + test.

- [ ] **Step 1: types + handle (`sync-handle.ts`)**
```ts
import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { readCursor } from '@openldr/db'; // the projection cursor reader (aliased readChangeCursor in index.ts)

export type SyncMode = 'push' | 'pull' | 'bidirectional';
export interface SyncDirectionStatus { running: boolean; lastSeq: number; lastSyncedAt: string | null }
export interface SyncStatus {
  enabled: boolean; mode: SyncMode; centralUrl: string; siteId: string;
  push: SyncDirectionStatus | null; pull: SyncDirectionStatus | null; pendingPush: number;
}
export interface SyncHandle { status(): Promise<SyncStatus>; triggerNow(): void }

export function createSyncHandle(opts: {
  db: Kysely<InternalSchema>;
  enabled: boolean; mode: SyncMode; centralUrl: string; siteId: string;
  pushWorker?: { isRunning(): boolean; trigger(): void };
  pullWorker?: { isRunning(): boolean; trigger(): void };
}): SyncHandle {
  const cursorRow = async (consumer: string) => opts.db.selectFrom('fhir.change_cursors')
    .select(['last_seq', 'updated_at']).where('consumer', '=', consumer).executeTakeFirst();
  return {
    async status() {
      const [pushRow, pullRow] = await Promise.all([cursorRow('sync-push'), cursorRow('sync-pull')]);
      let pendingPush = 0;
      if (opts.pushWorker) {
        const head = await opts.db.selectFrom('fhir.change_log').select(({ fn }) => fn.max('seq').as('m')).executeTakeFirst();
        pendingPush = Math.max(0, Number(head?.m ?? 0) - Number(pushRow?.last_seq ?? 0));
      }
      const dir = (row: typeof pushRow, w?: { isRunning(): boolean }): SyncDirectionStatus | null =>
        w ? { running: w.isRunning(), lastSeq: Number(row?.last_seq ?? 0), lastSyncedAt: row?.updated_at ? new Date(row.updated_at as unknown as string).toISOString() : null } : null;
      return { enabled: opts.enabled, mode: opts.mode, centralUrl: opts.centralUrl, siteId: opts.siteId,
        push: dir(pushRow, opts.pushWorker), pull: dir(pullRow, opts.pullWorker), pendingPush };
    },
    triggerNow() { opts.pushWorker?.trigger(); opts.pullWorker?.trigger(); },
  };
}
```
Verify `fhir.change_cursors`/`fhir.change_log` are the real table names + that `updated_at` exists on change_cursors (it does — the cursor writer sets it). Coerce bigint via `Number()`.

- [ ] **Step 2: wire on `AppContext`** — add `sync: SyncHandle` to the interface. In `createAppContext`, AFTER the `if (syncCfg)` block, construct `const sync = createSyncHandle({ db: internal.db, enabled: !!syncCfg, mode: syncCfg?.mode ?? 'bidirectional', centralUrl: syncCfg?.centralUrl ?? '', siteId: syncCfg?.siteId ?? '', pushWorker: syncPushWorker, pullWorker: syncPullWorker });` and add `sync` to the returned context. When sync is disabled, `syncCfg` is null → both workers undefined → `status()` returns `enabled:false`, push/pull null, pendingPush 0; `triggerNow()` is a no-op.
- [ ] **Step 3: tests** (`sync-handle.test.ts`, pg-mem): seed `change_cursors` rows for `sync-push`/`sync-pull` + `change_log` rows → `status()` returns the right lastSeq/pendingPush/running; a fake worker with `isRunning()` true/false; `triggerNow` calls both workers' `trigger`; disabled (no workers) → enabled:false + nulls.
- [ ] **Step 4:** typecheck + tests + commit `feat(bootstrap): SyncHandle (status + triggerNow) on AppContext (sync S4)`.

---

## Task 6: `GET/POST /api/settings/sync/{status,now}` + `openldr sync status|now`

**Files:** Modify `apps/server/src/settings-routes.ts`; Create `packages/cli/src/sync.ts` + register in `packages/cli/src/index.ts`; Tests.

- [ ] **Step 1: endpoints** (in `registerSettingsRoutes`, user-authed — NOT under `/api/sync/`):
```ts
app.get('/api/settings/sync/status', { preHandler: requireRole('lab_admin') }, async () => ctx.sync.status());
app.post('/api/settings/sync/now', { preHandler: requireRole('lab_admin') }, async (req, reply) => {
  const s = await ctx.sync.status();
  if (!s.enabled) { reply.code(409); return { triggered: false, reason: 'disabled' }; }
  ctx.sync.triggerNow();
  await recordAudit(ctx, req, { action: 'settings.sync.now', entityType: 'app_settings', entityId: 'sync', metadata: {} });
  return { triggered: true };
});
```
- [ ] **Step 2: CLI `openldr sync` group** (`packages/cli/src/sync.ts`): `runSyncStatus(opts)` → `createAppContext` → `ctx.sync.status()` → `emit(json, status, <table>)`; `runSyncNow(opts)` → status-guarded `ctx.sync.triggerNow()` → emit. Follow the `finally ctx.close()` pattern. Register a new top-level group in `index.ts`: `const sync = program.command('sync'); sync.command('status').option('--json').action(...); sync.command('now').option('--json').action(...);` (sibling to `settings`/`terminology`).
- [ ] **Step 3: tests** — `settings-routes.test.ts`: `GET /status` returns the handle's status (stub `ctx.sync`); `POST /now` when enabled → 200 `{triggered:true}` + `triggerNow` called; when disabled → 409 `{triggered:false}`; 401/403. CLI test if the harness supports it.
- [ ] **Step 4:** typecheck (`@openldr/server` + `@openldr/cli`) + tests + commit `feat(server): sync status + now endpoints and openldr sync CLI (sync S4)`.

---

## Task 7: Sync card rework + `api.ts` + i18n

**Files:** Modify `apps/studio/src/pages/settings/General.tsx`, `apps/studio/src/api.ts`, the i18n locale files (en/fr/pt); test/mirror as the studio convention requires.

- [ ] **Step 1: `api.ts`** — update the sync types + add helpers:
```ts
export type SyncMode = 'push' | 'pull' | 'bidirectional';
export interface SyncConfigView { enabled: boolean; mode: SyncMode; centralUrl: string; siteId: string; oidcIssuer: string; clientId: string; clientSecretSet: boolean; intervalMinutes: number }
export interface SyncConfigInput extends Omit<SyncConfigView, 'clientSecretSet'> { clientSecret?: string }
export interface SyncStatus { enabled: boolean; mode: SyncMode; centralUrl: string; siteId: string;
  push: { running: boolean; lastSeq: number; lastSyncedAt: string | null } | null;
  pull: { running: boolean; lastSeq: number; lastSyncedAt: string | null } | null; pendingPush: number }
export const fetchSyncConfig = () => authFetch('/api/settings/sync').then((r) => okJson<SyncConfigView>(r, 'sync config'));
export const saveSyncConfig = (cfg: SyncConfigInput) => authFetch('/api/settings/sync', jbody(cfg, 'PUT')).then((r) => okJson<SyncConfigView>(r, 'save sync config'));
export const fetchSyncStatus = () => authFetch('/api/settings/sync/status').then((r) => okJson<SyncStatus>(r, 'sync status'));
export const triggerSyncNow = () => authFetch('/api/settings/sync/now', jbody({}, 'POST')).then((r) => okJson<{ triggered: boolean; reason?: string }>(r, 'sync now'));
```
(Match the real `okJson`/`jbody`/`authFetch` signatures.)

- [ ] **Step 2: Sync card (`General.tsx`)** — remove the preview banner + `settings.general.sync.preview` usage. Config form fields (shadcn only): `Switch` enabled; `Select` mode (Push only / Pull only / Bidirectional); `Input` centralUrl, siteId, oidcIssuer, clientId; `Input type=password` clientSecret (placeholder = t('…secretSet') when `clientSecretSet`, blank submit → omit from the `SyncConfigInput` so the secret is preserved); `Input type=number` intervalMinutes; Save button → `saveSyncConfig`. Status panel: on mount + after Save/Sync-now, `fetchSyncStatus`; render enabled badge, per-direction `last synced {relativeTime(lastSyncedAt)} · seq {lastSeq} · {running?…:idle}` (null direction → "not started"), `pendingPush` count; a **Sync now** `Button` → `triggerSyncNow` + toast + refetch status. Optional: `setInterval` refetch every 10s while mounted (clear on unmount). Keep the card's existing structure/placement in Settings→General.
- [ ] **Step 3: i18n** — add the new keys (`settings.general.sync.mode`, `.oidcIssuer`, `.clientId`, `.clientSecret`, `.clientSecretSet`, `.intervalMinutes`, `.status`, `.lastSynced`, `.pending`, `.syncNow`, `.running`, `.idle`, `.notStarted`, mode option labels) to **en, fr, pt**; remove the now-unused `.preview`. (The repo requires all three locales — see the i18n workstream.)
- [ ] **Step 4: verify** — `pnpm --filter @openldr/studio exec tsc --noEmit`; if the studio has an `api.test.ts` mirror or a component test, update/run it (keep it green — the studio api mirror must match server types). Build the studio if the repo gates on it.
- [ ] **Step 5:** commit `feat(studio): working Sync settings card — reconciled config + live status + sync now (sync S4)`.

---

## Task 8: Whole-slice review, gate, live smoke, merge & push

- [ ] **Gate:** `pnpm turbo run typecheck test --force --filter=@openldr/config --filter=@openldr/sync --filter=@openldr/db --filter=@openldr/server --filter=@openldr/bootstrap --filter=@openldr/cli --filter=@openldr/studio` — PASS, no NEW failures (verify known-flaky pkgs in isolation; never pipe turbo through `tail` — if the Windows install-race hits `--force`, run each pkg's typecheck+vitest directly). Re-run the S1/S2/S3 acceptance harnesses (`pnpm sync:accept`, `sync:pull:accept`, `sync:terminology:accept`) — this slice touched shared config/bootstrap, so they must not regress.
- [ ] **Live smoke (flag the dev shortcut up front):** `docker compose up -d postgres`; start the API (`node dev.mjs`, no `--watch`) + studio with `AUTH_DEV_BYPASS=true`; via a throwaway `e2e/*.mjs` Playwright (per the repo's live-drive convention): open `/settings`, enable sync + set mode/central/site/oidc/clientId/secret + interval, Save, confirm the discrete `sync.*` keys landed (query app_settings) and the status endpoint responds; `openldr sync status` prints; `openldr sync now` triggers. (A reachable central isn't required to prove config+status+trigger; the worker will just fail to connect — that's fine for this smoke.)
- [ ] **Whole-slice review** (dispatch a fresh reviewer over `git diff main..HEAD`): the disjoint-config bug is actually fixed (enabling via UI/CLI writes the discrete keys the workers read; a bootstrap test proves mode-gated startup); the legacy blob migration is one-time + idempotent + doesn't clobber discrete keys or crash boot; the client secret is NEVER returned by GET/show and is encrypted at rest + preserved on a blank-secret save; `sync.site_id` is unchanged (fhir-store still reads it); status/now are user-authed under `/api/settings/sync/*` (NOT the machine-bypassed `/api/sync/*`); `now` is 409 when disabled; the SyncHandle handles the disabled case; shadcn-only UI + all three locales; no `Co-Authored-By`.
- [ ] **Merge:** `git checkout main && git merge --no-ff feat/sync-s4-ui -m "Merge branch 'feat/sync-s4-ui': distributed sync S4a-c — config reconcile + status + working Sync UI"`.
- [ ] **Push:** ask the user before `git push origin main` (pushes are discretionary).
- [ ] **Update memory:** `distributed-sync-central-workstream.md` — S4a-c DONE (config reconciled onto discrete keys, blob retired via migration, mode/interval honored, status+now endpoints + `openldr sync` CLI, working Sync card); new `origin/main` SHA (if pushed); NEXT = S4d enrollment automation (central mints Keycloak client + site_id mapper + `openldr sync enroll`) / S5 store-and-forward.

---

## Self-review notes

- **Spec coverage:** S4a readSyncConfig mode/interval (§S4a)→T1; operator surface + migration (§S4a)→T2; route+CLI (§S4a)→T3; mode-gating+interval (§S4b)→T4; SyncHandle (§S4b)→T5; status/now endpoints + CLI (§S4b)→T6; Sync card (§S4c)→T7; gate/review/merge→T8. All covered.
- **Ordering safety:** worker-config extend before mode-gating; operator surface + `ctx.encryptSecret` before the route/CLI use it (T3 adds `encryptSecret`; T5 reuses it — T3 lands it first); migration helper before boot-wiring; SyncHandle before its endpoints; endpoints before the UI. The single risky ordering (`ctx.encryptSecret` used by T3 route but conceptually an AppContext addition) is resolved by adding it in T3 Step 2.
- **Type consistency:** two `SyncConfig`s (worker in @openldr/sync vs operator in @openldr/config) kept distinct; the operator write path uses `SyncConfigInput` (secret in) and read path `SyncConfigView` (secret out as boolean); `api.ts` mirrors `SyncConfigView`/`SyncConfigInput`/`SyncStatus` exactly (studio-mirrors-server convention); `SyncHandle`/`SyncStatus` shared shape between bootstrap + endpoints + api.ts.
- **The load-bearing fix:** T2+T3+T4 together make "enable in UI → workers start" true; T4's mode-gating test + T8's live smoke prove it. This directly closes the bug the S2/S3 specs deferred.
- **Deliberate shortcuts (flagged):** manual credential entry (S4d automates); pendingPull deferred; blob tombstoned (empty value) not hard-deleted; client-side status polling; live smoke uses AUTH_DEV_BYPASS.
```
