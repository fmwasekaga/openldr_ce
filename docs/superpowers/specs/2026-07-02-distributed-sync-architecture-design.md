# Distributed Sync (Remote Lab ⇄ Central) — Architecture Design

**Date:** 2026-07-02
**Status:** Approved architecture (brainstorm) — **FUTURE workstream; brainstorm-only, not scheduled for implementation.** This is a north-star design + decomposition; each slice gets its own spec → plan → implementation cycle when the user says build.
**Relates to:** `distributed-sync-central-workstream`, `settings-general-feature-flags` (Sync card + config), `gateway-single-port-next-iteration` (central endpoint exposure), `auth-users-audit-workstream` (Keycloak), `real-default-workflow-idea` (per-sender/site row-ownership).

## Problem & motivation

Real deployments (e.g. Mozambique) run a **distributed topology**: a full OpenLDR CE instance in each lab, reconciling with a **central** OpenLDR CE. Networks are **bandwidth-constrained and intermittent**, so a lab must keep working fully offline and reconcile *opportunistically*. We need an offline-first sync layer: labs push their operational data up, pull reference data (and later, central amendments) down, over unreliable links, with per-lab data isolation.

## Approved decisions (from brainstorm)

1. **Deliverable:** whole-system architecture spec + decomposition. Stop at the spec; no implementation plan yet.
2. **Ownership = hybrid.** Directional single-writer ownership as the backbone, plus an explicit conflict policy for a *narrow, designed-now-built-later* co-edited set. Initial buildable slices are directional-only.
3. **Transport = lab-initiated HTTPS sync API + change-log cursor, PLUS a file/store-and-forward fallback** for offline sites.
4. **Auth = Keycloak client-credentials per lab + `site_id` scoping;** every synced record stamped with its originating site-id; central rejects cross-site writes.

## 1. Topology & roles

- **N lab instances** (each a full OpenLDR CE + own Postgres) ↔ **1 central instance** (full OpenLDR CE + a sync-server role, reachable at a stable URL via the nginx gateway).
- The **lab is always the client** (initiates all network sync; works behind NAT/firewalls). Central never dials out to labs.
- Each lab has a **site-id**, assigned at enrollment, mapping to an `Organization`/`Location`. Central knows every site.
- **v1 topology = star** (labs → central). Hierarchical (region → national fan-in) is a documented future extension, not in scope.

## 2. Ownership model (hybrid)

| Class | Direction | Entities | Apply rule |
| --- | --- | --- | --- |
| **Lab-owned** | push **up** (center = read-only mirror) | ServiceRequest (orders), Observation (results), Patient, Specimen, DiagnosticReport, and other operational FHIR resources | central upserts into its mirror, keyed by (site-id, resource id); a lab may only write its own site-id |
| **Center-owned** | push **down** (labs = read-only) | forms, terminology, dashboards, selected settings/feature-flags | lab upserts into local store; center is sole writer |
| **Co-edited** (designed, deferred) | round-trip | result validation/amendment; patient MPI merge; order status/routing | FHIR-native versioning (see §5) |

- **Users/roles:** kept **lab-local in v1** (Keycloak already centralizes authentication; user *records* are decoupled per the auth workstream). Revisit centralized user management when MPI/co-edit lands.
- **Not synced in v1:** per-lab secrets/connectors (lab-local by design), audit logs, workflow run history, plugin binaries (distributed via the marketplace, not sync).

## 3. Change-capture engine

- A dedicated **append-only sync change-log** table (sibling to `outbox_events`; keep sync concerns separate from the eventing bus), populated from the same write choke-points: `persistResources()` for FHIR data, and the forms/terminology/dashboard store writes for center-owned reference data.
- **Row shape:** `seq` (bigserial, monotonic per instance), `entity_type`, `entity_id`, `site_id`, `version_id`, `op` (`upsert` | `delete`), `content_ref` (pointer/hash into the canonical store), `recorded_at`.
- **Deletes** propagate as **tombstones** (`op:'delete'` rows), retained for a compaction window (see S6), so deletions replicate without full-table diffing.
- **Cursors:** each **(peer, direction) stream** tracks a high-water-mark `seq`. A lab stores "last seq pushed to central" and "last central seq pulled"; central stores, per lab L, "last seq received from L" and "last central seq L has pulled". Cursors live in a small `sync_cursors` table.

## 4. Transport & protocol

Central exposes an authenticated **/sync API** behind the gateway:

- **`POST /sync/push`** — the lab uploads a batch of its outbound change-log rows since its push-cursor. Central validates **site-ownership per record** (§6), applies each idempotently (by `entity_id` + `version_id` — already-applied rows are no-ops), and returns the new ack-cursor plus a **per-record reject list**.
- **`POST /sync/pull`** — the lab requests inbound changes (center-owned reference data +, later, amendments addressed to it) since its pull-cursor. Central returns a delta batch + next cursor.
- **Bandwidth-aware:** batched, **gzip-compressed**, **resumable** — a failed batch simply re-requests from the last acked cursor; idempotent apply makes retries safe.
- **Sync worker (lab side):** a background loop runs on an **interval + on-demand ("Sync now")**, with exponential backoff when offline. Implemented as a dedicated host loop (like the existing `WorkflowListenerManager`) or a scheduled internal job — decided at S1.
- **Store-and-forward fallback:** the identical delta batches serialize to **signed bundles** — `openldr sync export` writes a bundle file (for physical/opportunistic transfer), `openldr sync import` ingests it at central through the **same idempotent apply path**; the bundle signature (the lab's key) is verified before apply.

## 5. Co-edit & conflict policy (designed now, built in S5)

- Co-edits are modeled **FHIR-natively**, not as in-place field overwrites:
  - **Result validation/amendment:** the center's change is a **new resource version** (`meta.versionId` bump, `status: amended|corrected`) with a **Provenance** resource linking to the prior version. The lab applies the higher `versionId`.
  - **Patient MPI merge:** the center emits a `Patient.link` (`type: replaced-by`) pointing at the canonical merged identity; the lab adopts the canonical id and marks its local record replaced.
  - **Order status/routing:** a status/`ServiceRequest` update versioned the same way.
- **Conflict policy:** **higher `versionId` wins; tie broken by (center-authoritative, then `updatedAt`)**. Authority derives from `versionId`/`seq`, never wall-clock (only a last-resort tiebreaker) — safe under clock skew. Because lab and center edit *distinct lifecycle phases*, true simultaneous conflict is rare; the policy converges deterministically when it happens.

## 6. Identity, auth & scoping

- Each lab is a **Keycloak client** (client-credentials grant) whose token carries a **`site_id` claim**.
- Central's `/sync` endpoints **validate the token, derive `site_id`, and scope**:
  - **push:** every record's `site_id` must equal the caller's; cross-site writes are **rejected** (central never trusts a client-asserted owner).
  - **pull:** returns only that lab's inbound stream + global reference data.
- **Row-level ownership:** every lab-owned record carries `site_id`; this is the concrete realization of the per-sender ownership deferred from `real-default-workflow-idea`.
- **Enrollment:** an admin registers a lab at central (creates the Keycloak client + a site record, mints credentials), and hands the lab its client credentials + central URL. The lab stores them **encrypted** (via `SECRETS_ENCRYPTION_KEY`) and configures the Sync card.

## 7. UI + CLI

- **Sync card in Settings → General:** online/offline state, last-synced timestamp per direction, pending push/pull counts, **"Sync now"**, enrolled site-id + central URL, last error + retry. Mirrors corlix's `SyncState` client model (the cited reference; corlix is **not** in this workspace — revisit at the S3 UI slice).
- **CLI parity** (per the CLI-operator-parity convention, shared logic via `@openldr/bootstrap`): `openldr sync status | now | export | import | enroll`. Destructive/enrollment ops gated appropriately.

## 8. Error handling & consistency guarantees

- **Delivery:** at-least-once + dedup by (`entity_id`,`version_id`) → **effectively-once** apply.
- **Ordering:** apply in `seq` order per stream; **referential ordering** (e.g. `Patient` before an `Observation` that references it) handled by dependency-aware batching or apply-and-retry-on-missing-reference.
- **Partial failure:** per-record reject list; the lab logs + retries rejected rows; a **poison record is quarantined** and does not block the stream.
- **Security:** site-id is always token-derived, never client-asserted; bundle imports verify signature before apply.
- **Idempotency everywhere:** re-pushing/re-pulling from an earlier cursor is always safe.

## 9. Decomposition & build order

Each slice is independently shippable and gets its own spec → plan when built.

- **S0 — Foundations:** `sync_changes` + `sync_cursors` tables; capture hooks at the persist/reference-write choke-points; site-id stamping. No network; fully unit-testable.
- **S1 — Directional push (lab → central):** `/sync/push`, lab sync worker, Keycloak client auth + site scoping, idempotent mirror apply. **MVP: results flow up.**
- **S2 — Directional pull (central → lab):** `/sync/pull`, reference-data (forms/terminology/dashboards/settings) push-down apply.
- **S3 — Sync UI + CLI + enrollment:** Settings→General Sync card, `openldr sync …`, lab enrollment flow.
- **S4 — Store-and-forward bundles:** signed delta bundle export/import for offline sites.
- **S5 — Co-edit + conflict policy:** result amendment / patient MPI merge / order status via FHIR versioning + Provenance and the version-wins policy.
- **S6 — Hardening:** tombstone compaction/retention, backpressure, large-batch resumability, observability/metrics.

## 10. Testing strategy

- **Unit:** change-capture emits correct log rows; cursor advance; idempotent apply (id+versionId); site-scope rejection; conflict policy (version-wins + tiebreak); tombstone propagation.
- **Integration:** two OpenLDR instances (or two Postgres DBs) — push/pull round-trip; offline → reconcile; bundle export/import; cross-site write rejection; referential-ordering apply-retry. Reuse the existing multi-DB test harness (`pnpm mssql:accept`-style acceptance patterns).

## Open items (resolve at slice time)

- Centralized user/role management (deferred; v1 keeps users lab-local).
- Sync worker mechanism (dedicated host loop vs. scheduled internal job) — decide at S1.
- Reference-data granularity (whole-form vs. field-level deltas) — decide at S2.
- Hierarchical (region → national) topology — future extension beyond v1.
