# Distributed Sync S6a — Central Result Amendment (design)

**Date:** 2026-07-15
**Status:** Approved (brainstorm) → ready for implementation plan
**Workstream:** distributed-sync (S1 push, S2 pull config, S3 terminology, S4 UI+enrollment, S5 store-and-forward bundles all DONE + PUSHED). This is the **first co-edit slice**.
**North-star:** `docs/superpowers/specs/2026-07-02-distributed-sync-architecture-design.md` §5 (labelled "S5" there; current workstream numbering: S5 = store-and-forward DONE, **S6 = co-edit/conflict**, S7 = hardening).

---

## 1. Summary

Every sync slice to date is **directional single-writer**: the lab owns operational FHIR (pushed *up*; central is a read-only mirror), and central owns reference config + terminology (pushed *down*, global to all labs). **S6a is the first time central writes to a lab-owned resource and routes that change back *down* to only the owning lab.**

Concretely: a lab pushes a preliminary result up (S1, existing). A central operator validates/corrects it — this authors a **new version** of that lab-owned resource plus a FHIR **`Provenance`** resource at central, captured into a **site-scoped amendment outbox**. The owning lab pulls its amendments down a **new site-scoped stream** and applies them through the existing `applyRemote` (higher version wins). The net-new capability is the **central → owning-lab downward flow of an operational resource**, which every prior slice avoided (S2/S3 pull served *global* reference data, not per-lab operational data).

**Scope of S6a: result validation/amendment only.** Patient MPI merge (S6b) and order status/routing (S6c) are deferred to their own spec→plan cycles; they reuse the transport this slice builds.

## 2. Goals / non-goals

**Goals**
- A central operator can amend a lab-owned result (`Observation` / `DiagnosticReport`), producing a new FHIR version + a `Provenance` audit resource.
- The amendment routes to **only the owning lab** and applies deterministically (higher version wins, idempotent).
- A driveable operator surface (CLI + admin HTTP endpoint) and a two-DB live acceptance harness.

**Non-goals (deferred, explicit)**
- Store-and-forward (bundle) parity for amendments → S6b/S7.
- A studio "result review/validation" UI → later slice.
- Robust center-wins-on-tie / same-version divergence detection → S7 (see §7).
- Patient MPI merge (S6b), order status/routing (S6c).

## 3. Core decisions (from brainstorm)

1. **Scope:** result amendment only (S6a).
2. **Capture:** a dedicated per-lab **amendment outbox** (`sync_amendments`), not an overload of the frozen `fhir.change_log` (mirrors how S2 built `reference_change_log` as its own substrate).
3. **Operator surface:** minimal transactional primitive + **CLI + admin endpoint**; no studio UI yet.
4. **Provenance:** a **full FHIR `Provenance` resource** riding the same amendment stream and applied via `applyRemote` (not embedded, not deferred).
5. **Conflict policy:** minimal & deterministic — keep `applyRemote`'s strict `version < incoming` guard untouched; achieve center-authority structurally by **amending at `max(central history)+1`**; document the rare same-version divergence as a known S7 limitation.

## 4. Data model & capture

### 4.1 `sync_amendments` outbox (migration `054`, central-side)

```sql
create table sync_amendments (
  seq           bigserial primary key,   -- cursor axis for this stream
  site_id       text not null,           -- the OWNING lab (routing key)
  resource_type text not null,
  resource_id   text not null,
  version       bigint not null,         -- the central-minted amendment version
  recorded_at   timestamptz not null default now()
);
```

- **Public schema** (sibling of `reference_change_log`), not the `fhir` schema — keeps the frozen `fhir.change_log` contract (migration 046) untouched.
- **No resource body stored here** — it's a signal/pointer. The serve reads the live body from `fhir.resource_history` at `(resource_type, resource_id, version)`. This mirrors S2's reference_change_log "signal + serve-live-body" model.
- **Two rows per amendment**, written in the *same transaction* as the fhir writes: one for the amended resource, one for its `Provenance`.

### 4.2 Version & ownership semantics of a central amendment

- `version = max(fhir.resource_history for that resource) + 1` at central. This realizes "amend at max+1": once central has seen the lab's edit (mirrored via S1 push), its amendment is strictly higher and wins cleanly.
- The amended resource **keeps the owning lab's `site_id`** (read from the existing `fhir_resources` row) — it stays lab-owned. The `fhir.change_log` row central writes for this amendment is stamped with the **lab's** `site_id`, not central's, so central's own projection/read-model updates while ownership is preserved. (Central does not run a push worker, so a lab-stamped change_log row at central is not re-pushed anywhere; hierarchical topology is out of scope.)
- Body mutation: `status` → `amended` (or `corrected`); `meta.versionId` set to the new version; corrected values carried via a `patch`.

### 4.3 Provenance resource

A new FHIR `Provenance` resource (version 1, stamped with the **lab's** `site_id`):
- `target` → the amended resource (`{resourceType}/{id}`).
- `agent` → central (the amending authority).
- `recorded` → timestamp; `activity` → `amend` / `correct`; reason text.

It co-locates in the lab's canonical store after apply, giving both sides a durable audit trail. It is a first-class synced resource applied through `applyRemote`.

## 5. Central authoring primitive + operator surface

### 5.1 The primitive

`authorAmendment(ctx, { resourceType, resourceId, status, reason, agent, patch })`:

1. Read the current canonical row → its `site_id` (owning lab) and current body. **Reject** if the resource doesn't exist (404) or isn't lab-owned (409 — central refuses to "amend" its own reference/central-owned data).
2. Compute `version = max(resource_history) + 1`.
3. Build the amended body: apply `status` + `meta.versionId`; `patch` carries corrected values/interpretation.
4. In **one transaction**: write the amended resource (`resource_history` row + monotonic `fhir_resources` upsert + `change_log` row stamped with the **lab's** `site_id`), write the `Provenance` resource the same way (version 1), and insert **two `sync_amendments` rows**.

The transactional multi-write lives in the **db layer** (a new fhir-store method owning the transaction handle); `@openldr/bootstrap` provides thin orchestration + validation and is the shared home for the CLI/HTTP surface (per the CLI-operator-parity convention).

### 5.2 Operator surface (decision 3)

- **CLI:** `openldr sync amend --resource-type Observation --id <id> --status amended --reason "<text>" [--patch <json>]` — prints the new version; errors → exit 1.
- **HTTP:** `POST /api/sync/amend` under the **user-authed, role-gated** `/api/settings/sync/*` namespace (`requireRole('lab_admin')`), **not** the machine-bypassed `/api/sync/*`. Audited as `settings.sync.amend` (resource reference + new version; no PHI beyond the reference). Errors: not-found → 404, not-lab-owned → 409, bad input → 400, identity/misconfig → 503 as applicable.

## 6. Transport — the site-scoped amendment pull

### 6.1 A dedicated stream, distinct cursor

Amendments are site-scoped and the existing `/api/sync/pull` serves *global* reference config, so S6a adds a **separate** endpoint rather than overloading it.

- **`POST /api/sync/pull-amendments`** — machine-authed under `/api/sync/*`; derives `site_id` from the token via the existing `sitePrincipal`; serves `sync_amendments WHERE site_id = principal.siteId AND seq > fromSeq` (limit N, deduped to latest per `(resource_type, resource_id)`), reading the live body from `fhir.resource_history` at each row's version. **This is the first genuinely site-scoped serve in the sync layer** — mirror image of push's cross-site *write* rejection: a lab can only ever pull its own amendments.
- **Wire format reuses `SyncRecord`/`RemoteRecord`** — the same shape S1 push carries lab→central, now flowing central→lab. The lab applies each record through the **existing `applyRemote`** (higher version wins, idempotent) — **no new apply path**.
- **New cursor consumer `'sync-amend-pull'`** in `fhir.change_cursors`, distinct from `'sync-pull'` / `'sync-push'` / `'projection'`.
- **Worker:** the existing pull-worker host loop gains a **second drain step** (as S3 added terminology draining) — after draining reference config it drains amendments from the new endpoint.
- **Serve extraction:** `serveAmendments(ctx, siteId, fromSeq)` in `packages/bootstrap/src/sync-serve.ts`, alongside `servePull`.

### 6.2 Store-and-forward parity — deferred

S5's bundles carry push + pull records. Extending them to a *third, site-scoped* amendment stream (a new bundle kind, export site-scoping, import cursor contiguity) adds real surface. S6a's load-bearing novelty is the **online** site-scoped pull; bundle parity is a deliberate deferral to S6b/S7, not an omission.

## 7. Conflict policy & error handling

### 7.1 Conflict policy (decision 5)

`applyRemote` is untouched: **higher `version` wins; exact-version tie keeps existing content, idempotent** via the `resource_history` PK. Central authority is expressed *structurally* — central always amends at `max(central history)+1`, so once it has seen the lab's edit its amendment is strictly higher and wins cleanly.

**Known limitation (→ S7):** if a lab re-edits a result to `vN` locally in the window *after* pushing but *before* central's `vN` amendment arrives, both mint `vN` with different content and the `(resource_type, id, version)` history PK means neither overwrites the other → silent same-version divergence. Rare by the distinct-lifecycle-phases argument (central validates a result the lab treats as finalized once amended); detection/auto-heal deferred. Documented in-code and here.

### 7.2 Error isolation / consistency

- **Authoring** is fully transactional — amended resource, Provenance, and both outbox rows commit together or not at all. A resource that doesn't exist or isn't lab-owned is rejected *before* any write.
- **Serve** wraps per-record body fetch in try/catch (poison-pill isolation, as S2/S3 pull do) so one unreadable `resource_history` row can't 500 the endpoint.
- **Apply** reuses `applyRemote`'s per-record error isolation; a malformed/failing record is quarantined and the `'sync-amend-pull'` cursor advances past it. Amendments are **per-row** like S2 config (advance-past-quarantine), **not** hold-the-cursor like S3 bulk terminology.
- **Ordering:** the target resource already exists at the lab (it's the lab's own resource), and Provenance references it by id, so target-vs-Provenance apply order is immaterial; both are idempotent.
- **Auth:** amend authoring is `lab_admin`-gated and user-authed; the amendment *pull* is machine-authed and **site-scoped by token-derived `site_id`** — cross-site read is structurally impossible.

## 8. Components

| Piece | Package / file |
|---|---|
| `sync_amendments` outbox (migration 054) | `@openldr/db` migrations |
| `authorAmendment` transactional primitive (+ Provenance) | `@openldr/db` fhir-store + `@openldr/bootstrap` |
| `openldr sync amend` CLI | `@openldr/cli` (`sync.ts`) |
| `POST /api/settings/sync/amend` (lab_admin) | `@openldr/server` (settings-routes) |
| `serveAmendments` | `packages/bootstrap/src/sync-serve.ts` |
| `POST /api/sync/pull-amendments` (site-scoped) | `@openldr/server` (sync-routes) |
| `'sync-amend-pull'` cursor + pull-worker drain step | `@openldr/sync` + `@openldr/bootstrap` |
| Apply via existing `applyRemote` (RemoteRecord wire) | reused, no change |
| Acceptance `pnpm sync:amend:accept` | `scripts/sync-amend-live-acceptance.ts` |

## 9. Testing strategy

- **Unit:** outbox capture emits the two rows atomically with the fhir writes; `authorAmendment` version = max+1 and preserves the lab's `site_id`; not-lab-owned rejected; serve dedups + site-filters correctly; a second lab's token sees none of lab A's amendments.
- **Apply / round-trip (in-process):** amended resource + Provenance land at the lab at the central-minted version; re-pull is idempotent; a lower/equal version is skipped (monotonic guard); poison record quarantined + cursor advances.
- **Live acceptance** `scripts/sync-amend-live-acceptance.ts` + `pnpm sync:amend:accept` — two-PG round-trip (lab + central): lab pushes a preliminary `Observation` up (reuse S1 path) → central `authorAmendment` marks it `amended` + writes `Provenance` → lab pulls `pull-amendments` → assert the lab's canonical read-model shows `status=amended` at the higher version, the `Provenance` resource present, `site_id` preserved (still lab-owned), cross-site isolation (a 2nd site pulls nothing), idempotent re-drain. Plus a live-Keycloak smoke that `POST /api/sync/amend` is `lab_admin`-gated and `POST /api/sync/pull-amendments` is site-scoped.
- **Regression:** S1–S5 acceptance harnesses (`sync:accept`, `sync:pull:accept`, `sync:terminology:accept`, `sync:enroll:accept`, `sync:bundle:accept`) all re-pass.

## 10. Build / process conventions

- Branch `feat/sync-s6a-amendment`; subagent-driven per task with two-stage review (spec conformance + quality); merge `--no-ff`.
- Gate `pnpm turbo run typecheck test --force` per-package on Windows (never pipe turbo through `tail`; verify flakes by running the package's `vitest run` directly).
- Ask before pushing to origin. **No `Co-Authored-By` trailer** (user is sole contributor).
- Dev: PG `:5433` (`docker compose up -d postgres`); real Keycloak `openldr_ce-keycloak-1` (realm `openldr`, admin `openldr-admin`) for live smokes; `pnpm exec tsx` for scripts.

## 11. Follow-ups after S6a

- **S6b** — patient MPI merge (`Patient.link replaced-by`; a different apply than a version bump).
- **S6c** — order status / `ServiceRequest` routing (shares the versionId-bump apply).
- **S7** — bundle parity for amendments; studio validation UI; same-version divergence detection / robust center-wins-on-tie; plus the standing S5/S4d deferrals.
