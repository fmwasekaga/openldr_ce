# Distributed Sync S7 — Catch-Up Drain + Push Wakeup (design)

**Date:** 2026-07-16
**Status:** Approved (brainstorm) → ready for implementation plan
**Workstream:** distributed-sync. S1–S5, S6a/S6c/S6b co-edit set, S7-A quarantine, S7-B gzip, S7 divergence detection all DONE + pushed. This is the rest of the transport-efficiency theme S7-B started with gzip.
**Backlog item:** "LISTEN/NOTIFY wakeup + large-batch resumability/backpressure" — the top remaining S7 item.

---

## 1. Summary

Both sync directions drain **one ≤500-record batch per tick**, on a **15-minute** default interval. That is ~2,000 records/hour. A first enrollment or a multi-day outage leaving 100k records queued takes **~50 hours to drain**, and no wakeup fixes that — a notification makes a drain *start* sooner, not *finish*.

This slice makes a tick drain until it is caught up, bounded by a time budget, and gives the push side a LISTEN wakeup so a new result doesn't wait up to 15 minutes.

**Two things the backlog line asked for that this spec deliberately does NOT build:**

- **Resumability — already solved.** `runCycle()` advances its cursor only on success; a failure leaves it put so the same window retries ([`push-worker.ts:158-161`](../../../packages/sync/src/push-worker.ts), [`pull-worker.ts:129-130`](../../../packages/sync/src/pull-worker.ts)). A drain loop that dies at cycle 10 of 200 has cycles 1-10 durably committed and resumes at 11. The cursor **is** the resumability mechanism. Nothing to build.
- **Central-signalled backpressure — YAGNI.** A per-tick time budget makes the lab self-limiting, which is sufficient for a handful of labs on slow links. Central telling labs to slow down (429 + honoring `Retry-After`) is a different design and has no evidence of need. Revisit if a real deployment shows central as the bottleneck.

## 2. The numbers (measured from the code, not estimated)

| Fact | Source |
|---|---|
| Default interval **15 min**, clamped [1, 1440] | `packages/sync/src/config.ts:110-111` |
| Push drains `batchSize ?? 500` per cycle, **one cycle per tick** | `packages/sync/src/push-worker.ts:81`, host loop `sync-push-worker.ts:47` |
| Pull/amendment serve window `BATCH = 500` | `packages/bootstrap/src/sync-serve.ts:20` |
| Push host loop has **no** LISTEN wakeup — explicitly noted in-code | `packages/bootstrap/src/sync-push-worker.ts:6` |
| The LISTEN pattern **already exists** and is proven (projection worker) | `packages/bootstrap/src/projection-worker.ts:34-37`, wired `index.ts:704-711` |

**500 × (1 tick / 15 min) = 2,000 records/hour.** That is the bug.

## 3. Scope

**In:** a bounded catch-up drain on **both** directions; a LISTEN wakeup on **push**; a discriminated `runCycle` result to drive the loop.

**Out, deliberately:**
- **Pull wakeup.** The lab polls central over HTTPS; it cannot LISTEN to central's Postgres. Waking pull needs a transport mechanism (long-poll/SSE/websocket) — a different design, and a doubtful one on the intermittent NAT'd links that made this transport lab-initiated (north-star decision 2).
- **Terminology in-memory bulk.** `createTerminologyBulkSync` drains every page of a code system into memory before reconciling. That is a **memory** bound, not a cadence bound; a drain loop cannot fix it. Already logged as its own S7 follow-up ("large-terminology in-memory multi-copy; chunk in S7"). Mixing it in would make this slice incoherent.
- **Resumability, central-signalled backpressure** — see §1.

## 4. Core decisions (from brainstorm)

1. **One slice, both directions.** The two host workers are near-identical siblings; fixing one leaves an identical defect in the file next to it. Pull has real backlog cases (first enrollment, post-outage amendment queues).
2. **Bound the drain with a time budget**, not a record/cycle count. It is the only bound stable across wildly different record sizes and link speeds — 10k tiny observations and 200 fat DiagnosticReports must behave sanely under one setting. A slow link simply gets fewer batches per tick, with nothing to retune per site.
3. **`runCycle` returns a discriminated result**, not a bare count. See §5 — the counter's meaning already drifted once this month.
4. **Budget is derived from the interval (half), not a new config key.** Zero config surface, self-consistent by construction, and the operator already has a working dial. Promotable to an explicit key later without changing behavior for anyone who never set it.
5. **Extract a shared drain worker** rather than duplicating the loop into two siblings. See §7.

## 5. Why the result must be discriminated (decision 3)

`runCycle(): Promise<number>` returns `0` for **three different things**:

| Situation | Line | Cursor advanced? | Returns |
|---|---|---|---|
| Nothing left to push — genuinely drained | `push-worker.ts:131` | yes (past confirmed gaps) | `0` |
| Transport/token failure | `push-worker.ts:143` | **no** — window retries | `0` |
| Full batch, every record rejected by central | `push-worker.ts:165` | **yes** — skipped permanently | `0` (`resp.applied`) |

So `while ((await runCycle()) > 0)` is wrong in both directions: it **stops early** on a wholly-rejected batch (cursor advanced, thousands still queued, loop thinks it's done) and cannot distinguish "drained" from "central is down."

**The decisive argument is drift, not just correctness.** `applied`'s meaning changed *this month*: the divergence slice deliberately excluded `'diverged'` from it. So a lab with a backlog of colliding versions would push 500, have them all diverge, get `applied: 0`, and stop draining. `applied` is a **reporting** value; using a reporting value as a **control** signal is what makes it fragile. The runner already knows which of the three cases it hit at each `return` — it should say so.

```ts
export type CycleOutcome = 'drained' | 'progressed' | 'failed';
export interface CycleResult { outcome: CycleOutcome; applied: number; }
```

Changing `Promise<number>` → an object is **compiler-enforced at every call site** — unlike the `ApplyResult` union widening, which silently slipped past two of three callers (see the divergence spec §5.4).

### 5.1 Outcome mapping

| Runner | Situation | Outcome |
|---|---|---|
| push | `records.length === 0` **and `newCursor === cursor`** (a pure-gap cycle) | `drained` |
| push | `records.length === 0` **but `newCursor > cursor`** — every row skipped by a defensive guard, yet the cursor moved | **`progressed`** — see §5.1.1 |
| push | transport/token catch (`:143`) | `failed` |
| push | posted OK **and the cursor advanced** | `progressed` |
| push | posted OK but **`min(ackSeq, newCursor) <= cursor`** | **`failed`** — see §5.1.1 |
| pull | `resp.records.length === 0` (`:66`) | `drained` |
| pull | transport/token catch (`:63`) | `failed` |
| pull | **`held === true`** (`:129`) | **`failed`** |
| pull | window processed but **`max(safeSeq, nextSeq) <= cursor`** | **`failed`** — see §5.1.1 |
| pull | window processed **and the cursor advanced** | `progressed` |
| amend | transport/token catch (`amend-pull-worker.ts:39`) | `failed` |
| amend | `resp.records.length === 0` (`:41`) | `drained` |
| amend | window processed but **`max(safeSeq, nextSeq) <= cursor`** | **`failed`** — see §5.1.1 |
| amend | window processed **and the cursor advanced** (`:71`) | `progressed` — **including when `applied === 0`** (see below) |

### 5.1.1 `progressed` ⟺ the cursor ADVANCED — in **both** directions

**The rule is an equivalence, not an implication.** `progressed` iff the cursor moved. Two distinct bugs come from getting either half wrong, and this spec shipped both before the whole-slice review caught the second:

- **Cursor did NOT move, but we say `progressed`** → the loop refetches the identical window and spins for the whole budget (§ below).
- **Cursor DID move, but we say `drained`** → the loop **stops while there is still work**, silently reverting to the pre-S7 one-batch-per-tick rate.

**The second is not hypothetical, and it lands on this spec's own headline scenario.** Push's empty-window branch advances the cursor past rows that every defensive guard skipped (null `site_id`, missing meta) and originally reported `drained`. Consider a lab that bulk-imports 60k records *before* `sync.site_id` is set — the **first enrollment** case §1 opens with. Every cycle fetches 500 rows, skips all 500, advances the cursor 500, and reports `drained`, stopping the drain. **60k ÷ 500 × 15 min ≈ 30 hours** before the cursor even reaches the healthy records. The exact bug this slice exists to kill, intact inside it.

`progressed` is provably safe there: the cursor *moved*, so the next cycle reads a new cursor and collects a **new** window. It cannot hammer. A pure-gap cycle (`newCursor === cursor`) stays `drained` and is unaffected.

**Why the per-task reviews all passed it:** the §5.1 table originally mapped `records.length === 0 → drained` flatly, and this section was added mid-slice to correct the *rule* — without revisiting the table row it had just invalidated. Every task did exactly what its row said. Only a cross-task read surfaces a spec that contradicts itself.

**This corrects an unsound rule in the first draft of this spec.** The original table mapped "window processed" straight to `progressed`, which silently covered the case where the cursor does **not** move. That is the difference between a patient retry and a hammer:

`progressed` sends the drain loop back to re-read the cursor and re-collect. If the cursor did not move, it refetches the **identical window**, gets the identical result, and repeats — for the entire budget, **every tick, forever**. Pre-S7 the loop exited after one cycle, so the same peer misbehaviour cost one wasted round-trip per 15 minutes. The drain **amplifies it to ~225 per tick**. The budget bounds the damage per tick; it does not stop it recurring.

**It is reachable, and was already pinned by a test before this slice began.** `pull-worker.test.ts` has a pre-existing case — *"does not advance the cursor backward when nextSeq <= cursor (defensive)"*, `readCursor: 10`, response `nextSeq: 7` — proving a **non-held, fully-processed** window can leave the cursor unmoved. `safeSeq = rec.seq` is a direct assignment, **not** a monotonic max, so a window served at/behind the cursor drives `safeSeq` *backward*.

**`failed` breaks no legitimate case.** On push, `records.length > 0` guarantees every sent seq `> cursor`, so `newCursor > cursor` always — `target <= cursor` ⟺ `ackSeq <= cursor`, i.e. a central acking at or behind where we already were. On pull, a window whose records **all** failed-and-quarantined still advances (`safeSeq = rec.seq` runs on the quarantine path too — a quarantined record is *handled*), so `!advanced` is unreachable except under an anomalous peer: a stale/cached 200, a proxy replay, a buggy reimplementation, or a hostile one. That is this codebase's declared threat model — `push-worker.ts`'s clamp comment exists solely to defend "a buggy/hostile ackSeq" and calls central "a separate trust domain."

**The fix is strictly better than pre-S7, not damage control.** Today such a peer wedges the cursor **permanently and silently**. Reporting `failed` (with an `error` log naming the cursor, the ack, and the count) makes it visible, retried on the next tick, and operator-diagnosable — closing an observability hole the code has never had.

Each runner keeps the guard **inline** rather than sharing a helper. The kernel is ~3 lines, but push clamps **down** (`Math.min(ackSeq, newCursor)` — a trust boundary) while pull/amend clamp **up** (`Math.max(safeSeq, nextSeq)`), the log payloads differ, and push returns *before* advancing while pull/amend persist partial progress *first*. A shared helper would obscure the down-vs-up distinction, which is the most important thing about it.

**The amend runner is the live proof that `applied` cannot be the control signal.** It excludes diverged records from `applied` (`:49-50`) but advances the cursor regardless (`:70`). So a window in which *every* record diverges returns `applied: 0` while having genuinely progressed — `while (runCycle() > 0)` would stop there with thousands still queued. This is not a hypothetical drift risk; it is in the file today, shipped hours ago. Any `progressed` mapping must key off the fact that the window was processed, **never** off the count.

**`held → failed` is load-bearing.** When a bulk terminology record fails below the quarantine threshold, `held = true` caps the cursor *before* that record so the whole window retries next cycle (`pull-worker.ts:96-105`). Treating that as `progressed` would re-fetch the same window and re-fail the same record in a tight loop for the whole budget. This is the single most important line in the mapping.

**A successful cycle is always `progressed`, never "probably drained."** The loop then does one extra cycle that returns `drained`. For **push** that costs a **DB read with no network call** — the `records.length === 0` branch returns *before* `postPush`. For **pull** it costs one small HTTP request. Both are cheaper than inferring "drained" from a short batch: `collectPushRecords` defensively skips rows, so `records.length < batchSize` does not reliably mean an empty source.

### 5.2 The composite rule

Bootstrap builds the pull host's runner as `ref.runCycle()` then `amend.runCycle()`, summed (`index.ts` pull gate). With two results it must combine:

> **`progressed` if either progressed; else `failed` if either failed; else `drained`.**

A healthy reference stream keeps draining while a failing amendment stream logs each attempt — bounded by the budget. The alternative (either-failed ⇒ stop) would let one sick stream freeze a healthy one, which is precisely the wedge behavior S7-A spent a slice removing.

## 6. The drain loop

Lives in the **shared drain worker** (§7) — *not* duplicated into each host worker. It keeps the no-overlap guard and error swallow that `sync-push-worker.ts`/`sync-pull-worker.ts` already have today; the budget is resolved once at construction (`budgetMs = opts.drainBudgetMs ?? Math.floor(opts.intervalMs / 2)`):

```ts
async function tickOnce(): Promise<void> {
  if (running) return;            // existing: never overlap cycles
  running = true;
  const deadline = Date.now() + budgetMs;
  try {
    for (;;) {
      const { outcome } = await opts.runner.runCycle();
      if (outcome !== 'progressed') break;   // drained → done; failed → don't hammer
      if (stopped) break;                    // shutdown stays responsive mid-drain
      if (Date.now() >= deadline) {
        opts.logger.info({ label: opts.label }, 'sync: drain budget exhausted; resuming next tick');
        break;
      }
    }
  } catch (err) {
    opts.logger.error({ err, label: opts.label }, 'sync cycle failed');   // existing behavior
  } finally {
    running = false;
  }
}
```

**`drainBudgetMs = Math.floor(intervalMs / 2)`** (decision 4). At the 15-min default that is a 7.5-min budget: at a conservative 2s/round-trip, ~225 cycles ≈ **112k records in one tick**, against 500 today. Even at a 1-minute interval it is 15× today's throughput.

**The `stopped` check between cycles is not optional.** Without it, `stop()` during a long drain is not observed until the drain finishes — hanging shutdown for minutes.

## 7. Shared drain worker (decision 5)

`sync-push-worker.ts` and `sync-pull-worker.ts` are already near-identical (~60 lines each, differing in log strings). Adding the loop to both would duplicate the subtle part — deadline arithmetic, the stop check, the outcome branch — in two places.

Extract `createDrainWorker(opts)` in `packages/bootstrap/src/drain-worker.ts`; both host workers become thin wrappers preserving their existing public shape (`start`/`stop`/`trigger`/`isRunning`).

```ts
export interface DrainWorkerDeps {
  runner: { runCycle(): Promise<CycleResult> };
  intervalMs: number;
  /** Defaults to floor(intervalMs / 2). Injectable so tests don't sleep. */
  drainBudgetMs?: number;
  /** Push only. Absent → interval-only, exactly as today. */
  listenClient?: { query(sql: string): Promise<unknown>; on(ev: 'notification', cb: () => void): void };
  listenChannel?: string;
  label: string;   // 'sync push' | 'sync pull' — log disambiguation
  logger: Logger;
}
```

**Rationale:** the one real defect of the divergence slice was `amend-pull-worker` being the sibling that got missed while its two cousins were fixed. Two copies of timing logic is how that recurs. The cost is refactoring working code — accepted, because it is the same ~60 lines this slice edits anyway.

## 8. Push wakeup

Mirror `projection-worker.ts:34-37` exactly: optional `listenClient`, `listen fhir_changes`, `.on('notification', () => tickOnce())`. Bootstrap creates and connects it in a try/catch, as `index.ts:704-711` does for projection — **interval polling remains the correctness-bearing path**, so a pooled/serverless PG that cannot hold a LISTEN connection degrades to today's behavior instead of failing boot.

A notification arriving mid-drain is absorbed by the existing no-overlap guard; the in-flight drain picks the change up anyway.

**Documented, not fixed — the amendment echo.** `fhir_changes` fires from both `save()` and `applyRemote()`. On a lab, applying central's amendment writes a `change_log` row stamped with the lab's own `site_id`, so the lab's push worker picks it up and pushes it back to central, where `applyRemote` skips it (same version, hashes match). This echo happens **today** on the 15-minute tick; the wakeup only makes it prompt. It costs one round-trip per amendment. Pre-existing, harmless, out of scope — but it will be visible in logs.

## 9. Components

| Piece | Package / file |
|---|---|
| `CycleOutcome` / `CycleResult` + `combineCycleResults` | `packages/sync/src/cycle-result.ts` **(new)** — *not* `batch.ts`: that file is exclusively **wire** types (11 `export interface`, no functions, all shapes that cross the network). `CycleResult` is an internal control signal that never goes on the wire, and `combineCycleResults` is a function. Same package, same barrel. |
| Push runner returns `CycleResult` | `packages/sync/src/push-worker.ts` |
| Pull runner returns `CycleResult` (incl. `held → failed`) | `packages/sync/src/pull-worker.ts` |
| Amendment runner returns `CycleResult` | `packages/sync/src/amend-pull-worker.ts` |
| `createDrainWorker` (loop + budget + optional LISTEN) | `packages/bootstrap/src/drain-worker.ts` **(new)** |
| Host workers become thin wrappers | `packages/bootstrap/src/sync-push-worker.ts`, `sync-pull-worker.ts` |
| Composite pull runner: combine two results per §5.2; push LISTEN client | `packages/bootstrap/src/index.ts` |
| Acceptance `pnpm sync:drain:accept` | `scripts/sync-drain-live-acceptance.ts` **(new)** |

## 10. Testing strategy

**Unit — the drain worker carries the weight:**
- `progressed` loops; `drained` stops; `failed` stops
- budget exhausted → stops **and logs** (inject `drainBudgetMs`; never sleep in a test)
- a runner stubbed to *always* return `progressed` **exits on the deadline** rather than spinning forever
- `stop()` mid-drain is observed between cycles
- the existing no-overlap guard still holds (a `trigger()` during an in-flight drain is skipped)
- LISTEN notification → `tickOnce`; absent `listenClient` → interval-only, byte-identical to today

**Unit — result mapping**, one test per row of §5.1. **`held → failed`** especially: a stubbed hold must NOT loop.

**Unit — the composite rule** (§5.2), all nine combinations of two outcomes, or at least: progressed+failed → progressed; failed+drained → failed; drained+drained → drained.

**`scripts/sync-drain-live-acceptance.ts` + `pnpm sync:drain:accept` — the real proof, and it must be falsifiable:**
1. Seed **1,200** records on a real lab DB (>2× the 500 batch ceiling).
2. Run **one tick**.
3. Assert **all 1,200** reached central.

Today that is structurally impossible — 500 is the per-tick ceiling. **Then revert the drain loop and confirm the harness fails with 500 of 1,200 arrived.** A harness that cannot fail proves nothing (the S7-B lesson: a test that built its own Fastify was green while the shipped app was broken).

**Regression:** all 8 existing sync acceptance harnesses must re-pass — `sync:accept`, `sync:amend:accept`, `sync:order-status:accept`, `sync:patient-merge:accept`, `sync:quarantine:accept`, `sync:bundle:accept`, `sync:terminology:accept`, `sync:divergence:accept`. `sync:amend:accept` asserts an exact `applied === 2` and will need updating for the new return shape — **update the assertion, never weaken the harness**.

## 11. Known limitations

- **No pull wakeup** (§3) — pull latency stays at the interval. Structural: no LISTEN across HTTP.
- **The budget is derived, not tunable** (decision 4). A site needing an independent knob requires promoting it to a config key + the UI/CLI/i18n tail.
- **The amendment echo** (§8) costs one round-trip per amendment, now prompt rather than delayed. Pre-existing.
- **Terminology in-memory bulk is untouched** (§3) — a single large code system still materializes fully in memory. Its own slice.
- **A wholly-`failed` first cycle ends the tick.** Correct (don't hammer a down central), but it means a link that fails on cycle 1 makes no progress that tick even if the failure was transient. The interval retry is the recovery path, exactly as today.
- **A failing stream is now retried ~225×/tick instead of 1×.** Per §5.2, `progressed + failed → progressed`, so if central's `/api/sync/pull-amendments` is down while `/api/sync/pull` has a backlog, the drain keeps looping and re-hits the broken endpoint every cycle for the whole budget. Deliberate — the alternative (either-failed ⇒ stop) lets one sick stream freeze a healthy one, the wedge S7-A spent a slice removing — and it is budget-bounded. But it is a real log-spam and load amplification against a peer that is already unwell.
- **Neither LISTEN client registers an `error` handler.** A long-lived `pg.Client` emits `'error'` on connection drop, and an unhandled `'error'` on an EventEmitter throws — so a PG restart could take the process down. This slice's push client mirrors the pre-existing projection client (`index.ts:704`), so the exposure is doubled rather than introduced. `packages/bootstrap/src/listener-postgres.ts` already has the right pattern (handler + reconnect); adopting it for both is a follow-up.
