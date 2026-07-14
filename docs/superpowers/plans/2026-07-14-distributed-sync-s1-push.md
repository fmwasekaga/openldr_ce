# Distributed Sync S1 — Directional Push (lab → central) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lab instance pushes its lab-owned operational FHIR (Patient/Specimen/ServiceRequest/Observation/DiagnosticReport) up to a central instance, which mirrors each record at its origin version + origin site-id, idempotently and resumably, rejecting cross-site writes — proven by a two-Postgres round-trip.

**Architecture:** Sync is a second consumer of `fhir.change_log` (the storage-restructure substrate). New: a versioned-mirror-apply primitive (`applyRemote` on `FhirStore`), a `@openldr/sync` package (batch types + push worker + token acquisition), a `POST /api/sync/push` endpoint with client-credentials auth + site-scoping, lab config, and bootstrap wiring. `site_id` stamping is already done in `fhir-store`.

**Tech Stack:** TypeScript, Kysely, Fastify (`apps/server`), jose (`@openldr/adapter-auth`), Vitest, real Postgres for the tx/integration proofs.

**Spec:** `docs/superpowers/specs/2026-07-14-distributed-sync-s1-push-design.md`

**Key substrate to read first (all exist):** `packages/db/src/fhir-store.ts` (`save`/`delete` — the model for `applyRemote`; `resolveSiteId` already stamps `change_log.site_id`), `packages/db/src/projection/{fetch.ts,plan.ts,cycle.ts}` (`fetchSafeChangeRows` + `planProjection` + `ChangeRow`/`ProjectionTask` shapes — the safe-frontier the push worker reuses), `packages/bootstrap/src/projection-worker.ts` + `index.ts:653` (`createProjectionWorker` wiring — the model for the push worker), `apps/server/src/auth-plugin.ts` (the `/api/*` user-auth hook + its `/api/workflows/hooks/` bypass pattern), `apps/server/src/app.ts` (route registration), `packages/adapter-auth/src/index.ts` (`verifyToken`, and `getAdminToken`'s `client_credentials` form — the model for `token.ts`), `packages/db/src/app-settings-store.ts` (`get`/`set`), and a connector config for the `SECRETS_ENCRYPTION_KEY` encrypt/decrypt helper.

---

## Task 0: Cut the branch

- [ ] Run:
```bash
git checkout -b feat/sync-s1-push
git branch --show-current
```
Expected: `feat/sync-s1-push`. Clean tree (spec committed on `main`).

---

## Task 1: `applyRemote` mirror-apply primitive (`packages/db`)

**Files:** Modify `packages/db/src/fhir-store.ts`; Test `packages/db/src/fhir-store.test.ts` (or a new `fhir-store-apply.test.ts`).

Add to the `FhirStore` interface + `createFhirStore` return. Read `save()`/`delete()` first — mirror their table set (`fhir.fhir_resources` + `fhir.resource_history` + `fhir.change_log`) and the change_log-not-first-write invariant, but use the record's EXPLICIT version + site_id (not `max+1`, not the local site).

- [ ] **Step 1: Add the types + interface method**
```ts
export interface RemoteRecord {
  resourceType: string;
  id: string;
  version: number;          // origin version (from the lab's change_log)
  op: 'upsert' | 'delete';
  siteId: string;           // origin site-id (ownership stamp)
  resource?: FhirResource;  // present for op:'upsert'
}
export type ApplyResult = 'applied' | 'skipped';
// in interface FhirStore:
applyRemote(record: RemoteRecord): Promise<ApplyResult>;
```

- [ ] **Step 2: Implement `applyRemote`** (in the object returned by `createFhirStore`):
```ts
    async applyRemote(record) {
      const { resourceType, id, version, op, siteId } = record;
      const result = await db.transaction().execute(async (trx): Promise<ApplyResult> => {
        // Idempotency: history PK (resource_type,id,version). ON CONFLICT DO NOTHING → if no row was
        // inserted, this exact version is already applied; no-op (no resources/change_log writes).
        const content = op === 'upsert' && record.resource
          ? JSON.stringify({ ...record.resource, id })
          : null;
        const histRes = await trx
          .insertInto('fhir.resource_history')
          .values({ resource_type: resourceType, id, version, op, resource: content })
          .onConflict((oc) => oc.columns(['resource_type', 'id', 'version']).doNothing())
          .executeTakeFirst();
        if (Number(histRes.numInsertedOrUpdatedRows ?? 0) === 0) return 'skipped';

        if (op === 'upsert') {
          const cur = await trx.selectFrom('fhir.fhir_resources').select('version')
            .where('resource_type', '=', resourceType).where('id', '=', id).executeTakeFirst();
          // Guard: a late/out-of-order OLDER version must not clobber a newer mirrored row.
          if (!cur || version >= Number(cur.version)) {
            await trx.insertInto('fhir.fhir_resources')
              .values({ resource_type: resourceType, id, version, version_id: String(version), resource: content! })
              .onConflict((oc) => oc.columns(['resource_type', 'id']).doUpdateSet({
                version, version_id: String(version), resource: content!, updated_at: sql`now()`,
              }))
              .execute();
          }
        } else {
          await trx.deleteFrom('fhir.fhir_resources')
            .where('resource_type', '=', resourceType).where('id', '=', id).execute();
        }
        // change_log stamped with the ORIGIN site_id (not resolveSiteId()). Not the tx's first write.
        const contentHashHex = content ? contentHash(content) : null;
        await trx.insertInto('fhir.change_log')
          .values({ resource_type: resourceType, resource_id: id, version, op, content_hash: contentHashHex, site_id: siteId })
          .execute();
        return 'applied';
      });
      try { await sql`select pg_notify('fhir_changes', '')`.execute(db); } catch { /* ignore */ }
      return result;
    },
```
Verify `contentHash` is in scope (it's a module fn in `fhir-store.ts`). Check `numInsertedOrUpdatedRows` is the right Kysely field for the installed version (it is for `executeTakeFirst()` on an insert; if not, use `.execute()` + inspect the result array, or a pre-check `select` for existence).

- [ ] **Step 3: Tests** (real-PG for the tx/on-conflict path — pg-mem may not support all of it; guard with the same pattern other real-PG db tests use, or use pg-mem if it handles `on conflict do nothing` — verify):
  - fresh upsert → `'applied'`; `fhir_resources` at `version`, `resource_history` row, `change_log` row with `site_id = record.siteId`.
  - re-apply same (type,id,version) → `'skipped'`; no duplicate `change_log`.
  - `op:'delete'` → tombstone in history, `fhir_resources` row gone, `change_log` op=delete.
  - out-of-order: apply v3 then v2 → v2 is `'applied'` (history) but does NOT overwrite `fhir_resources` (still v3).

- [ ] **Step 4: typecheck + test + commit**
```bash
pnpm --filter @openldr/db exec tsc --noEmit
pnpm --filter @openldr/db exec vitest run src/fhir-store.test.ts   # (or the apply test file)
git add packages/db/src/fhir-store.ts packages/db/src/*fhir-store*apply*.test.ts packages/db/src/fhir-store.test.ts
git commit -m "feat(db): applyRemote versioned-mirror-apply primitive for sync (sync S1)"
```
No `Co-Authored-By`.

---

## Task 2: `@openldr/sync` package scaffold + wire types

**Files:** Create `packages/sync/{package.json,tsconfig.json,src/index.ts,src/batch.ts}`.

- [ ] **Step 1:** Scaffold the package mirroring a small existing leaf package (e.g. `packages/reporting` or `packages/audit`) — `package.json` name `@openldr/sync`, deps on `@openldr/fhir` (types) and `@openldr/db` (FhirStore/RemoteRecord types), a `tsconfig.json` extending the repo base, `build`/`typecheck`/`test` scripts matching siblings. Add to the workspace if the root `pnpm-workspace.yaml` uses explicit globs (it likely already globs `packages/*`).

- [ ] **Step 2: `batch.ts`** — the wire contract:
```ts
import type { FhirResource } from '@openldr/fhir';
export interface SyncRecord {
  resourceType: string; id: string; version: number; op: 'upsert' | 'delete'; siteId: string;
  resource?: FhirResource;  // present for op:'upsert'
}
export interface PushBatch { fromSeq: number; records: (SyncRecord & { seq: number })[] }
export interface PushResponse {
  ackSeq: number; applied: number; skipped: number;
  rejects: { id: string; version: number; seq: number; reason: string }[];
}
```
Export from `index.ts`.

- [ ] **Step 3:** `pnpm --filter @openldr/sync exec tsc --noEmit` (clean), then `pnpm install` at root if the new package needs linking. Commit:
```bash
git add packages/sync pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(sync): @openldr/sync package scaffold + push batch wire types (sync S1)"
```

---

## Task 3: Push worker orchestration (`@openldr/sync`)

**Files:** Create `packages/sync/src/push-worker.ts` + test.

Read `packages/db/src/projection/{fetch.ts,plan.ts,cycle.ts}` first — `fetchSafeChangeRows(db,cursor,limit)→{rows,boundary,xmax}`, `planProjection({rows,boundary,xmax,cursor,pendingGaps})→{tasks,newCursor,pendingGaps}`, and `ChangeRow` (has `seq`,`resourceType`/`resource_id`,`version`,`op`,`site_id`). The push cursor has the SAME skip-hazard as projection, so reuse this frontier.

- [ ] **Step 1:** Define an injected-deps interface + the pure cycle:
```ts
export interface PushDeps {
  internalDb: Kysely<InternalSchema>;              // for fetchSafeChangeRows + cursor read/write
  fetchContent: (resourceType: string, id: string, version: number) => Promise<FhirResource | null>; // from resource_history/fhir_resources
  postPush: (batch: PushBatch, token: string) => Promise<PushResponse>;
  getToken: () => Promise<string>;
  readCursor: () => Promise<number>;               // change_cursors consumer 'sync-push'
  advanceCursor: (seq: number) => Promise<void>;
  logger: Logger;
  batchSize?: number;
}
export function createSyncPushRunner(deps: PushDeps): { runCycle(): Promise<number> };
```
`runCycle`: read cursor → `fetchSafeChangeRows` → `planProjection` (carry `pendingGaps` across cycles in a closure var, exactly like `createProjectionRunner`) → for each SAFE change row build a `SyncRecord & {seq}` (fetch content for `op:'upsert'`; stamp `siteId` from the row) → if none, advance cursor to `newCursor` and return 0 → else `getToken()` + `postPush({fromSeq: cursor, records})` → on success advance cursor to `response.ackSeq` and log rejects; on POST failure, do NOT advance (return 0, retry next cycle). Reuse `readCursor`/`advanceCursor` against `change_cursors` with consumer `'sync-push'` (mirror `packages/db/src/projection/cursor.ts`).

- [ ] **Step 2: tests** with fakes for every dep: builds records from change rows + content; advances to `ackSeq` on success; does NOT advance on `postPush` throw; a persistently-rejected record is logged and the cursor still advances past it (quarantine) so it never blocks. Assert the frontier reuse by feeding a gap scenario mirroring `plan.test.ts`.

- [ ] **Step 3:** typecheck + test + commit (`feat(sync): change_log push worker (safe-frontier, cursor, quarantine) (sync S1)`).

---

## Task 4: Client-credentials token acquisition (`@openldr/sync`)

**Files:** Create `packages/sync/src/token.ts` + test.

- [ ] Mirror `adapter-auth`'s `getAdminToken`: `createSyncTokenProvider({ issuerUrl, clientId, clientSecret, fetchFn? })` → `getToken()` that POSTs `grant_type=client_credentials` to `${issuerUrl}/protocol/openid-connect/token`, caches `access_token` until `expires_in - 30s`, refetches on expiry, throws a typed error on non-2xx. Unit test with a fake `fetchFn` (returns a token + `expires_in`; assert caching + refresh-after-expiry + error propagation). Commit (`feat(sync): client-credentials token provider (sync S1)`).

---

## Task 5: Central `/api/sync/push` endpoint + auth bypass (`apps/server`)

**Files:** Create `apps/server/src/sync-routes.ts`; Modify `apps/server/src/auth-plugin.ts` (bypass) + `apps/server/src/app.ts` (register); Test `apps/server/src/sync-routes.test.ts`.

- [ ] **Step 1: bypass the user hook for `/api/sync/`** — in `auth-plugin.ts`'s `onRequest`, alongside the `/api/workflows/hooks/` bypass, add: `if (path.startsWith('/api/sync/')) return;` (the sync route does its OWN client-credentials auth; a machine client has no user record, so `users.syncFromClaims` must not run).

- [ ] **Step 2: `registerSyncRoutes(app, ctx)`** with a `preHandler` client-auth deriving the site principal:
```ts
async function sitePrincipal(req, reply, ctx): Promise<{ siteId: string } | undefined> {
  const h = req.headers.authorization;
  const token = h?.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) { reply.code(401).send({ error: 'authentication required' }); return; }
  let claims; try { claims = await ctx.auth.verifyToken(token); }
  catch { reply.code(401).send({ error: 'invalid token' }); return; }
  const siteId = typeof claims['site_id'] === 'string' ? claims['site_id'] as string : '';
  if (!siteId) { reply.code(403).send({ error: 'token missing site_id claim' }); return; }
  return { siteId };
}
```
`POST /api/sync/push` handler: parse `PushBatch` (accept gzip — Fastify content-type parser or a `Content-Encoding: gzip` inflate; if that's heavy, defer gzip to S7 and note it — the spec's gzip is a nice-to-have, correctness doesn't need it). For each `record` in `seq` order: if `record.siteId !== principal.siteId` → push a reject `{id,version,seq,reason:'cross-site'}` (do NOT apply); else `const r = await ctx.fhirStore.applyRemote(record)` (tally applied/skipped; a thrown apply → reject `reason:'apply-error'`). `ackSeq` = the max `seq` among records that were applied/skipped/rejected-and-handled (i.e., every record the lab may advance past — for S1, all records in the batch are "handled" [applied, skipped, or recorded as a reject], so `ackSeq` = the batch's max `seq`). Return `PushResponse`. Confirm `ctx.fhirStore` is on `AppContext` (it is — the projection worker uses it; else thread it).

- [ ] **Step 3: register** in `app.ts`: `import { registerSyncRoutes } from './sync-routes';` + `registerSyncRoutes(app, ctx);` after `registerAuth`.

- [ ] **Step 4: tests** (inject a fake `ctx.auth.verifyToken` + a fake/real `fhirStore`): no token → 401; token without `site_id` → 403; a record with a foreign `siteId` → in `rejects`, NOT applied; valid batch → `applyRemote` called per record, `ackSeq`/`applied` correct; a re-sent batch → all `'skipped'`. Use `app.inject(...)` (Fastify's test harness — see an existing `*-routes.test.ts`).

- [ ] **Step 5:** typecheck (`apps/server`) + test + commit (`feat(server): POST /api/sync/push endpoint + client-credentials site scoping (sync S1)`).

---

## Task 6: Lab sync config (`app_settings`)

**Files:** likely `packages/bootstrap/src/sync-config.ts` (or `packages/sync/src/config.ts`) + test.

- [ ] A typed reader over `app_settings` (`get`/`set`) + the secrets encrypt/decrypt helper (find how connector configs use `SECRETS_ENCRYPTION_KEY` — reuse it): keys `sync.enabled`, `sync.central_url`, `sync.oidc_issuer`, `sync.client_id`, `sync.client_secret` (secret → encrypted at rest), plus `sync.site_id` (already used by `fhir-store`). `readSyncConfig(appSettings, decrypt) → { enabled, centralUrl, oidcIssuer, clientId, clientSecret, siteId } | null` (null / `enabled:false` when unconfigured). Unit test with a fake settings store (present/absent/disabled; secret decrypts). Commit.

---

## Task 7: Bootstrap wiring — `createSyncPushWorker` host loop

**Files:** Create `packages/bootstrap/src/sync-push-worker.ts`; Modify `packages/bootstrap/src/index.ts`.

- [ ] Model on `packages/bootstrap/src/projection-worker.ts` + its `index.ts` wiring (`createProjectionWorker`, interval + optional LISTEN, started at boot). `createSyncPushWorker({ runner, intervalMs, logger })` runs `runner.runCycle()` on an interval (+ a `trigger()` for "sync now" later). In `index.ts`, AFTER the config is available: `const syncCfg = readSyncConfig(...)`; if `syncCfg?.enabled`, build the `PushDeps` (internalDb; `fetchContent` from `fhirStore`/`resource_history`; `postPush` = an http POST to `${centralUrl}/api/sync/push`; `getToken` = `createSyncTokenProvider(...).getToken`; cursor read/write on `change_cursors` consumer `'sync-push'`), `createSyncPushRunner(deps)`, and start `createSyncPushWorker`. When disabled/unconfigured → do not start (log once). Ensure a clean shutdown hook (like the projection worker's).

- [ ] typecheck (`@openldr/bootstrap`) + its test suite; commit (`feat(bootstrap): sync push worker host loop, config-gated (sync S1)`).

---

## Task 8: Two-Postgres integration harness (`pnpm sync:accept`)

**Files:** Create `scripts/sync-live-acceptance.ts` + a `sync:accept` script in root `package.json`.

- [ ] Model on `scripts/projection-live-acceptance.ts` (two internal PG DBs; real migrations). Create **lab** + **central** internal DBs (two `createInternalDb` handles on `:5433`, distinct DB names, both migrated to latest). Set lab `sync.site_id = 'site-lab-1'` (via `app_settings` or `OPENLDR_SITE_ID`). Steps:
  1. Lab: `fhirStore.save()` a Patient, Specimen, ServiceRequest, Observation, DiagnosticReport (referentially consistent; all get `change_log` rows stamped `site-lab-1`).
  2. Build the push deps against a **central endpoint** — simplest: call a central `fhirStore.applyRemote` directly through an in-process `postPush` that runs the endpoint's apply logic with a **stub site principal** `{ siteId: 'site-lab-1' }` (auth is unit-tested in Task 5; the integration harness proves the DATA round-trip, so bypass the HTTP/JWKS layer here — OR, if wiring the real endpoint is cheap, stand up the Fastify app with `ctx.auth.verifyToken` stubbed via the `adapter-auth` local-JWKS seam + a locally-signed token carrying `site_id`. Prefer the direct-apply in-process path for S1 speed; note it as a deliberate shortcut).
  3. Run the push runner cycles until the `sync-push` cursor drains.
  4. Assert: central has all 5 resources in `fhir_resources` at the lab's versions; central `change_log` rows carry `site_id='site-lab-1'`; run central's projection once (`reprojectAll` or the runner) and assert the 5 resources appear in central's canonical read model (`patients`/`lab_requests`/`lab_results`/`specimens`/`diagnostic_reports`).
  5. Second push cycle → 0 applied (all `'skipped'`), cursor unchanged.
  6. A record with `siteId='other'` pushed under principal `site-lab-1` → rejected, not applied.
- [ ] Run `docker compose up -d postgres && pnpm sync:accept` → all assertions pass, exit 0. Commit (`test(sync): two-PG push round-trip acceptance (sync S1)`).

---

## Task 9: Whole-slice review, gate, merge & push

- [ ] **Gate:** `pnpm turbo run typecheck test --force` — PASS for `@openldr/db`/`@openldr/sync`/`apps/server`/`@openldr/bootstrap` + no NEW failures (ignore the known `@openldr/users`/`@openldr/marketplace`/`bootstrap` parallel-turbo flakes — verify in isolation; never pipe turbo through `tail`). Re-run `pnpm sync:accept` green on real PG.
- [ ] **Whole-slice review:** `applyRemote` preserves origin version+site_id + idempotent; endpoint rejects cross-site + no-user-record path; push worker reuses the safe frontier + advances only on ack; config-gated worker is a no-op when disabled; no `Co-Authored-By`.
- [ ] **Merge + push:**
```bash
git checkout main
git merge --no-ff feat/sync-s1-push -m "Merge branch 'feat/sync-s1-push': distributed sync S1 — directional push lab->central (results up)"
git push origin main
```
- [ ] **Update memory:** `distributed-sync-central-workstream.md` — S1 (directional push) DONE + the reframe-onto-change_log note; new `origin/main` SHA; next = S3 pull / S4 enrollment+UI.

---

## Self-review notes

- **Spec coverage:** applyRemote (§Design.1)→T1; @openldr/sync + batch (§Design.2)→T2; push worker (§Design.2)→T3; token (§Design.2)→T4; endpoint+auth (§Design.3)→T5; config (§Design.4)→T6; bootstrap wiring (§Design.5)→T7; integration (§Testing)→T8; gate/merge→T9. All covered.
- **Ordering safety:** applyRemote before the endpoint (endpoint calls it); package scaffold before worker/token; config before bootstrap wiring; everything before the integration proof.
- **The one deliberate shortcut** (T8): the integration harness bypasses the HTTP/JWKS layer with an in-process apply + stub site principal — the real client-auth is unit-proven in T5. Flagged.
- **No new migration:** `change_cursors` already exists; `sync-push` is a new consumer row. `site_id` stamping already done.
