# Distributed Sync S6c — Order Status / Metadata Co-edit (design)

**Date:** 2026-07-15
**Status:** Approved (brainstorm) → ready for implementation plan
**Workstream:** distributed-sync. S1 push, S2 pull config, S3 terminology, S4 UI+enrollment, S5 store-and-forward, **S6a result amendment** all DONE (S6a merged local `main` `7475f22b`). This is the **second co-edit slice**, riding entirely on S6a's transport.
**North-star:** `docs/superpowers/specs/2026-07-02-distributed-sync-architecture-design.md` §5 ("order status/routing: a ServiceRequest update versioned the same way"). S6a spec: `2026-07-15-distributed-sync-s6a-result-amendment-design.md`.

---

## 1. Summary

S6a built the load-bearing capability: central authors a new version of a lab-owned resource (keeping the lab's `site_id`) + a `Provenance`, captures it into the per-lab `sync_amendments` outbox, and the owning lab drains it site-scoped and applies it via the monotonic `applyRemote`. **S6c extends that same machinery to lab orders** — the FHIR `ServiceRequest` resource (projected to the `lab_requests` read-model table with `status`/`priority`).

Because `amend` already version-bumps *any* lab-owned resource, and the whole transport (outbox → `serveAmendments` → amendment pull runner → `applyRemote`) is resource-type-agnostic, S6c is a **thin slice**: three edits to the `amend` primitive, one optional param on each operator surface, and acceptance. **No new table, endpoint, stream, runner, wiring, or read-model work.**

## 2. Scope decisions (from brainstorm)

1. **"Order status/routing" = in-resource status + metadata only; the order stays lab-owned.** Central changes the `ServiceRequest`'s lifecycle `status` (e.g. `active` → `on-hold`/`revoked`/`completed`) and/or metadata (`priority`, `performer`, routing/location references) as a versioned update that preserves the owning lab's `site_id` — exactly S6a's model. **Deferred (own future slice):** cross-site re-assignment (moving an order to a different lab by changing its `site_id`) — an ownership *transfer*, a genuinely new capability S6a/S6c never do.
2. **Generalize the one `amend` primitive** with an optional Provenance `activity` parameter (default `amend`; order path passes `update`) + a resource-type allowlist. One primitive, one outbox, one pull stream, one applier — not a sibling `updateOrderStatus`.
3. **Reuse the `amend` operator surface** — `POST /api/settings/sync/amend` + `openldr sync amend` gain an optional `activity`; no new endpoint/CLI command.
4. **No per-type status-vocabulary validation** (consistent with S6a — the primitive sets whatever `status` it's given; the `lab_admin` operator is trusted; enforcing FHIR value-sets per type is scope creep).

## 3. The primitive change (`@openldr/db` `fhir-store.ts`)

The only substantive code. Three edits to `FhirStore.amend`:

### 3.1 `activity` parameter → Provenance activity coding
- `AmendInput` gains `activity?: string` (default `'amend'`).
- The Provenance `activity`, currently hardcoded `{ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: 'AMEND', display: 'amend' }`, is derived: `{ system: <v3-DataOperation>, code: activity.toUpperCase(), display: activity.toLowerCase() }`.
- Default `'amend'` reproduces S6a's exact coding byte-for-byte → existing S6a callers (endpoint/CLI with no `activity`) and the S6a acceptance harness are unchanged. An order status change passes `'update'` → `UPDATE`/`update`.

### 3.2 Resource-type allowlist
- Module const `AMENDABLE_TYPES = new Set(['Observation', 'DiagnosticReport', 'ServiceRequest'])`.
- `amend` throws a new typed `UnsupportedResourceTypeError` (name `'UnsupportedResourceTypeError'`) for any other type. This blesses `ServiceRequest` **and** closes the S6a-deferred gap (S6a's final review flagged that `amend` injected `status` on any lab-owned type with no allowlist).
- **Ordering:** the allowlist check is cheap input validation and runs **before** opening the transaction — so it fires ahead of the existing `ResourceNotFoundError` / `NotLabOwnedError` checks.

### 3.3 Everything else untouched
Version = `max(resource_history)+1`; site_id preserved (owning lab, resolved from the latest `change_log` row); `patch` shallow-merged with `resourceType`/`id` stripped (already carries `priority`/`performer`/routing fields); two `sync_amendments` outbox rows; the `writeVersion` history→resources→change_log ordering invariant.

## 4. Operator surface (one optional param per surface)

### 4.1 `POST /api/settings/sync/amend` (`apps/server/src/settings-routes.ts`)
- Accept optional `activity` string in the body, pass through to `ctx.fhirStore.amend`.
- Add error mapping **`UnsupportedResourceTypeError` → 400**, alongside the existing `ResourceNotFoundError` → 404 and `NotLabOwnedError` → 409.
- Audit unchanged (PHI-free); add `activity` to the audit `metadata` for a complete trail.

### 4.2 `openldr sync amend` (`packages/cli/src/sync.ts` + `index.ts`)
- Add `--activity <token>` (default `'amend'`), passed through.
- Map `UnsupportedResourceTypeError` to a friendly fail (e.g. `"only Observation, DiagnosticReport, ServiceRequest can be amended"`).
- Operator flow for an order: `openldr sync amend --resource-type ServiceRequest --id <id> --status completed --activity update --reason "..."`.

## 5. Transport & read-model — unchanged (the payoff)

**Transport:** a `ServiceRequest` amendment is just another `SyncRecord` in the `sync_amendments` outbox. `serveAmendments` (site-scoped), the amendment pull runner (`'sync-amend-pull'` cursor), the `POST /api/sync/pull-amendments` route, and the bootstrap pull-loop wiring are all resource-type-agnostic → **nothing to build.**

**Read-model:** applying the new `ServiceRequest` version writes to `change_log`; the projection worker re-projects via the existing `projectServiceRequest` → `lab_requests.status` updates. Already wired → **nothing to build.** S6c only *asserts* this in acceptance.

## 6. Testing

- **Unit** (extend `packages/db/src/fhir-store-amend.test.ts`):
  - Amending a `ServiceRequest` with `activity: 'update'` bumps the version keeping `site_id`, and the Provenance `activity.coding[0]` is `{ code: 'UPDATE', display: 'update' }`.
  - A non-allowlisted type (e.g. `Patient`) throws `UnsupportedResourceTypeError` (and does so before any write — the resource need not exist).
  - Default-activity path still yields `AMEND` (S6a regression guard).
- **Route** (extend the settings-sync route test): `UnsupportedResourceTypeError → 400`; `activity` passes through to `amend`.
- **CLI** (extend the sync-amend CLI test): `--activity` flows through; unsupported-type error maps to a friendly non-zero exit.
- **Live acceptance** — new `scripts/sync-order-status-live-acceptance.ts` + `pnpm sync:order-status:accept` (two-PG, in-process, modeled on `sync-amend-live-acceptance.ts`): lab authors a `ServiceRequest` (`status: active`) mirrored up → central `amend({ status: 'completed', activity: 'update' })` → lab pulls the amendment stream → assert the lab's `ServiceRequest` is version 2 / `status: completed`, the Provenance activity is `UPDATE`, **`lab_requests.status` = `completed`** after projection, `site_id` preserved, cross-site isolation (a 2nd site pulls nothing), idempotent re-drain.
- **Regression:** `pnpm sync:amend:accept` + the full per-package gate stay green (the default-activity path guarantees S6a is unaffected).

## 7. Components

| Change | Package / file |
|---|---|
| `activity` param + `AMENDABLE_TYPES` allowlist + `UnsupportedResourceTypeError` + activity-derived Provenance coding | `@openldr/db` `fhir-store.ts` |
| `activity` passthrough + `UnsupportedResourceTypeError → 400` + audit `activity` | `@openldr/server` `settings-routes.ts` |
| `--activity` flag + error mapping | `@openldr/cli` `sync.ts` + `index.ts` |
| ServiceRequest round-trip acceptance | `scripts/sync-order-status-live-acceptance.ts` + `package.json` (`sync:order-status:accept`) |
| Docs (order-status usage on the amend surface) | `docs/` (CLI/HTTP/operator) |
| **Transport / serve / runner / wiring / read-model** | **unchanged — nothing to build** |

## 8. Build / process conventions

- Branch `feat/sync-s6c-order-status`; subagent-driven per task with two-stage review (spec conformance + quality); merge `--no-ff` to local `main`.
- Gate per-package on Windows (`pnpm --filter <pkg> exec vitest run` / `tsc --noEmit`); never pipe turbo through `tail`.
- Ask before pushing to origin. **No `Co-Authored-By` trailer.**
- Dev PG `:5433` (`docker compose up -d postgres`) for live acceptance.

## 9. Follow-ups after S6c

- **S6b** — patient MPI merge (`Patient.link replaced-by`; a genuinely different apply than a version bump).
- **S7** — same-version divergence detection (the deferred conflict edge), versioned Provenance `target`, bundle/store-and-forward parity for amendments, studio validation UI, cross-site order re-assignment (ownership transfer), plus the standing S5 deferrals.
