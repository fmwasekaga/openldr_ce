# DHIS2 Admin UI — SP-A: API Surface + Settings/Status Page Design

**Date:** 2026-06-21
**Status:** Approved (brainstorming) — ready for implementation planning
**Depends on:** existing DHIS2 backend (`packages/dhis2`, `packages/adapter-dhis2`, `packages/bootstrap/src/dhis2-context.ts`), the auth foundation (`requireRole`, `req.user`, `RequireRole`, `authFetch`), and the i18n + shadcn web stack.

## Background

The DHIS2 integration has a substantial **backend** but no operator UI:

- `packages/bootstrap/src/dhis2-context.ts` exposes `Dhis2Context` = `{ target, orgUnits, mappings, schedules, pullMetadata(), validate(id), runMapping({dryRun|push}), recentPushes(n), registerSync(), reconcileSchedules(), close() }`.
- `ReportingTargetPort` (`packages/ports/src/reporting-target.ts`) gives `healthCheck()`, `pullMetadata(): TargetMetadata` (`dataElements` / `orgUnits` / `categoryOptionCombos` / `programs` / `programStages`), `pushAggregate`, `pushEvents`.
- PG stores exist: `dhis2_mappings`, `dhis2_orgunit_map`, `dhis2_schedules`.
- The full CLI exists: `dhis2 map|orgunit|pull-metadata|validate|push|status|tracker|schedule`.
- Config: `REPORTING_TARGET_ADAPTER`, `DHIS2_BASE_URL`, `DHIS2_USERNAME`, `DHIS2_PASSWORD`, `DHIS2_SYNC_ENABLED`.

**Gaps:** there are **no `apps/server` HTTP routes**, **no web page**, and **no nav entry** for DHIS2. `ctx.dhis2` is not on `AppContext`; `apps/server/src/index.ts` builds a `dhis2` context separately and **only** when `REPORTING_TARGET_ADAPTER=dhis2 AND DHIS2_SYNC_ENABLED`. `selectReportingTarget(cfg)` throws when the adapter isn't `dhis2`, and `createDhis2Context` builds the target eagerly — so any status endpoint must read `cfg` flags directly and must not construct the context when DHIS2 is unconfigured.

This is the first sub-project of a decomposed DHIS2 Admin UI:

- **SP-A (this spec)** — API surface + nav entry + read-only Settings/Status page. Foundation.
- **SP-B** — OrgUnit mapping UI (facility → orgUnit editor with a metadata-backed picker).
- **SP-C** — Mapping authoring UI (aggregate + tracker editor + validation surfacing).
- **SP-D** — Operations UI (dry-run preview, manual push, push history, schedule management).

## Goal

Expose the existing `Dhis2Context` over HTTP and add a DHIS2 nav entry plus a **read-only** Settings/Status page. The page must work gracefully whether or not DHIS2 is configured. No editable connection config, no metadata caching (both decided out of scope for SP-A).

## Decisions (locked during brainstorming)

1. **Connection config is read-only / env-driven.** The page displays status (configured, host, sync flag, reachability) but credentials remain in `DHIS2_BASE_URL/USERNAME/PASSWORD`, edited via `.env`. No DB-persisted settings store.
2. **Metadata pull is on-demand, not cached.** The pull hits DHIS2 live and returns counts; nothing is persisted. A cache will be introduced in SP-B when the orgUnit picker needs the list.
3. **Role gating:** `requireRole('lab_admin')` on all routes; `/dhis2` web route guarded by `RequireRole('lab_admin')` — consistent with `/users`.

## Architecture

### 1. Startup wiring change (small, in `apps/server/src/index.ts`)

Decouple the admin context from the sync gating:

- Build the `dhis2` context whenever `REPORTING_TARGET_ADAPTER === 'dhis2'` (so status + metadata pull work even with sync disabled).
- Keep `registerSync(...)` and `reconcileSchedules(...)` gated on `DHIS2_SYNC_ENABLED` (unchanged behavior).
- Pass `{ cfg, dhis2: Dhis2Context | null }` into the new `registerDhis2Routes(...)`. `dhis2` is `null` when the adapter isn't `dhis2` (or creds absent) — the routes treat that as "not configured".
- Continue to `dhis2.close()` on shutdown when non-null.

### 2. Server — `apps/server/src/dhis2-routes.ts`

`registerDhis2Routes(app, { cfg, dhis2 })`. All routes `preHandler: requireRole('lab_admin')`.

**`GET /api/dhis2/status`** — always returns 200; never throws on an unconfigured/unreachable target.

```jsonc
{
  "configured": boolean,        // REPORTING_TARGET_ADAPTER==='dhis2' && base url + username + password present
  "syncEnabled": boolean,       // DHIS2_SYNC_ENABLED
  "host": string | null,        // new URL(DHIS2_BASE_URL).host — hostname[:port] only, NEVER creds
  "reachable": HealthResult | null,  // dhis2.target.healthCheck() when configured; null when not.
                                     // healthCheck errors are caught → { status: 'down', ... }
  "counts": { "mappings": number, "orgUnitMappings": number, "schedules": number } | null, // store counts when configured
  "recentPushes": AuditEvent[]  // dhis2.recentPushes(10) when configured; [] otherwise
}
```

- Reads `cfg` flags unconditionally. Only touches `dhis2` (healthCheck, store counts, recentPushes) when `dhis2 !== null`.
- `host` is derived with `URL` parsing; on a malformed URL, `host: null`. Credentials are never included.

**`POST /api/dhis2/metadata/pull`** — requires a configured target.

- `200 { counts: { dataElements, orgUnits, categoryOptionCombos, programs, programStages } }` — counts only (the full lists arrive in SP-B's cache). `programs`/`programStages` may be 0 when the server omits them.
- `409 { error: 'DHIS2 target not configured' }` when `dhis2 === null`.
- `502 { error: redact(...) }` when `pullMetadata()` throws (unreachable / auth failure). Uses `@openldr/core` `redact`.
- No audit event (read-only operation; audit is reserved for mutations/pushes).

### 3. Web

- **Nav:** add a "DHIS2" item to the `AppShell` sidebar (lucide icon, e.g. `Network`/`Share2`) → route `/dhis2`, wrapped in `RequireRole('lab_admin')` in `apps/web/src/App.tsx` (mirrors `/users`).
- **Page — `apps/web/src/pages/Dhis2.tsx`** (shadcn `Card`/`Button`/`Badge`/`Table`, `AppShell` layout, i18n):
  - **Connection card:** `configured` / `syncEnabled` badges; `host`; reachability (Up/Down + latency from `reachable`). When `!configured`, an explanatory empty state naming the env vars (`REPORTING_TARGET_ADAPTER=dhis2`, `DHIS2_BASE_URL`, `DHIS2_USERNAME`, `DHIS2_PASSWORD`).
  - **Metadata card:** "Pull metadata" button → `POST` pull → renders the returned counts; loading + error states. Counts live in component state only (not persisted). Disabled when `!configured`.
  - **Overview card:** read-only counts of mappings / orgUnit mappings / schedules (these get full pages in SP-B/C/D) + a recent-pushes table built from `status.recentPushes`.
- **API client — `apps/web/src/api.ts`:** `getDhis2Status(): Promise<Dhis2Status>` and `pullDhis2Metadata(): Promise<Dhis2MetadataCounts>` over the relative `/api/dhis2/*` paths via `authFetch`.
- **i18n:** `dhis2.*` keys added to `apps/web/src/i18n/index.ts` (en bundle), following the `users.*`/`common.*` pattern.
- **Selectors:** `data-testid`s on the cards and the pull button for e2e.

## Data Flow

1. Page mounts → `getDhis2Status()` → renders connection/overview cards from the single status payload.
2. Admin clicks "Pull metadata" → `pullDhis2Metadata()` → metadata card shows counts (or a redacted error).
3. No writes occur anywhere in SP-A; the only outbound call to DHIS2 is `healthCheck()` (status) and `pullMetadata()` (explicit button).

## Error Handling

- **Unconfigured:** `status` returns `configured:false` (200) and the page shows the env-var empty state; `metadata/pull` returns 409.
- **Unreachable / auth failure:** `status.reachable.status==='down'` (caught, never 500); `metadata/pull` returns 502 with a `redact`-ed message.
- **No role:** 403 from `requireRole`; the web route additionally redirects via `RequireRole`.
- **Credential safety:** only `host` (hostname[:port]) is ever exposed; usernames/passwords/full URLs with creds are never returned or logged.

## Testing

- **Server — `apps/server/src/dhis2-routes.test.ts`** (inject fakes, no live DHIS2, following `users-routes.test.ts`):
  - status configured (fake context: fake `target.healthCheck`, store counts, `recentPushes`) and unconfigured (`dhis2=null`).
  - metadata pull success (fake `pullMetadata`), `409` unconfigured, `502` on pull throw.
  - `403` without `lab_admin`.
  - `host` shows hostname only; no credentials in any payload.
- **Web — `apps/web/src/pages/Dhis2.test.tsx`:** configured vs unconfigured render; pull-metadata flow (mock api, counts shown); role guard.
- **Gate:** `pnpm turbo typecheck lint test build` + `pnpm depcruise` green.

## Out of Scope (later sub-projects)

- OrgUnit mapping editor + its routes (SP-B).
- Aggregate/tracker mapping authoring + validation surfacing + their routes (SP-C).
- Dry-run preview, manual push, push history page, schedule management + their action routes (SP-D).
- Metadata caching/persistence.
- Editable connection config / DB-persisted DHIS2 settings.
- Live acceptance against a real DHIS2 instance (deferred; tests use injected fakes).
