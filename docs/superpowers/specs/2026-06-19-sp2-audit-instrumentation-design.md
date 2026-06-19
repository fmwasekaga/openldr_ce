# SP2 — Audit Actor Wiring + Route Instrumentation (Design)

**Date:** 2026-06-19
**Status:** Approved (brainstorming) — ready for implementation planning
**Branch:** `feat/p2-audit-instrumentation`
**Depends on:** SP1 (auth foundation — `req.user` request actor). See
`docs/superpowers/specs/2026-06-19-sp1-auth-foundation-design.md`.

## Background

SP1 added a request actor (`req.user = { id, username, displayName, roles }`) on every
`/api/*` request. SP2 uses it to make audit real and complete across the mutating HTTP
routes.

Current state (verified by inspection):

- `apps/server/src/forms-routes.ts` records audit but via a closure that hardcodes
  `actorType: 'system', actorName: 'System'` — it is actor-blind.
- `apps/server/src/audit-routes.ts` only *reads* the audit log (query/detail) — no change.
- `users-routes.ts`, `terminology-admin-routes.ts`, `dashboards-routes.ts`, and
  `ontology-routes.ts` perform mutations with **no audit at all**.
- There is **no DHIS2 HTTP route file**; DHIS2 mapping/orgUnit/schedule are CLI-only, and
  push success/failure audit already lives in the DHIS2 context.

The audit store (`packages/audit/src/store.ts`) already provides `record(e)` and a
best-effort `safeRecord(store, logger, e)` that never throws into the caller.
`AuditEventInput` supports `actorType: 'user' | 'system'`, `actorId`, `actorName`,
`action`, `entityType`, `entityId`, `before`, `after`, `metadata`.

User chose **broad scope**: instrument all mutating HTTP routes now (not just Forms + Users).

## Goal

A single request→actor audit helper, used by every mutating route, so the audit log
records **who** did **what** (with before/after where practical) across Forms, Users,
Terminology admin, Dashboards, and Ontology — without ever breaking the audited operation.

## Scope

In scope:

1. Shared helper `apps/server/src/audit-helper.ts` (`actorFromRequest`, `recordAudit`).
2. Forms: replace the `System` closure with the helper (real actor) at all 7 sites; pass
   `req.user?.id` as the publish `actorId` (currently hardcoded `null`).
3. Users: audit `create` / `update` / `status` with before/after.
4. Terminology admin: audit the ~17 mutations (publishers, coding systems, terms,
   mappings, value sets — create/update/delete — plus LOINC import, terms import,
   value-set import, value-set duplicate).
5. Dashboards: audit `create` / `update` / `delete`.
6. Ontology: audit distribution `delete`.
7. Tests: each route file's fake ctx gains a recording `audit` stub + `logger`; assert
   events fire with the right actor / action / entityType / before-after; confirm
   best-effort (a throwing audit stub must not fail the route). Forms tests updated to
   assert the **real actor** (no longer `System`).

Out of scope (explicitly):

- DHIS2 — no HTTP routes exist; push audit already in the DHIS2 context.
- Read-only routes (reports, audit query/detail, terminology lookup/validate/expand).
- Ontology build/rebuild SSE streams — GET/`EventSource` endpoints, lower value, and
  tangled with the SP1b `EventSource`-auth carryover; deferred.
- A web "audit coverage" UI or new audit-page features.

## Components

### a) Shared helper — `apps/server/src/audit-helper.ts`

```ts
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';

type AuditInput = Parameters<AppContext['audit']['record']>[0];
type Actor = Pick<AuditInput, 'actorType' | 'actorId' | 'actorName'>;

export interface AuditDetails {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

export function actorFromRequest(req: FastifyRequest): Actor {
  if (req.user) return { actorType: 'user', actorId: req.user.id, actorName: req.user.username };
  return { actorType: 'system', actorId: null, actorName: 'System' };
}

/** Best-effort audit recorder — never throws into the caller (audit must not break the op). */
export async function recordAudit(ctx: AppContext, req: FastifyRequest, d: AuditDetails): Promise<void> {
  try {
    await ctx.audit.record({ ...actorFromRequest(req), ...d });
  } catch (e) {
    ctx.logger.error({ action: d.action, error: e instanceof Error ? e.message : String(e) }, 'audit record failed');
  }
}
```

The audit-input type is derived from `AppContext['audit']['record']` so no new package
dependency is introduced. The try/catch mirrors the existing `safeRecord` / Forms pattern.

### b) Instrumentation conventions

- `entityType` per resource: `form`, `user`, `dashboard`, `publisher`, `coding_system`,
  `term`, `term_mapping`, `value_set`, `ontology_distribution`.
- `action`: `<entityType>.<verb>` (mirrors the existing `form.create`). Verbs: `create`,
  `update`, `delete`, `status`, `publish`, `duplicate`, `import`, `responses.submit`.
- before/after: create → `before:null, after:result`; update → fetched before + result
  after; delete → fetched before + `after:null`; bulk import → no before/after, counts in
  `metadata` (e.g. `{ imported, skipped }`); status → fetched before + result after.
- Always recorded **after** the operation succeeds, best-effort.
- `entityId`: the resource id (for term/mapping composite keys, use the natural id the
  route already has — e.g. mapping id, or `<system>:<code>` for a term).

### c) Per-file changes

- **forms-routes.ts** — delete the local `audit()` closure; call `recordAudit(ctx, req, …)`
  at the 7 existing sites with the same action/before/after; set the publish call's
  `actorId` to `req.user?.id ?? null`.
- **users-routes.ts** — `user.create` (after create), `user.update` (before/after around
  the roles+profile update), `user.status` (before/after, `metadata: { status }`).
- **terminology-admin-routes.ts** — add `recordAudit` to each mutation, grouped by entity;
  imports record counts in metadata. Capture `before` only where the admin store exposes a
  get/find; otherwise record after/metadata only.
- **dashboards-routes.ts** — `dashboard.create/update/delete` (delete fetches before).
- **ontology-routes.ts** — `ontology_distribution.delete` (fetch before if available).

## Data flow

```
mutating /api request → handler runs the operation → on success:
  recordAudit(ctx, req, {action, entityType, entityId, before, after, metadata})
  → actorFromRequest(req.user) + details → ctx.audit.record (best-effort)
```

## Error handling

- Audit failures are swallowed and logged (`ctx.logger.error`); the route's own response is
  unaffected. No audit call is placed before the operation it describes.
- Validation/404/409 paths are NOT audited (no state change occurred).

## Testing

- Add a recording `audit` stub (collecting recorded events) and a `logger` stub to each
  route file's fake ctx. Assert: event count, `action`, `entityType`, `actorType:'user'` +
  `actorId`/`actorName` from the injected request actor, and before/after shape.
- Forms tests: assert the recorded actor is the request actor, not `System`.
- Best-effort test: an `audit.record` that rejects must NOT change the route's status code.
- No-op test: failed-validation / 404 requests record nothing.

## Boundaries

- All audit wiring stays at the route layer via one helper; domain stores
  (`ctx.users`, `ctx.forms`, …) are untouched (they have no request/actor context).
- The helper is the single place actor resolution and best-effort recording live.

## Acceptance

- `pnpm turbo typecheck lint test build` and `pnpm depcruise` green.
- Every in-scope mutation records an audit event with the real request actor and correct
  action/entityType; before/after present per the conventions.
- A failing audit recorder never changes a route's behaviour (best-effort verified).
- Forms audit no longer records `System` for user-driven changes.
