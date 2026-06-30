# Workflow Run History — Master-Detail Redesign (Slice 4b) — Design

**Date:** 2026-06-30
**Status:** Approved (brainstorm) — ready for implementation planning
**Depends on:** Slice 4 (per-node inspector) — merged to local `main` (`514887b`). This supersedes Slice 4's inline-expand detail.
**Topic:** Redesign the Run History detail into a discoverable master-detail view (node table + selected-node data), with run-time-recorded node labels.

---

## 1. Problem

Slice 4 made Run History node rows click-to-expand to show output/meta. In practice (observed on the live UI):
- **Not discoverable** — nothing signals a row is expandable; users don't know to click.
- **Nodes aren't identifiable** — the table shows only the synthetic `nodeId` (`sql-1`, `log-1`). In a packed workflow you can't tell which node is which.
- **Wrong primary data** — the prominent block was the global **Logs**, but logs are emitted only by **Log** and **Code** nodes ([log.ts:16](packages/workflows/src/engine/node-handlers/log.ts:16), [code.ts:44](packages/workflows/src/engine/node-handlers/code.ts:44)) — sparse and incidental. The data users want per node is its **output**, which was hidden behind the non-obvious expand.

### Established facts (verified)

- The recorded `NodeRunResult` carries `{ nodeId, type, status, output, meta, logs, durationMs, error? }` ([run-workflow.ts:161](packages/workflows/src/engine/run-workflow.ts:161), [api.ts:966](apps/web/src/api.ts:966)) — but **no node label**. The human label lives in the workflow definition (`node.data.label`), not the run record.
- Logs originate only from Log + Code node handlers; no other node writes `ctx.logs`.
- A reusable `JsonView` exists at `apps/web/src/workflows/components/panels/json-view.tsx` (from Slice 4).
- **Edge-to-edge divider rule** (project convention): rules/tab-headers/table borders on `p-4` panes must bleed to the pane edges via `@/components/ui/bleed` (`Divider`/`Bleed`).

---

## 2. Approved decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Detail layout | **Master-detail** — node table on top, the selected node's data in a detail pane below. Replaces inline-expand. |
| 2 | Node identification | Show the node **label** (with the `nodeId` muted beside it; fall back to id when no label). |
| 3 | Label sourcing | **Record `label` at run time** in `NodeRunResult` (run record self-describes the run as it happened). Not a join to the current definition. |
| 4 | Detail pane | Tabs **Output / Result (meta) / Logs** for the selected node. Output also carries that node's produced-file downloads. Logs is per-node (not a global block). |
| 5 | Default selection | First **failed** node if any, else the first node (detail pane is never empty; lands on the most useful node). |
| 6 | Dividers | **Edge-to-edge** (`@/components/ui/bleed`) for the table header rule, the table↔detail separator, and the tab-header underline. |

---

## 3. Components & changes

### 3.1 Engine — record the label
`packages/workflows/src/engine/run-workflow.ts`: add `label: node.data.label as string | undefined` to the `results.push({ … })` object on **both** the success path (~line 161) and the error path (~line 191).

### 3.2 API type
`apps/web/src/api.ts`: add `label?: string;` to the `NodeRunResult` interface.

### 3.3 Web — `RunDetail` rewrite (`run-history-drawer.tsx`)
Replace the current inline-expand Nodes table + global Logs/Produced-files blocks with:
- **Node table** (shadcn `Table`): columns **Node** (label + muted `nodeId`; id-only when no label), **Type**, **Status** (existing colored pill), **Duration**. Rows clickable; selected row highlighted. `Table` header border bleeds edge-to-edge.
- **Selected-node detail pane** below an edge-to-edge separator:
  - A small tab strip **Output / Result / Logs** (edge-to-edge underline).
  - **Output**: `JsonView(selected.output)` (empty label "No output recorded") + download buttons for any binaries in `outputBinaries(selected.output)`.
  - **Result**: `JsonView(selected.meta)` (empty label "No result data") — only meaningful when meta is present.
  - **Logs**: the selected node's `logs` rendered like the current logs view, scoped to the node (empty label "No logs").
  - Tab bodies are scrollable, max-height.
- **Selection state**: `selectedNodeId` (local `useState`), defaulting via §2 decision 5; reset on drawer open / workflow change (consistent with the existing reset effect). The active tab is also local state, default **Output**.
- Remove the old global Logs block and global Produced-files block.
- Keep the run **list**, pagination, `openRun`, and the run header (status/source/time, with the `event` badge) unchanged.

---

## 4. Data flow

`openRun(run)` → `fetchWorkflowRun(run.id)` → `selected.result.results[]` (each now has `label`) → node table renders → click a row sets `selectedNodeId` → the detail pane reads that node's `output`/`meta`/`logs` and renders the active tab. No new fetch or endpoint.

---

## 5. Error handling

- A failed node is auto-selected (decision 5); its error stays visible (row status pill + the run-header error block). Tabs show whatever was recorded; absent output/meta render the empty-label state.
- Large outputs sit in scrollable, max-height tab bodies (no truncation logic).
- A node with no `label` shows its `nodeId` as the name (graceful for older runs recorded before this change).

---

## 6. Testing

- **Engine (`packages/workflows`):** a workflow run's `NodeRunResult[]` includes each node's `label` (e.g. a node with `data.label: 'My Node'` records `label: 'My Node'`).
- **Web (`apps/web`, isolated):** the node table shows the **label** (not just id); clicking a node selects it and the Output tab shows its `output` JSON; switching to the **Logs** tab shows that node's logs; the **Result** tab shows `meta`; a run with a failed node auto-selects it. Mock `../node-forms/code-editor` as a textarea (Slice-4 pattern).
- Update the existing `run-history-drawer.test.tsx` (Slice 4) to the new master-detail interactions (the old expand-row assertions no longer apply).

---

## 7. Out of scope (YAGNI)

- Per-node **input** recording (still derivable from upstream output).
- Run diffing, search, or filtering the node table.
- Changes to the run list / pagination / how runs are fetched.
- Backfilling `label` for runs recorded before this change (they gracefully show `nodeId`).
