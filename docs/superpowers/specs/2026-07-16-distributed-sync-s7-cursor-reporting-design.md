# Distributed Sync S7 — Reported Site Cursors (A1) (design)

**Date:** 2026-07-16
**Status:** Approved (brainstorm) → ready for implementation plan
**Workstream:** distributed-sync. S1–S5, S6a/S6c/S6b, S7-A quarantine, S7-B gzip, S7 divergence detection, S7 catch-up drain all DONE + pushed.
**Backlog item:** #3 "Log retention/compaction" — **this is A1, its unblocking prerequisite.** Retention itself is NOT built here.

---

## 1. Summary

Central holds two append-only logs that grow forever and are consumed **remotely** by labs: `reference_change_log` (S2 config) and `sync_amendments` (S6a). Trimming either requires knowing the position of the **slowest** consumer.

**Central cannot compute that today.** It records a lab's pull position in exactly one place — `sync-bundle.ts:219`, the **offline bundle** path — and nowhere for the HTTP path, which is the primary transport. There is no equivalent for amendments at all.

This slice makes the two HTTP pull routes record each site's reported position into a new `sync_site_cursors` table. **It deletes nothing.** Its entire purpose is to let central *learn* the frontier so a later slice can trim against it — and to let an operator watch that frontier for a while before anyone trusts it enough to delete.

## 2. Why this is a separate slice (the decomposition)

Backlog item #3 reads as one thing. It is not. It is blocked on two independent prerequisites, both found by reading the code rather than the backlog line:

- **A1 (this slice) — cursor reporting.** Central doesn't know how far behind the labs are.
- **A2 — ownership denormalization.** `fhir.change_log` is **not** purely cursor-consumed. `fhir-store.ts:193` (`latestSite`, from the S6b patient merge) and `:454` (amend's owning-lab lookup) both run `WHERE resource_type=? AND resource_id=? ORDER BY version DESC LIMIT 1` — an **ownership index**, bounded by no cursor. Trim rows older than N days and any resource untouched for N days returns `site_id = ''` → `NotLabOwnedError` → **central can no longer amend it**. Fix: denormalize the owning site onto `fhir_resources` so the lookup stops reading the log.
- **A3 — the actual trim.** Needs A1 **and** A2.

**A1 first, alone, because every one of its failure modes is conservative.** Recording is best-effort: if it fails, the floor stays stale-**low**, central trims **less**, nothing is lost — it costs disk. The same class of bug in A3 **deletes records a lab still needs**. That asymmetry is the whole argument for building the learning half first and watching it before trusting it.

**Also explicitly out of scope** (each its own slice): `fhir.resource_history` (the largest table and PHI — but three shipped features read it for *correctness*, not history: `applyRemote`'s idempotency key **is** `(resource_type, id, version)` in it, and divergence detection reads its stored body to hash — trimming it would manufacture phantom divergences); `audit_events` (compliance-governed — deleting the evidence trail is the risk, and it needs a regulatory answer, not a design instinct); `sync_divergences` PHI retention + pagination (needs a clinical retention rule: how long must a dropped clinical edit stay inspectable?).

## 3. Core decisions (from brainstorm)

1. **A1 alone** — cursor reporting only. No deletion in this slice.
2. **A generalized `sync_site_cursors` table**, not columns on `sync_sites`. Adding a stream needs no migration, and `reported_at` comes free — which #5 (sync observability) needs to distinguish *"caught up"* from *"hasn't spoken to us since Tuesday."*
3. **`sync-pull` and `sync-amend-pull` only.** Push is deliberately excluded — see §6.
4. **Never clamp a reported cursor to `max`.** Always store the latest. See §4 — this is the load-bearing decision.
5. **Record in the routes, not in `serve*`** — with `sync:e2e` extended to prove it, since it is the only harness that drives the real HTTP route. See §5.

## 4. The table, and the one invariant that matters

```sql
create table sync_site_cursors (
  site_id     text        not null,
  consumer    text        not null,   -- 'sync-pull' | 'sync-amend-pull'
  seq         bigint      not null,   -- what the site reports it has CONSUMED (its fromSeq)
  reported_at timestamptz not null default now(),
  primary key (site_id, consumer)
);
```

Mirrors `fhir.change_cursors`'s `(consumer, seq)` shape; one row per (site, stream).

**We record `fromSeq`, not `nextSeq`.** `fromSeq` is what the lab *has*; `nextSeq` is what it is *about to have* — and it may fail to apply and never advance. Understating a lab's progress costs disk; overstating it costs records. Record the conservative number.

### 4.1 NEVER CLAMP — and why this looks wrong

**The upsert always overwrites `seq` with the incoming value, even when it is lower.** This will look like a missing monotonic guard to anyone who knows this codebase, because *every other cursor here is monotonic*: `advanceChangeCursor` and all three sync runners guard with `if (target > cursor)`.

The distinction is the entire safety argument:

> A **local** cursor is a *progress counter* — regression means a bug, so guard it.
> A **reported** cursor is a *safety floor* — its only job is to answer "what must central not delete yet?"

A lab that restores its database from backup, re-enrolls, or recovers from disaster **legitimately** regresses from 5000 to 100, and now needs records 100–5000 **again**. Clamp to `max(stored, incoming)` and central keeps believing 5000, trims that range, and the lab **permanently loses records it is actively asking for** — on the disaster-recovery path, i.e. the worst possible moment.

**A regression is information, not an error.** Log it at `info` (a cursor going backwards is genuinely notable), never guard it. Do **not** alarm: a lab restoring from backup is a legitimate event, and alarming on it trains operators to ignore the alarm.

This reasoning goes in the migration comment **and** the store, because *"fix the missing monotonic guard"* is a very plausible future PR.

### 4.2 One source of truth — `reported_pull_cursor` is dropped

`sync_sites.reported_pull_cursor` (migration `052`) already exists. Leaving it beside the new table means **two sources of truth for the same fact, written by two different transports** — and A3 would have to reconcile them. That is precisely the drift class that has bitten this workstream repeatedly. So the bundle path moves to `sync_site_cursors` and the column is dropped.

**It is not write-only — it has a real consumer, and the drop is bigger than it first looks.** Verified by an exhaustive (case-insensitive) sweep:

| Site | Role |
|---|---|
| `sync-bundle.ts:219` — `setReportedPullCursor(siteId, manifest.pullCursor)` | **writer**: records the piggybacked lab cursor on push-bundle import |
| `sync-bundle.ts:240` — `const from = await ctx.syncSites.getReportedPullCursor(opts.siteId)` | **reader**: `exportPullBundle` serves the reference window from here (`0` → full snapshot) |
| `sync-site-store.ts:27-28, 76-88` | the port + impl for both |
| `schema/internal.ts:612` | the column type |
| `sync-bundle.test.ts` (9 sites), `sync-site-store.test.ts:56-59` | unit coverage |
| **`settings-sync-routes.test.ts:78-79`** | a **`fakeCtx` mock** implementing both — removing the port methods breaks this suite even though it never uses them. This is the exact stale-mock class that broke a build in S5. |
| **`sync-bundle-live-acceptance.ts:287-289`** | asserts `getReportedPullCursor === manifest.pullCursor` — **the only live proof S5's piggyback works.** It must be migrated, not deleted. |

So the move is: `report()`/`get()` on the new store replace `setReportedPullCursor`/`getReportedPullCursor` on `SyncSitePort`; **both** bundle call sites (`:219` write, `:240` read) migrate; the column, the port methods, and `SyncSiteRow.reportedPullCursor` are dropped together; and the mock plus the bundle harness's assertion move with them.

**The `exportPullBundle` read is the one to get right.** It uses `0 → full snapshot` semantics, so the new store's `get` must return `0` (not `undefined`/`null`) for an unknown site — otherwise a first-ever bundle export for a new lab serves nothing instead of everything. `sync-site-store.ts:82` already does this (`Number(r?.reported_pull_cursor ?? 0)`), and `sync-site-store.test.ts:56` pins it (*"null column reads as 0"*). That test must survive the move.

## 5. Where recording happens, and how it is proven

**In the two routes** — `apps/server/src/sync-routes.ts`: `POST /api/sync/pull` (`:167`) and `POST /api/sync/pull-amendments` (`:186`). Both already have a `sitePrincipal` (→ `siteId`) and a sanitized `fromSeq`.

**Why the route and not `serve*`:** it is a fact about *"a lab asked us for records"* — request-level, not serve-level. `servePull(ctx, fromSeq)` has **no `siteId`** anyway (S2 pull is auth-only, not site-scoped — every lab pulls the same global config), and it is *also* called by `exportPullBundle`, which is central-initiated and reads its `fromSeq` out of the very column we would be writing — a self-referential no-op. `serveAmendments(ctx, siteId, fromSeq)` would work, but splitting the two streams across two layers to buy coverage for one of them is worse than either.

**The cost of that choice, stated plainly:** both pull harnesses (`sync:pull:accept`, `sync:amend:accept`) **bypass the route** — they call `serve*` directly and document that they "do NOT stand up Fastify/JWKS." So the route is exactly where no live harness looks, which is the S7-A/S7-B trap.

**So coverage comes from the one harness that drives the real route:**
- **`sync:e2e`** (`scripts/sync-two-instance-harness.ts`) — real HTTP, real tokens, real Keycloak. Extended to assert that after a pull, `sync_site_cursors` holds `(site, 'sync-pull', fromSeq)`, and likewise for amendments. **This is the shipped path, over the wire.**
- Route unit tests cover the branches (§8).

**Recording is best-effort.** Wrapped, logged, never allowed to fail a pull — mirroring the `recordAudit` precedent. The failure mode is conservative: if it throws, the floor stays stale-low and central trims less.

**Two landmines to respect in those routes:**
- **`return reply.send(...)` — always.** `@fastify/compress` is global; a bare/`void`'d send in an async handler resolves to `undefined` before an async (gzipped, >1KB) send has written, clobbering the body. Lint-enforced by `openldr/require-return-reply-send` (`apps/server` is the only package with real lint).
- **`fromSeq` crosses a trust boundary.** The existing `typeof rawFrom === 'number' && Number.isFinite(rawFrom) ? rawFrom : 0` sanitization stays exactly as is.

## 6. Why push is excluded

The lab sends `fromSeq` on push too, so recording it would be one more line. It is still excluded.

Central cannot compute a push **backlog** from it: that needs the lab's `change_log` head, which central never sees. So a recorded push cursor is a *last-seen marker*, not lag — and **a number that looks like lag but isn't is worse than no number.** Someone reads "12345" on a dashboard and concludes the lab is caught up.

Push also needs no frontier: the lab's `change_log` lives on the *lab* and is trimmed against the lab's own **local** cursors. Central never needs to know.

If #5 wants real push lag, the lab must report its `change_log` head as well — a different design question, and not this slice's.

## 7. Components

| Piece | Package / file |
|---|---|
| `sync_site_cursors` (migration `057`, unprefixed → public schema) + `InternalSchema` type | `packages/db/src/migrations/internal/` + `schema/internal.ts` |
| Drop `sync_sites.reported_pull_cursor` (migration `058`, its own migration — create and drop are independent concerns, and the drop must land with its readers in the cutover commit, not with the additive create) | ditto |
| `createSyncSiteCursorStore(db)` — `report(siteId, consumer, seq)` / `get(siteId, consumer)` (**`0` for unknown**, per §4.2) / `list()` | `packages/db/src/sync-site-cursor-store.ts` **(new)** |
| Remove `get`/`setReportedPullCursor` + `SyncSiteRow.reportedPullCursor` | `packages/db/src/sync-site-store.ts:27-28,76-88`, `schema/internal.ts:612` |
| Record on pull + pull-amendments (best-effort) | `apps/server/src/sync-routes.ts:167,186` |
| Bundle **write** (`:219`) **and read** (`:240`) move to the new store | `packages/bootstrap/src/sync-bundle.ts` |
| Migrate the `fakeCtx` mock (else the suite breaks — S5's stale-mock trap) | `apps/server/src/settings-sync-routes.test.ts:78-79` |
| Migrate `getReportedPullCursor` assertion + the null-reads-as-0 test | `scripts/sync-bundle-live-acceptance.ts:287-289`, `packages/db/src/sync-site-store.test.ts:56-59` |
| Store construction (unconditional — the rows are durable) | `packages/bootstrap/src/index.ts` |
| `sync:e2e` asserts both cursors were recorded over real HTTP | `scripts/sync-two-instance-harness.ts` |

## 8. Testing strategy

**Unit — the store:**
- `report` inserts, then **overwrites with a LOWER seq** (the never-clamp invariant — the single most important test here; it must fail if someone adds a monotonic guard)
- `reported_at` advances on re-report
- one row per (site, consumer); two consumers for one site are independent rows
- `get` returns undefined for an unknown key

**Unit — the routes:**
- a pull records `(site, 'sync-pull', fromSeq)`; pull-amendments records `(site, 'sync-amend-pull', fromSeq)`
- **`fromSeq`, not `nextSeq`**, is what lands (assert the value differs from the response's `nextSeq` so the test can tell them apart)
- **a throwing store does NOT fail the pull** — the response is still 200 with its records
- a non-finite `fromSeq` records `0`, not `NaN` (the trust boundary)
- the site comes from the **token-derived principal**, never the body

**Live — `sync:e2e` (the only harness on the real route):** after the HTTP pull and amendment pull, assert `sync_site_cursors` holds both rows for the enrolled site with the expected seqs. **This must be able to fail:** remove the recording call and confirm `sync:e2e` goes red. A harness that can't fail proves nothing.

**Regression:** all 11 sync acceptance harnesses re-pass. `sync:bundle:accept` matters most — it exercises the `reported_pull_cursor` → `sync_site_cursors` migration of the bundle path, and is the only live proof that S5's piggyback still works.

## 9. Known limitations

- **A dormant lab blocks retention forever.** A site that never pulls has no row (or a very low one), so A3's `MIN()` frontier never advances and nothing is trimmable. This is a **liveness** problem, not a safety one — it costs disk. A3 should surface it ("site X is blocking retention since <date>") rather than work around it. `reported_at` is what makes that possible, and is a reason this slice records it now.
- **A revoked site's row persists.** `sync_sites.status = 'revoked'` exists; A3 must decide whether revoked sites are excluded from the frontier. Not this slice's call — but if A3 includes them, a revoked lab blocks retention forever.
- **A lab can lie.** `fromSeq` crosses a trust boundary. Over-reporting is self-inflicted (it only lowers protection for that lab's own records — A3's frontier is a `MIN`, so an over-reporting lab can only remove *itself* as the constraint). Under-reporting is a mild retention DoS. Neither is worth defending against beyond the existing finite-number sanitization.
- **A1 records; nothing reads it yet.** Between A1 and A3/#5 the table is write-only. That is deliberate: the point is to accumulate real frontier data and let an operator watch it before anything deletes against it.
- **The route is unit-tested plus `sync:e2e` only.** `sync:pull:accept` and `sync:amend:accept` bypass Fastify by design, so they cannot cover this. If `sync:e2e`'s Keycloak dependency makes it skip in some environment, this slice's live coverage silently disappears — the harness must fail loudly rather than skip.
