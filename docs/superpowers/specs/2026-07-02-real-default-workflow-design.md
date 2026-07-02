# Real Default Workflow — Design

**Date:** 2026-07-02
**Status:** Approved (brainstorm → spec)
**Relates to:** `workflow-ingestion-loop-workstream`, `workflow-builder-workstream`, `workflow-node-palette`, `real-default-workflow-idea`

## Problem

A fresh install seeds a throwaway **"Sample Workflow"** (`packages/workflows/src/sample-workflow.ts`,
id `wf-sample`) whose only purpose is to keep the Workflows list non-empty. It showcases nodes
(trigger/set/http/if/log/wait/code/loop/merge/filter) but does nothing useful and teaches nothing
about how OpenLDR actually ingests data.

Replace it with a **real, useful default**: an honest form-validated ingestion loop built entirely
from nodes that exist today — an inbound webhook that validates and persists lab orders, plus a
reactive companion that demonstrates the `data.persisted` event loop.

## Goals

- Replace the seeded sample with a runnable, honest ingestion loop using only existing nodes.
- Bind to the already-seeded **"Lab order"** form (`ServiceRequest`) so it works out of the box.
- Be **safe by default**: no live, publicly-known-secret endpoint on every fresh install.
- Demonstrate the full inbound → `data.persisted` → reactive loop (mirrors the proven demo seed).
- Start a **new** builder workflow from a clean single-trigger canvas (not the old showcase graph).

## Non-Goals (deferred)

- **Per-sender identity / row-level ownership / CRUD-by-HTTP-verb.** The webhook trigger is
  POST-only and secret-authed (the secret identifies the *webhook*, not the *caller*); there is no
  sender identity, no owner column on persisted rows, and no ownership-enforcing update/delete node.
  A true multi-tenant vendor API ("a vendor can only touch their own rows, can't delete others'")
  is its own future workstream, not this spec.
- **Docs update** (`apps/studio/src/docs/**/workflows.md`) — optional follow-up; carries i18n
  (en/fr/pt) parity obligations, so it is out of scope here.

## Engine constraints that shape the design (verified in code @ `7f005349`)

1. **Webhook is POST-only, secret-authed, no sender identity.** `app.post('/api/workflows/hooks/*')`
   resolves a path → `{workflowId, secret}` and checks `X-Webhook-Token` (constant-time). The
   Method dropdown in the node form is cosmetic. (`webhook-registry.ts`, `workflows-routes.ts:388`)
2. **The webhook delivers an envelope, not the answers.** The run input is
   `{ method, body, headers (auth-stripped), query }`; downstream `$json` is that envelope. Form
   Validate treats `item.json` *as* the answers → the graph needs an **unwrap** step between them.
   (`workflows-routes.ts:411`, `engine/node-handlers/trigger.ts`)
3. **Form Validate is filter+transform, not a branch.** Valid items → extracted FHIR resource
   items (`ObservationExtractor` + `ServiceRequestExtractor`); invalid items are **dropped** and
   recorded in `meta.invalid`. There is no true/false output handle. (`bootstrap/src/form-validate-service.ts`)
4. **Seeded forms get fresh random ids** (`forms.create()` ignores the sample's id), so a workflow's
   `config.formId` must be **injected at seed time**, not hardcoded. (`bootstrap/src/seed.ts:83-112`)
5. **Disabled workflows never fire.** The registry registers a disabled workflow's webhook path,
   but the trigger-runner refuses to execute a disabled workflow (`if (!wf || !wf.enabled) return`).
   → Seeding **disabled** + a **per-install random secret** avoids a live known-secret endpoint.
   (`trigger-runner.ts:44,87,110`)
6. **Event Trigger matches on `source`.** A `data.persisted` event carries `{ source, count,
   resourceTypes, batchId }`; the event trigger fires only when its configured `source` matches the
   Persist Store node's `source`. (`workflow-ingestion-loop-workstream`)

## Design

### Two seeded workflows

**1. "Ingest Lab Orders (Webhook)"** — id `wf-sample` (unchanged id = clean replace, no double-seed),
**seeded `enabled: false`**:

```
Webhook Trigger  (path: "lab-orders", method: POST, secret: <per-install randomUUID>)
   │   POST /api/workflows/hooks/lab-orders,  header X-Webhook-Token: <secret>
   ▼
Form Validate   (config.formId = seeded "Lab order" form id — injected at seed time;
   │             config.sourcePath = "body" — unwraps the webhook envelope
   │             {method,body,headers,query} → the answers themselves)
   ▼
Persist Store   (config.source = "webhook-lab-orders")   → emits data.persisted{source,batchId,…}
   │
   ▼
Log   "Persisted lab order: {{ $json }}"
```

> **Design note (revised during review):** the unwrap was originally a Code node
> (`return $json.body ?? $json`), but Code nodes are gated behind `WORKFLOW_CODE_ENABLED`
> (default OFF, host-privileged), which would have made the seeded loop fail on a stock
> install. Instead, Form Validate gained an optional `config.sourcePath` that reads answers
> from a nested field of each item — no Code node, works on stock config, and is reusable for
> any webhook→validate flow.

**2. "On Lab Order Persisted → Log"** — id `wf-sample-reactive`, **seeded `enabled: true`**:

```
Event Trigger   (event: data.persisted, source: "webhook-lab-orders", resourceType: "")
   │
   ▼
Log   "Reacted to {{ $json.count }} {{ $json.resourceTypes }} from {{ $json.source }}"
```

### Enabled asymmetry (deliberate)

- **Inbound = disabled.** It exposes a live HTTP endpoint; the operator must opt in (enable the
  workflow and copy its secret). No fresh install ships an open, known-secret ingestion endpoint.
- **Reactive = enabled.** It has no external surface — a pure internal listener that only fires on
  `data.persisted` where `source == "webhook-lab-orders"` (only the inbound produces that). Enabling
  it by default means that the moment the operator enables the inbound and POSTs a valid order,
  **both** runs appear in Run History — the loop is self-demonstrating.

### Secret handling

The webhook secret is generated **once, per install, at seed time** via `randomUUID()` in `seed.ts`
and injected into the inbound definition. Because the workflow is seeded **create-if-absent by id**,
the secret is stable after first seed and a re-run never regenerates it or clobbers operator edits.
The seed source in git therefore contains **no** committed secret.

### Data-flow honesty

- A manual **Run** of the inbound (empty body) → unwrap yields `{}` → Form Validate marks it invalid
  → dropped → the run **succeeds** with 0 persisted (no crash). Real persistence happens only on a
  real POST carrying a body. This is documented in the workflow description.
- The "Lab order" form's required fields (`patient`, `tests`, `fld-ord-priority`) are validated for
  **presence**, not referent existence. A documented example payload with placeholder references
  validates and persists a `ServiceRequest`:

  ```
  POST /api/workflows/hooks/lab-orders
  X-Webhook-Token: <secret>
  Content-Type: application/json

  { "patient": "Patient/seed-pat", "tests": "ActivityDefinition/cbc",
    "fld-ord-priority": "routine" }
  ```

## Components & file changes

### `packages/workflows/src/sample-workflow.ts` (rewrite)

Replace the `sampleWorkflow` constant with a **pure builder**:

```ts
export function buildDefaultWorkflows(input: {
  orderFormId: string;
  webhookSecret: string;
}): Workflow[];
```

Returns `[inbound, reactive]` (the two graphs above), fully deterministic given its inputs. Node
`data` shapes mirror the persisted schema used by the existing seed/demo (templateId/action/config;
edges omit the web-only `type:'custom'`).

### `packages/workflows/src/index.ts`

Replace `export { sampleWorkflow }` with `export { buildDefaultWorkflows }`.

### `packages/bootstrap/src/seed.ts`

- Inside the existing forms loop, capture the id of the seeded form named **"Lab order"** into a
  local (`orderFormId`).
- After the loop: if `orderFormId` was found, generate `const webhookSecret = randomUUID()`, call
  `buildDefaultWorkflows({ orderFormId, webhookSecret })`, and seed each workflow **idempotently by
  id** (create only when absent). If the order form was somehow not seeded, `console.warn` and skip
  workflow seeding (defensive — it is in `sampleForms`, so this should not happen).
- `SeedResult.workflowsSeeded` now counts the number of the two default workflows actually created
  (0, 1, or 2). Update the JSDoc accordingly.

### `apps/studio/src/workflows/lib/sample-workflow.ts` (shrink)

- `sampleNodes` → a single Manual Trigger node (`type:'trigger'`, `triggerType:'manual'`,
  `templateId:'manual-trigger'`, `iconName:'Play'`, label "When clicked"); `sampleEdges` → `[]`.
- Keep the export names so `use-workflow-store.ts` imports don't break.
- In `use-workflow-store.ts`, change the default `workflowName` from `'Sample Workflow'` to
  `'Untitled workflow'`.

## Testing

- **workflows unit** (new, `sample-workflow.test.ts`): `buildDefaultWorkflows` —
  - returns two workflows with ids `wf-sample` and `wf-sample-reactive`;
  - inbound `enabled === false`, reactive `enabled === true`;
  - the injected `orderFormId` appears on the Form Validate node's `config.formId`;
  - the injected `webhookSecret` appears on the Webhook node's `data.secret`;
  - Persist Store `config.source` **equals** the Event Trigger `config.source`
    (`"webhook-lab-orders"`) — the loop is wired;
  - edge lists connect trigger→…→persist→log and event→log.
- **bootstrap seed** (`seed.test.ts`, extend): extend the `workflows.store` fake to record the full
  `definition`; assert
  - `res.workflowsSeeded === 2` on first run, `0` on reseed (idempotent);
  - both ids present exactly once;
  - the inbound's Form Validate `config.formId` equals the seeded "Lab order" form's id
    (`form-3` under the fake's `form-${index}` scheme);
  - update the two existing assertions that expect `workflowsSeeded === 1` and
    `workflows[0].name === 'Sample Workflow'`.
- **studio**: update any test asserting the old sample node count or the `'Sample Workflow'`
  default name.
- **live (scratchpad, not committed)**: bring infra up, run the seed, enable the inbound, POST the
  example order with the seeded secret, and confirm via Run History that the inbound persisted a
  `ServiceRequest` and the reactive workflow logged the reaction.

## Gate

Cross-package (workflows + bootstrap + studio touched): `pnpm typecheck --force`; targeted vitest
for `@openldr/workflows`, `@openldr/bootstrap`, and `apps/studio` (studio re-run isolated for the
known parallel flake; expect the one pre-existing `api.test.ts` failure). Do **not** run `pnpm build`
for the server (native-dep esbuild failure is pre-existing).

## Migration behavior

Keeping the inbound id `wf-sample` means: on an **existing** install that already seeded the old
`wf-sample`, the seed is a no-op (matched by id) — it keeps its old sample and never sees the new
one; the operator can delete it. On a **fresh** install, `wf-sample` is the new inbound loop. The
reactive `wf-sample-reactive` is new on both. This is the intended "replace on fresh install"
semantics; it never clobbers operator-edited workflows.
