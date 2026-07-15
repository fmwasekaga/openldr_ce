# Distributed Sync S7 — Same-Version Divergence Detection (design)

**Date:** 2026-07-15
**Status:** Approved (brainstorm) → ready for implementation plan
**Workstream:** distributed-sync. S1 push, S2 pull config, S3 terminology, S4 UI+enrollment, S5 store-and-forward bundles, S6a/S6c/S6b co-edit set, S7-A quarantine, S7-B gzip all DONE. This closes the **last known correctness gap** from the co-edit set.
**Supersedes:** the "Known limitation (→ S7)" in `2026-07-15-distributed-sync-s6a-result-amendment-design.md` §7.1.

---

## 1. Summary

`applyRemote`'s idempotency key is `(resource_type, id, version)`. When two sides independently author the *same* version with *different* content, each side's apply finds the key already present and returns `'skipped'` — discarding the incoming content, advancing the cursor, and reporting healthy. The two databases then hold permanently different content at the same version, and **nothing in the system ever notices**.

This slice makes that condition **visible**. It does not heal it.

Detection is placed inside `applyRemote`'s existing idempotency check, where the stored row is already being read. Comparing content there separates "already applied" (a true idempotent re-drain) from "different content at the same version" (a real divergence) at the exact moment the content is dropped, with no new capture substrate, no new stream, and **no wire-protocol change**.

## 2. The gap, concretely

1. Lab authors a preliminary result at `v1` and pushes it up (S1). Central mirrors it at `v1`.
2. A central operator amends it (S6a) → central mints `v2` = `max(central history) + 1`.
3. In the window before that amendment reaches the lab, the lab re-edits the result locally → the lab's `save()` also mints `v2`, with different content.

Now:

- **Lab's `v2` → central's `POST /api/sync/push`** → `applyRemote` finds history PK `(rt, id, 2)` → `'skipped'`. The lab's edit is dropped at central.
- **Central's `v2` amendment → lab's amendment pull** → `applyRemote` finds the lab's own `v2` → `'skipped'`. Central's amendment is dropped at the lab.

Both cursors advance. Both sides report healthy. The divergence is permanent until some later version happens to propagate over it.

**Why the existing hashes can't detect this:** `save()` deliberately hashes the *pre-stamp* content (excluding `meta.versionId` / `meta.lastUpdated`) so identical content hashes stably; `applyRemote` hashes the *stored* content, including meta. The two `change_log.content_hash` values are therefore not comparable across a save-authored and a mirror-applied row. This slice computes its own hash (§5.3).

## 3. Goals / non-goals

**Goals**
- Detect same-version divergence on **every** sync apply path, in both directions.
- Record it durably and atomically with the skip that caused it.
- Surface it to an operator (CLI + admin HTTP) with the dropped content available **offline**.
- Prove it on a live two-database harness that drives the real race.

**Non-goals (explicit)**
- **Auto-heal / automatic conflict resolution** — see §4 decision 1.
- A studio UI (CLI + endpoint only this slice, matching S7-A).
- Retention/compaction of `sync_divergences` (→ the existing S7 log-retention backlog item).
- Detecting divergence in *reference* data (terminology / config). `applyRemote` is FHIR-only; reference data flows through `applyReferenceChange`/`syncSystem` and is single-writer by design.

## 4. Core decisions (from brainstorm)

1. **Detect and surface only — no auto-heal.** Only a human knows which content is clinically correct. Center-wins auto-heal would silently discard a possibly-correct lab edit, reintroducing the same silent-data-loss failure one level up.
2. **A new `sync_divergences` table**, not a reuse of `sync_quarantine`. Quarantine is a *liveness* problem keyed `(entity_type, entity_id)` and resolved by a successful retry. Divergence is a *correctness* problem, inherently keyed by version, and **no retry can ever resolve it** — replaying the record just skips again. Folding them together would produce a `retryQuarantine` that cannot fix half its rows.
3. **Operator clears explicitly.** No auto-resolve when a higher version arrives: that would tell you the disagreement *ended*, not that the *right content won* — a lab tech re-saving an unrelated field at `v3` would silently auto-close a divergence where central's clinical correction was what got dropped.
4. **Store the dropped incoming body**, with a **PHI-free list / PHI-bearing detail split**. This system's premise is bandwidth-constrained, intermittent links; an operator cannot "just go look at central." The dropped body is stored so the divergence is diffable locally and offline.
5. **Compare `canonicalHash` of the body with volatile meta stripped** (`meta.versionId`, `meta.lastUpdated`). Follows the precedent `save()` already set, is immune to key-order drift, and eliminates the only real false-positive class.
6. **`applyRemote` writes the row inside its own transaction** and returns a new `'diverged'` result. Atomic and unforgettable.

## 5. Data model & detection

### 5.1 `sync_divergences` (migration `056`)

Lands in the **internal migration set** (`packages/db/src/migrations/internal/`), created **unprefixed** → the internal DB's **public** schema, and typed into `InternalSchema` (`packages/db/src/schema/internal.ts`). This is exactly the `055_sync_quarantine` precedent — sibling of `reference_change_log` / `sync_amendments` / `sync_quarantine`.

```sql
create table sync_divergences (
  resource_type    text        not null,
  resource_id      text        not null,
  version          bigint      not null,
  local_hash       text        null,       -- canonical hash of the body we KEPT; NULL = tombstone
  incoming_hash    text        null,       -- canonical hash of the body we DROPPED; NULL = tombstone
  incoming_body    jsonb       null,       -- the dropped content (PHI — see §7); NULL = tombstone
  incoming_site_id text        not null,   -- origin stamp from the wire record
  detected_at      timestamptz not null default now(),
  primary key (resource_type, resource_id, version)
);
```

- **PK grain = `resource_history`'s grain**, which is the grain at which divergence is defined. A resource can diverge at `v2` and again at `v5`; those are two independent facts and two rows.
- **Re-delivery is a no-op** (`onConflict ... doNothing`) — a stuck redelivery loop can neither inflate the table nor churn `detected_at`.
- **No `status`/`resolved` column.** Per decision 3 the only lifecycle is open → cleared, and cleared means the row is **deleted**. A row's existence *is* the open state. (This is where it deliberately differs from `sync_quarantine`, which needs `status` because `holding` and `quarantined` are genuinely different in-flight states.)
- **Both sides get the table.** Central and lab share `applyRemote`, so neither needed slice-specific wiring.

### 5.2 Detection point

Inside `applyRemote`'s existing idempotency check (`packages/db/src/fhir-store.ts`), which already selects the history row for `(resourceType, id, version)`. It gains a comparison:

| Condition | Result |
|---|---|
| No history row at this version | unchanged — apply |
| History row, hashes **equal** | `'skipped'` (unchanged behavior), **no row written** |
| History row, hashes **differ** | `recordDivergence(trx, …)` + return `'diverged'` |

The existence SELECT must also read the stored `resource` to hash it. This SELECT is read-only and does not assign an xid, so the **projection safe-frontier invariant is unaffected** (`change_log` must not be the transaction's first write — it still isn't; on the diverged path there are no `change_log`/`fhir_resources` writes at all).

**Tombstones are a content value, not an exemption.** A tombstone (`op: 'delete'`, null body) hashes to **NULL** = "no content", and the comparison is NULL-aware (`is distinct from`):

| Local | Incoming | Outcome |
|---|---|---|
| tombstone | tombstone | hashes both NULL → **not distinct** → `'skipped'`, no row. Two deletes agree; nothing was lost. |
| body A | body A | equal → `'skipped'`, no row |
| body A | body B | distinct → **diverged** |
| tombstone | body | distinct → **diverged** (a delete-vs-edit collision at the same version) |
| body | tombstone | distinct → **diverged**; the row stores `incoming_hash = NULL`, `incoming_body = NULL` |

The last two are real: a lab may delete a resource at `v2` while central amends it to `v2`. This is exactly the silent loss the slice targets, so it must be representable — hence the nullable hash/body columns in §5.1 rather than `not null`.

### 5.3 Comparison basis

`canonicalHash` (from `@openldr/core` — the single content-hash function S2 promoted) over the body with `meta.versionId` and `meta.lastUpdated` stripped, via one small shared helper.

- **Canonical** ⇒ immune to key-order drift. Raw-string comparison happens to work today because both stored bodies flow through the same `JSON.stringify`, but it is silently coupled to key order — a future refactor of `save()` or `applyRemote` would start manufacturing phantom divergences with no test to catch it.
- **Volatile meta stripped** ⇒ two sides holding clinically identical content that differs only in server-stamped timestamps is **not** a divergence (nothing was lost) and must not be flagged. This is the only real false-positive class, and false positives would kill the feature: operators who see noise stop looking, and we are back to silent divergence with extra steps.

### 5.4 `ApplyResult` widening

```ts
export type ApplyResult = 'applied' | 'skipped' | 'diverged';
```

This is a **deliberately breaking** union widening. Every existing caller's `switch`/tally gets a compile error until it decides what to do, which is how we guarantee no path silently ignores the signal. Callers **log and tally only** — the row is already durably recorded in-transaction — and must **not** treat `'diverged'` as an error.

Callers: central's `POST /api/sync/push` (`sync-routes.ts`), the amendment pull runner's `applyRecord`, and both S5 bundle-import directions.

## 6. The both-sides symmetry (why detect-only is sufficient)

A single divergence produces a row on **both** sides, independently:

- Central applies the lab's `v2` push → skips → records a row holding **the lab's** dropped content.
- The lab applies central's `v2` amendment → skips → records a row holding **central's** dropped content.

Each operator sees precisely what their own machine threw away, with the body attached, offline. Consequently:

- **No wire or protocol change.** No new field on `PushResponse`, no negotiation, nothing an old peer can break on. The lab does not need central to tell it; it finds out itself.
- Each side records only what *it* dropped; the full picture needs both. Acceptable — each operator can only act on their own machine anyway.

## 7. Operator surface

### 7.1 Store split

The write must be inside `applyRemote`'s transaction, so it cannot go through a store bound to `db`. To avoid duplicating column knowledge across two files, one module (`packages/db/src/sync-divergence-store.ts`) exports both shapes:

- `recordDivergence(trx, {...})` — standalone, takes the **caller's transaction**. Called by `applyRemote`. `onConflict ... doNothing`.
- `createSyncDivergenceStore(db)` — `list()`, `get(type, id, version)`, `clear(type, id, version)` for the operator paths, mirroring `createSyncQuarantineStore`'s idiom (including the `jsonb`-read normalization for drivers that hand it back as text).

Built **unconditionally** in bootstrap, outside both sync gates — the rows are durable and must be listable on a push-only or sync-disabled node (the S7-A lesson: `listQuarantine` was initially hidden on non-pull nodes).

### 7.2 HTTP

All `requireRole('lab_admin')`, under `/api/settings/sync/*` — the user-authed prefix, **never** the machine-bypassed `/api/sync/*`.

| Route | Returns |
|---|---|
| `GET /api/settings/sync/divergences` | list — **PHI-free**: keys, both hashes, site, `detected_at`. **No body.** |
| `GET /api/settings/sync/divergences/:resourceType/:resourceId/:version` | detail — **includes `incoming_body`** |
| `POST /api/settings/sync/divergences/:resourceType/:resourceId/:version/clear` | 204; 404 if no such row |

The split is the point: the default surface — the one a UI or a bored admin lands on — stays PHI-free like every other settings endpoint, and result content requires an explicit, separately-auditable call. FHIR ids are constrained to `[A-Za-z0-9\-\.]{1,64}`, so they are safe as path segments. Bad input → 400.

### 7.3 Audit

Both **PHI-free**, carrying only the `(type, id, version)` key, and recorded **after** the operation commits (the S4d precedent: a `recordAudit` throw must not fail an operation that already succeeded):

- `settings.sync.divergence.view` — matters because it is a PHI read through a settings route, and should leave a trail even though the audit row itself carries none.
- `settings.sync.divergence.clear`

### 7.4 CLI

Required by the operator-parity convention and the S5 lesson that a CLI-only operator must never be locked out. Follows S7-A's `sync quarantine list|retry` shape and the `emit` / `redactError` / `ctx.close` idiom; errors → exit 1.

```
openldr sync divergence list
openldr sync divergence show <resourceType> <resourceId> <version>
openldr sync divergence clear <resourceType> <resourceId> <version>
```

**No studio UI this slice**, matching S7-A. The operator workflow — inspect, decide, and if central should win, author an amendment at `max+1` via the existing S6a `amend` path, then clear — has a CLI for every step. A UI is a follow-up, not a blocker.

## 8. Error handling & consistency

- **Atomicity (decision 6, unsoftened):** the skip and the record of *why* it was skipped commit together. A crash can never leave a dropped edit with no trace — the exact failure this slice exists to prevent.
- **A `recordDivergence` throw fails the apply — and that is safe.** Every caller already isolates it: central's push route maps a throw to an `apply-error` reject per-record (never 500s the batch), and the amendment runner quarantines the row and advances past it. A missing or broken `sync_divergences` table therefore degrades to the existing apply-error path — noisy and visible, never a wedge.
- **No interaction with S3's cursor-hold policy.** `applyRemote` handles FHIR resources only; terminology bulk goes through `syncSystem`/`applyReferenceChange`. This slice cannot wedge the reference stream.
- **Idempotency preserved.** The `'skipped'` path is byte-identical to today whenever hashes match, which is every genuine re-drain.

## 9. Components

| Piece | Package / file |
|---|---|
| `sync_divergences` (migration `056`, unprefixed → public schema) | `packages/db/src/migrations/internal/056_sync_divergences.ts` + `schema/internal.ts` |
| `recordDivergence(trx, …)` + `createSyncDivergenceStore` | `packages/db/src/sync-divergence-store.ts` |
| Volatile-meta-stripping hash helper | `packages/db/src` (over `@openldr/core` `canonicalHash`) |
| Detection + `'diverged'` in `applyRemote`; `ApplyResult` widening | `packages/db/src/fhir-store.ts` |
| Caller tally/log updates | `apps/server/src/sync-routes.ts`, `packages/sync/src/amend-pull-worker.ts` wiring, `packages/bootstrap/src/sync-bundle.ts` |
| Store construction (unconditional) + `SyncHandle.listDivergences()` / `.getDivergence(t,i,v)` / `.clearDivergence(t,i,v)` | `packages/bootstrap/src/index.ts` |
| 3 HTTP routes + audit | `apps/server/src/settings-routes.ts` |
| `openldr sync divergence list\|show\|clear` | `packages/cli/src/sync.ts` |
| Acceptance `pnpm sync:divergence:accept` | `scripts/sync-divergence-live-acceptance.ts` |

## 10. Testing strategy

**Unit — `applyRemote` carries the weight:**
- same version + different content → `'diverged'` + **exactly one** row, with the dropped body and both hashes
- same version + identical content → `'skipped'`, **no row** (idempotent re-drain unchanged)
- same content differing **only** in `meta.versionId` / `meta.lastUpdated` → `'skipped'`, **no row** — the false-positive guard from decision 5, and the test that protects operator trust
- **the full tombstone matrix of §5.2**: tombstone-vs-tombstone → `'skipped'`, no row; tombstone-vs-body and body-vs-tombstone → **diverged**, with the NULL hash/body persisted and read back correctly (this is the case the `not null` schema would have made unrepresentable — assert it end-to-end, not just at the type level)
- re-delivery of a diverged record → `onConflict doNothing`: no duplicate, **no `detected_at` churn**
- a divergence at `v2` and another at `v5` on the same resource → two independent rows

**Store:** `list` / `get` / `clear`, jsonb normalization.

**Routes:** list is PHI-free (**assert `incoming_body` is absent**, not merely that detail includes it); detail includes it; clear → 204 / 404; role gating; audit recorded and PHI-free.

**CLI:** the three commands, error → exit 1.

**`scripts/sync-divergence-live-acceptance.ts` + `pnpm sync:divergence:accept`** — the real proof, on two PG databases, driving the actual race rather than a replica of it:

1. lab authors `v1` → pushes → central mirrors at `v1`
2. central amends → `v2`
3. lab locally `save()`s its own `v2` (different content)
4. lab pushes → central skips + records
5. lab drains its amendment stream → lab skips + records

Assertions: **both** sides hold a divergence row containing the *other's* content; hashes differ and match the stored bodies; `clear` removes it; a re-drain adds nothing and does not churn `detected_at`; a control resource that never diverged has no row.

The harness must also assert the **"before"** — that this exact sequence is silent today — so the test proves the gap as well as the fix.

Per the S7-A/S7-B lesson (three separate times a green unit gate could not see the failure mode: the inline retry closure, the inert `compress` register, the body-clobbering bare `reply.send`), **this harness is where a real defect is most likely to surface**, and the whole-slice review is expected to find what the per-task gate does not.

**Regression:** all existing sync acceptance harnesses must re-pass — in particular `sync:accept`, `sync:amend:accept`, `sync:order-status:accept`, `sync:patient-merge:accept` and `sync:bundle:accept`, which together exercise every `applyRemote` caller.

## 11. Known limitations (documented in-code and here)

- **No auto-heal** (decision 1, by design). Divergences accumulate until an operator acts.
- **`sync_divergences` holds PHI and has no retention/compaction** — rows leave only by operator clear. Lands squarely in the existing S7 log-retention backlog item rather than being solved here.
- **Each side records only what it dropped**; the full picture needs both (§6).
- **Resolving a divergence by amending at `max+1` does not auto-clear its row** — decision 3, not an oversight.
- **`lab_admin` can read result content** through the detail endpoint. Accepted deliberately (decision 4) and mitigated by the list/detail split + the view audit.
- **Reference/terminology data is out of scope** — single-writer by design, and not an `applyRemote` path.
