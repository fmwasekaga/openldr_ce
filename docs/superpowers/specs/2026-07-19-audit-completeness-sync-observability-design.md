# Audit completeness + sync observability

**Date:** 2026-07-19
**Status:** Approved — ready for implementation plans (per-slice)
**Branch:** `claude/audit-observability`

## Problem / motivation

The audit page shows only **operator actions taken through the HTTP API**. Two consequences the user hit:

1. **No sync runtime visibility.** Whether a sync cycle ran, moved data, or failed is invisible — it lives only in pino logs. The audit records `settings.sync.*` operator actions (enroll, config save, `now`) but never a cycle, an error, an auto-quarantine, or a divergence.
2. **Audit-trail holes.** CLI-initiated actions (`openldr sync enroll`, `user create`, `danger`, terminology imports) record **nothing** — the CLI builds its own `AppContext` with no HTTP request, so the identical operation is audited from the UI but invisible from the CLI. And there are no authentication events (no failed-auth, no login).

## Guiding boundary (the load-bearing decision)

The **audit log stays a "who did what" operator-action trail.** High-frequency sync runtime does **not** go into it (a per-interval cycle would flood it and drown the operator signal). Sync runtime gets a **separate, fit-for-purpose activity store**. So:
- Track A (sync activity) → **new `sync_activity` table**, NOT audit.
- Track B (CLI + failed-auth) → the **existing audit log** (that's exactly what it's for).

Two independent slices; build order is the user's call (A answers the original question).

## Track A — Sync activity / observability

### Store
New `sync_activity` table (internal schema, its own migration):

| column | type | notes |
|---|---|---|
| `id` | text PK | |
| `occurred_at` | timestamptz | default `now()` |
| `direction` | text | `push` \| `pull` \| `amend` |
| `event` | text | `synced` \| `failed` \| `quarantined` \| `diverged` |
| `records` | integer | count moved (0 for failures/events) |
| `error` | text | null on success; the failure message (never a token/secret) |
| `metadata` | jsonb | e.g. `{seq}`, `{entityType, entityId}` for quarantine/divergence |

Index on `(direction, occurred_at desc)`.

### What is recorded (high-signal only)
The sync workers/runners write a row **only** when something happened:
- a cycle that moved data (`records > 0`) → `synced` (with the count + cursor seq),
- a cycle that threw (transport / token / apply) → `failed` (with the sanitized error),
- an auto-quarantine → `quarantined` (entity type/id),
- a same-version divergence detected → `diverged` (resource type/id/version).

**Idle "nothing to sync" cycles write nothing.** A lightweight in-memory `lastAttemptAt` per direction (on the `SyncRuntime`/workers) still lets the header show liveness ("last checked 30s ago") without a row.

### Retention
Trim-on-write: keep the most recent **N rows per direction** (default e.g. 200) — bounded, so per-minute cycles can never grow it unbounded. (A `DELETE … WHERE id NOT IN (recent N)` per direction after insert, or a periodic trim.)

### Surface
- `GET /api/settings/sync/activity` (lab_admin): recent rows, optional `?direction=`.
- The existing **Sync card** (Settings → General) gains a header — **last attempt / last success / last error** per direction — and a compact recent-activity timeline (event, direction, records/error, time). The `SyncStatus` payload (or a companion call) carries the last-attempt/success/error summary.

### Store construction / wiring
The store is built once and passed to the sync runner deps so `buildPush`/`buildPull` (from the live-sync `SyncRuntime`) can record. Emitting from the runners (not the routes) is the whole point — this is background activity.

## Track B — Audit completeness

### B1 — CLI actions audited
- **Move the audit-record core into `@openldr/bootstrap`** (today it's `apps/server/src/audit-helper.ts` → `recordAudit(ctx, req, details)`). Extract a request-free `recordAuditEvent(ctx, actor, details)` in bootstrap; the server's `recordAudit` becomes a thin wrapper (`actorFromRequest` → `recordAuditEvent`). Same `audit_events` write, one implementation.
- CLI mutating commands call `recordAuditEvent` with **`actor_type: 'cli'`**, `actor_name`: OS user (`process.env.USER`/`USERNAME`, best-effort) with an optional global `--actor <name>` override; **same `action` strings** as their HTTP twins so the trail reads uniformly. In scope: `sync enroll/rotate/revoke`, `user create/update/disable/reset-password/send-reset-email/status`, `settings` writes (flags, sync, validation), `danger` (`db reset`/factory-reset/clear-audit), terminology imports (`term/value_set/coding_system/publisher/term_mapping` create/update/delete/import). Read-only CLI commands (`list`, `status`, `show`) are NOT audited.
- `actor_type` is a free-text column already (`'user'`/`'system'` today) — `'cli'` needs no schema change; the audit UI should render it as a distinct actor kind.

### B2 — Failed authentication audited
- The auth plugin (`apps/server/src/auth-plugin.ts`) records an **`auth.failed`** audit event when a token is rejected at a protected route: reason (`expired` / `invalid` / `wrong-audience` / `bad-signature` / `revoked-site` / `missing`), source IP (`req.ip`), and the token `sub` when the token decodes far enough to read it. `actor_type: 'system'` (or `'user'` with the sub when known), `entityType: 'auth'`.
- **Throttle/dedup:** collapse repeats of the same `(actor/sub-or-ip, reason)` within a short in-memory window (e.g. 60s) to a single event so a misconfigured client can't flood the log. Never record the token itself.
- Dev-bypass (`AUTH_DEV_BYPASS`) requests are not "failures" and are not recorded here.

### B3 — Login/logout is Keycloak's
The app never handles the password, so login/logout **success** history is Keycloak's own **event log**, not ours. Document this (a docs note in `users.md`/`sync.md` or an audit help line, and a short pointer in the audit page's empty/help text) instead of reinventing a partial, misleading version.

## Testing

- **Track A:** unit for the `sync_activity` store (insert, trim-to-N, skip-no-op not the store's job — the caller decides, so test the callers emit `synced`/`failed`/`quarantined`/`diverged` correctly and NOT on idle cycles); endpoint unit (role-gated, shape); live: force a sync failure (point a lab at an unreachable/bad central) and a quarantine, confirm they appear on the Sync card + `/activity`.
- **Track B:** unit that a CLI command writes an `audit_events` row with `actor_type='cli'` + the right action (via the extracted bootstrap fn, no HTTP); unit that a rejected token records one throttled `auth.failed`; live: run `openldr sync enroll …` on the CLI and confirm it appears on the audit page; hit a protected route with a bad token and confirm one `auth.failed` row.

## Out of scope / follow-ups
- PHI read-access auditing (viewing patients/results/reports) — a much larger, higher-volume concern; deliberately deferred.
- Projection-worker / scheduled-job / general background-worker auditing beyond sync.
- Sync metrics for external scraping (Prometheus) — the activity feed answers the UI question; metrics can come later.
- Wiring Keycloak's event log into the app UI (vs just documenting it).

## Open questions (resolve in per-slice plans)
- Exact retention N (and whether per-direction or global) — start at 200/direction, revisit.
- Whether the last-attempt/success/error summary rides on the existing `SyncStatus` payload or a separate `/activity/summary` call (lean: extend `SyncStatus` — one poll already exists).
- CLI actor default when OS user is unavailable (headless/CI) — fall back to `'cli'` as the name.
