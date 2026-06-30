# Workflow Run History — Per-Node Inspector (Slice 4) — Design

**Date:** 2026-06-30
**Status:** Approved (brainstorm) — ready for implementation planning
**Depends on:** Slices 1–3 (the ingestion loop) — merged to local `main`. Motivated by event-triggered runs, which execute server-side with no live stream and so can't be troubleshot per-node today.
**Topic:** Make the Run History detail show each node's recorded output + meta + logs, so historical/event-triggered runs are troubleshootable node-by-node.

---

## 1. Problem

A manual ("Run" button) execution streams `node:success` events, so the builder animates the canvas and each node's Input/Output/meta panel populates live. **Event-triggered (and any historical) runs have no live stream** — they only appear in Run History. The Run History detail ([run-history-drawer.tsx](apps/web/src/workflows/components/panels/run-history-drawer.tsx) `RunDetail`) currently shows: a Nodes table (id, type, status, duration), produced files, and a global logs block — but **not** each node's output or meta data. So a user can see *that* an event-triggered run happened and its per-node status, but not *what data* each node produced.

### Established facts (verified)

- The recorded per-node result already carries the data we need. `runWorkflow` pushes `{ nodeId, type, status, output, meta, durationMs, logs, error? }` per node ([run-workflow.ts:161-169](packages/workflows/src/engine/run-workflow.ts:161)), and the API type `NodeRunResult` ([api.ts:966](apps/web/src/api.ts:966)) includes `output?`, `meta?`, `logs?`. So **output + meta + logs are already in the run record** — the drawer just doesn't display output/meta.
- Per-node **`input` is NOT recorded** (only streamed live). Showing it would need an engine change + ~2× run-record storage. **Decision: out of scope** — a node's input equals its upstream node's output (and the trigger node's output is the event payload), so output-per-node already traces the whole flow.
- A reusable `JsonView` component already renders JSON (used by the live node Output tab).
- `SOURCE_VARIANT` in the drawer (line 26) maps badge colors for `manual/schedule/webhook/ingest` but **not `event`** — Slice 2 added the `event` trigger source without updating this map, so event runs render an uncolored badge.

---

## 2. Approved decision

| # | Decision | Choice |
|---|----------|--------|
| 1 | What to show per node | **Output + meta + logs** (already recorded). |
| 2 | Per-node `input` | **Out** — derivable from upstream output; avoids an engine change + storage bloat. |
| 3 | Surface | **Web-only**, additive to the existing `RunDetail` — no engine/API change. |
| 4 | Presentation | Expandable node rows (keep the existing global logs block as-is; *add* per-node Output/Meta on expand — low-risk, not a logs restructure). |

---

## 3. Components & changes

All in `apps/web/src/workflows/components/panels/run-history-drawer.tsx`:

- **`SOURCE_VARIANT`** (line 26): add an `event` entry (a distinct color, e.g. `'border-fuchsia-500/40 text-fuchsia-300'`) so event-triggered runs get a colored badge.
- **`RunDetail`**: make each node row in the Nodes table a toggle (track an expanded node id in component state). When a row is expanded, render a sub-panel beneath it containing:
  - **Output** — `JsonView` of `r.output` (scrollable, max-height container).
  - **Meta** — `JsonView` of `r.meta`, shown only when `r.meta` is present.
  - **Logs** — that node's `r.logs` lines (if any), rendered like the existing logs block but scoped to the node.
  - Reuse the existing `JsonView` component (import from wherever the live Output tab imports it); pass an `emptyLabel` so a node with no output/meta renders cleanly.
- Keep the run list, pagination, produced-files, and the existing global logs block unchanged.

---

## 4. Data flow

`openRun(run)` → `fetchWorkflowRun(run.id)` (already implemented) → `selected.result.results[]` (each entry already has `output`/`meta`/`logs`) → `RunDetail` renders the Nodes table → expanding a row reads that entry's `output`/`meta`/`logs` and renders them via `JsonView`/the logs view. No new fetch, no new endpoint.

---

## 5. Error handling

- A node with `status: 'error'` already shows its message in the table. On expand, `output`/`meta` may be absent (the engine doesn't record them for the errored node) — `JsonView`'s `emptyLabel` handles that.
- Large outputs sit in a scrollable, max-height container (no truncation logic needed).
- Expansion state is local component state; collapsing/reopening the drawer resets it (consistent with the existing reset-on-open effect).

---

## 6. Testing

- **Web component test (run isolated — `pnpm -C apps/web test`):** mock `fetchWorkflowRun` to return a run whose `result.results` includes a node with a concrete `output` (e.g. `[{ json: { batchId: 'b1' } }]`) and `meta` (e.g. `{ persisted: 1 }`); render the drawer (or `RunDetail`), open/expand the node row, and assert the output and meta values appear. Assert an `event`-sourced run renders its badge.
- Keep existing run-history / `page.test.tsx` tests green (the change is additive).

---

## 7. Out of scope (YAGNI)

- Recording or showing per-node **input** (decided).
- Any engine/API/storage change (the data is already recorded).
- Restructuring the global logs block, output truncation/virtualization, or diffing between runs.
