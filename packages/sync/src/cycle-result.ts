// Distributed sync S7: what one runner cycle reports to its host loop.
//
// This is a CONTROL signal, deliberately separate from the wire types in batch.ts — it never crosses
// the network. It exists because `runCycle(): Promise<number>` returned 0 for THREE different
// situations (genuinely drained / transport failed / everything rejected-or-diverged), so a drain
// loop could not tell "caught up" from "central is down", and would stop early on a batch whose
// records all diverged.
//
// The counter is a REPORTING value and its meaning has already drifted once (the divergence slice
// excluded 'diverged' from `applied`). Control must not key off it. Runners report `progressed`
// because the WINDOW was processed — never because a count was non-zero.
export type CycleOutcome =
  /** Nothing left to move. The host loop stops draining this tick. */
  | 'drained'
  /** A window was processed and the cursor advanced. There may be more — go again. */
  | 'progressed'
  /** Transport/token failure, or a bulk hold that would re-fail immediately. Stop; retry next tick. */
  | 'failed';

export interface CycleResult {
  outcome: CycleOutcome;
  /** Records the peer durably applied. REPORTING ONLY — never branch the drain loop on this. */
  applied: number;
}

/**
 * Combine two stream results into one for a host loop that drains both (the pull host runs the
 * reference stream then the amendment stream).
 *
 * `progressed` wins so a healthy stream keeps draining while a sick one merely logs; `failed` beats
 * `drained` so one sick stream never reads as "caught up". Letting either-failed stop the loop would
 * let one stream freeze the other — the wedge behaviour S7-A spent a slice removing.
 */
export function combineCycleResults(a: CycleResult, b: CycleResult): CycleResult {
  const applied = a.applied + b.applied;
  if (a.outcome === 'progressed' || b.outcome === 'progressed') return { outcome: 'progressed', applied };
  if (a.outcome === 'failed' || b.outcome === 'failed') return { outcome: 'failed', applied };
  return { outcome: 'drained', applied };
}
