# Real Default Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the throwaway seeded "Sample Workflow" with a real form-validated lab-order ingestion loop (webhook → unwrap → Form Validate → Persist Store → Log) plus a reactive `data.persisted` companion, and start new builder workflows from a clean single-trigger canvas.

**Architecture:** `packages/workflows` exposes a pure builder `buildDefaultWorkflows({ orderFormId, webhookSecret })` returning the two graphs; `packages/bootstrap/src/seed.ts` captures the seeded "Lab order" form id, generates a per-install secret, and seeds both workflows idempotently by id. The studio canvas starter (`apps/studio/src/workflows/lib/sample-workflow.ts`) shrinks to a single Manual Trigger.

**Tech Stack:** TypeScript, Zod, Vitest, pnpm workspaces (turbo), React (studio).

**Spec:** `docs/superpowers/specs/2026-07-02-real-default-workflow-design.md`

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/workflows/src/sample-workflow.ts` | Pure builder for the two seeded default workflows | Rewrite |
| `packages/workflows/src/sample-workflow.test.ts` | Unit test for the builder | Create |
| `packages/workflows/src/index.ts` | Package barrel export | Modify (swap export) |
| `packages/bootstrap/src/seed.ts` | Idempotent sample-data seed | Modify (thread form id + seed both) |
| `packages/bootstrap/src/seed.test.ts` | Seed unit tests (in-memory fakes) | Modify (assert new wiring) |
| `apps/studio/src/workflows/lib/sample-workflow.ts` | Builder new-workflow canvas starter | Rewrite (single trigger) |
| `apps/studio/src/workflows/hooks/use-workflow-store.ts` | Builder store default state | Modify (default name) |

**Node-shape reference** (verified against `apps/studio/src/workflows/constants.ts` — the builder palette):

- Webhook: `type:'webhook'`, `templateId:'webhook-trigger'`, `iconName:'Webhook'`, `data.{path,method:'POST',secret}`.
- Code: `type:'code'`, `templateId:'code'`, `iconName:'Code'`, `data.{code,language:'javascript'}`.
- Form Validate: `type:'action'`, `templateId:'form-validate'`, `iconName:'ClipboardCheck'`, `data.action:'form-validate'`, `data.config.formId`.
- Persist Store: `type:'action'`, `templateId:'persist-store'`, `iconName:'Database'`, `data.action:'persist-store'`, `data.config.source`.
- Log: `type:'action'`, `templateId:'log'`, `iconName:'Terminal'`, `data.action:'log'`, `data.{message,level}`.
- Event Trigger: `type:'trigger'`, `templateId:'event-trigger'`, `iconName:'Radio'`, `data.triggerType:'event'`, `data.config.{event,source,resourceType}`.
- Manual Trigger: `type:'trigger'`, `templateId:'manual-trigger'`, `iconName:'Play'`, `data.triggerType:'manual'`.

**Sequencing note:** Task 1 swaps the `packages/workflows` barrel export, which breaks the `sampleWorkflow` import in `packages/bootstrap` until Task 2 lands. Verify Task 1 with the **package-scoped** test/typecheck; run the cross-package `pnpm typecheck --force` gate only at the end of Task 2. Task 3 (studio) is independent and can run in any order.

---

## Task 1: `buildDefaultWorkflows` builder (packages/workflows)

**Files:**
- Rewrite: `packages/workflows/src/sample-workflow.ts`
- Create: `packages/workflows/src/sample-workflow.test.ts`
- Modify: `packages/workflows/src/index.ts:12`

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/sample-workflow.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildDefaultWorkflows } from './sample-workflow';

describe('buildDefaultWorkflows', () => {
  const [inbound, reactive] = buildDefaultWorkflows({
    orderFormId: 'form-xyz',
    webhookSecret: 'secret-abc',
  });

  it('returns the inbound + reactive pair with stable ids', () => {
    expect(inbound.id).toBe('wf-sample');
    expect(reactive.id).toBe('wf-sample-reactive');
  });

  it('ships the inbound disabled and the reactive enabled', () => {
    expect(inbound.enabled).toBe(false);
    expect(reactive.enabled).toBe(true);
  });

  it('injects the form id onto the Form Validate node', () => {
    const fv = inbound.definition.nodes.find((n) => n.data.action === 'form-validate');
    expect(fv?.data.config).toMatchObject({ formId: 'form-xyz' });
  });

  it('injects the secret + path + method onto the webhook node', () => {
    const hook = inbound.definition.nodes.find((n) => n.type === 'webhook');
    expect(hook?.data).toMatchObject({ secret: 'secret-abc', path: 'lab-orders', method: 'POST' });
  });

  it('wires the persist source to match the event-trigger source', () => {
    const persist = inbound.definition.nodes.find((n) => n.data.action === 'persist-store');
    const evt = reactive.definition.nodes.find((n) => n.data.triggerType === 'event');
    expect(persist?.data.config).toMatchObject({ source: 'webhook-lab-orders' });
    expect(evt?.data.config).toMatchObject({ source: 'webhook-lab-orders' });
  });

  it('connects the inbound chain trigger→unwrap→validate→persist→log', () => {
    const hops = inbound.definition.edges.map((e) => `${e.source}->${e.target}`);
    expect(hops).toEqual([
      'trigger-1->unwrap-1',
      'unwrap-1->form-validate-1',
      'form-validate-1->persist-1',
      'persist-1->log-1',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows test -- sample-workflow`
Expected: FAIL — `buildDefaultWorkflows` is not exported (still `sampleWorkflow`).

- [ ] **Step 3: Rewrite the builder**

Replace the entire contents of `packages/workflows/src/sample-workflow.ts` with:

```ts
import type { Workflow } from './types';

// The seeded default workflows for a fresh install. Replaces the old node-showcase
// "Sample Workflow" with a real, honest form-validated ingestion loop built entirely
// from nodes that exist today, plus a reactive companion that demonstrates the
// data.persisted event loop.
//
//   Inbound  (wf-sample, DISABLED):
//     Webhook (POST /api/workflows/hooks/lab-orders, X-Webhook-Token)
//       → Code "Unwrap request body"  (webhook delivers {method,body,headers,query};
//                                       Form Validate wants the answers themselves)
//       → Form Validate (Lab order form → ServiceRequest)
//       → Persist Store (source: webhook-lab-orders → emits data.persisted)
//       → Log
//
//   Reactive (wf-sample-reactive, ENABLED):
//     Event Trigger (data.persisted, source: webhook-lab-orders) → Log
//
// The inbound ships DISABLED because it exposes a live HTTP endpoint — the operator
// opts in (enable + copy the secret). The reactive one ships ENABLED because it has no
// external surface; enabling both is a one-click demo of the whole loop.
//
// This is a pure builder: the form id and webhook secret are injected by the seed
// (packages/bootstrap/src/seed.ts) at seed time — the seeded "Lab order" form gets a
// fresh random id, and the secret is generated per-install so no secret is committed.

const WEBHOOK_PATH = 'lab-orders';
/** Persist Store `source` and the reactive Event Trigger `source` MUST match for the loop to fire. */
const PERSIST_SOURCE = 'webhook-lab-orders';

export interface DefaultWorkflowInput {
  /** Id of the seeded "Lab order" form the inbound loop validates against. */
  orderFormId: string;
  /** Per-install shared secret for the inbound webhook (sent as X-Webhook-Token). */
  webhookSecret: string;
}

export function buildDefaultWorkflows({ orderFormId, webhookSecret }: DefaultWorkflowInput): Workflow[] {
  const inbound: Workflow = {
    id: 'wf-sample',
    name: 'Ingest Lab Orders (Webhook)',
    description:
      'POST a lab order to /api/workflows/hooks/lab-orders with header X-Webhook-Token → validate ' +
      'against the "Lab order" form → persist a ServiceRequest → emit data.persisted. Disabled by ' +
      'default: enable it and copy the webhook secret to accept requests. A manual Run with no body ' +
      'validates to zero rows (no-op).',
    enabled: false,
    createdBy: null,
    definition: {
      nodes: [
        {
          id: 'trigger-1',
          type: 'webhook',
          position: { x: 60, y: 220 },
          data: {
            label: 'Lab order received',
            path: WEBHOOK_PATH,
            method: 'POST',
            secret: webhookSecret,
            templateId: 'webhook-trigger',
            iconName: 'Webhook',
          },
        },
        {
          id: 'unwrap-1',
          type: 'code',
          position: { x: 300, y: 220 },
          data: {
            label: 'Unwrap request body',
            code: 'return $json.body ?? $json;',
            language: 'javascript',
            templateId: 'code',
            iconName: 'Code',
          },
        },
        {
          id: 'form-validate-1',
          type: 'action',
          position: { x: 540, y: 220 },
          data: {
            label: 'Validate lab order',
            action: 'form-validate',
            config: { formId: orderFormId },
            templateId: 'form-validate',
            iconName: 'ClipboardCheck',
          },
        },
        {
          id: 'persist-1',
          type: 'action',
          position: { x: 780, y: 220 },
          data: {
            label: 'Persist store',
            action: 'persist-store',
            config: { source: PERSIST_SOURCE },
            templateId: 'persist-store',
            iconName: 'Database',
          },
        },
        {
          id: 'log-1',
          type: 'action',
          position: { x: 1020, y: 220 },
          data: {
            label: 'Log persisted',
            action: 'log',
            message: 'Persisted lab order: {{ $json }}',
            level: 'info',
            config: {},
            templateId: 'log',
            iconName: 'Terminal',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'unwrap-1' },
        { id: 'e2', source: 'unwrap-1', target: 'form-validate-1' },
        { id: 'e3', source: 'form-validate-1', target: 'persist-1' },
        { id: 'e4', source: 'persist-1', target: 'log-1' },
      ],
    },
  };

  const reactive: Workflow = {
    id: 'wf-sample-reactive',
    name: 'On Lab Order Persisted → Log',
    description:
      'Reacts to the data.persisted event emitted when a lab order is stored (source ' +
      'webhook-lab-orders) and logs a summary. Demonstrates the event-driven half of the ' +
      'ingestion loop — enable "Ingest Lab Orders (Webhook)" and POST an order to see it fire.',
    enabled: true,
    createdBy: null,
    definition: {
      nodes: [
        {
          id: 'evt-1',
          type: 'trigger',
          position: { x: 60, y: 220 },
          data: {
            label: 'On data persisted',
            triggerType: 'event',
            config: { event: 'data.persisted', source: PERSIST_SOURCE, resourceType: '' },
            templateId: 'event-trigger',
            iconName: 'Radio',
          },
        },
        {
          id: 'log-1',
          type: 'action',
          position: { x: 300, y: 220 },
          data: {
            label: 'Log reaction',
            action: 'log',
            message: 'Reacted to {{ $json.count }} {{ $json.resourceTypes }} from {{ $json.source }}',
            level: 'info',
            config: {},
            templateId: 'log',
            iconName: 'Terminal',
          },
        },
      ],
      edges: [{ id: 'e1', source: 'evt-1', target: 'log-1' }],
    },
  };

  return [inbound, reactive];
}
```

- [ ] **Step 4: Swap the barrel export**

In `packages/workflows/src/index.ts`, change line 12 from:

```ts
export { sampleWorkflow } from './sample-workflow';
```

to:

```ts
export { buildDefaultWorkflows, type DefaultWorkflowInput } from './sample-workflow';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C packages/workflows test -- sample-workflow`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck the package**

Run: `pnpm -C packages/workflows typecheck`
Expected: PASS. (The cross-package gate stays red until Task 2 — that's expected.)

- [ ] **Step 7: Commit**

```bash
git add packages/workflows/src/sample-workflow.ts packages/workflows/src/sample-workflow.test.ts packages/workflows/src/index.ts
git commit -m "feat(workflows): buildDefaultWorkflows — real lab-order ingestion loop + reactive companion"
```

---

## Task 2: Seed both workflows with the injected form id (packages/bootstrap)

**Files:**
- Modify: `packages/bootstrap/src/seed.ts`
- Modify: `packages/bootstrap/src/seed.test.ts`

- [ ] **Step 1: Update the seed test fakes + assertions (write failing test)**

In `packages/bootstrap/src/seed.test.ts`, extend the `workflows.store` fake to record the full definition. Change the `workflows` array declaration (line 9) from:

```ts
  const workflows: { id: string; name: string }[] = [];
```

to:

```ts
  const workflows: { id: string; name: string; definition?: unknown }[] = [];
```

and change the fake `create` (lines 74-77) from:

```ts
        create: async (w: { id: string; name: string }) => {
          workflows.push({ id: w.id, name: w.name });
          return w as never;
        },
```

to:

```ts
        create: async (w: { id: string; name: string; definition?: unknown }) => {
          workflows.push({ id: w.id, name: w.name, definition: w.definition });
          return w as never;
        },
```

Then replace the entire `describe('seedDatabase — sample workflow', ...)` block (lines 103-119) with:

```ts
describe('seedDatabase — default workflows', () => {
  // The seeded sample-forms include "Lab order" at index 3 → the fake assigns it id 'form-3'.
  const ORDER_FORM_ID = 'form-3';

  it('seeds the inbound + reactive default workflows', async () => {
    const { app, workflows } = fakeApp();
    const res = await seedDatabase(fakeDb, app);
    expect(res.workflowsSeeded).toBe(2);
    expect(workflows.map((w) => w.id).sort()).toEqual(['wf-sample', 'wf-sample-reactive']);
  });

  it('injects the seeded "Lab order" form id into the inbound Form Validate node', async () => {
    const { app, workflows } = fakeApp();
    await seedDatabase(fakeDb, app);
    const inbound = workflows.find((w) => w.id === 'wf-sample');
    const def = inbound?.definition as { nodes: { data: { action?: string; config?: { formId?: string } } }[] };
    const fv = def.nodes.find((n) => n.data.action === 'form-validate');
    expect(fv?.data.config?.formId).toBe(ORDER_FORM_ID);
  });

  it('is idempotent — re-running seeds nothing new', async () => {
    const { app, workflows } = fakeApp();
    await seedDatabase(fakeDb, app);
    const res2 = await seedDatabase(fakeDb, app);
    expect(res2.workflowsSeeded).toBe(0);
    expect(workflows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C packages/bootstrap test -- seed`
Expected: FAIL — seed still creates only `wf-sample` (name "Sample Workflow"), `workflowsSeeded === 1`, and imports the now-removed `sampleWorkflow`.

- [ ] **Step 3: Update the seed import**

In `packages/bootstrap/src/seed.ts` line 3, change:

```ts
import { sampleWorkflow, type WorkflowStore } from '@openldr/workflows';
```

to:

```ts
import { buildDefaultWorkflows, type WorkflowStore } from '@openldr/workflows';
```

- [ ] **Step 4: Capture the "Lab order" form id in the forms loop**

In `packages/bootstrap/src/seed.ts`, just before the forms loop (before `let formsSeeded = 0;` at line 87), add:

```ts
  let orderFormId: string | null = null;
```

Then inside the loop, immediately after the `if (status !== 'published') await app.forms.setStatus(id, 'published');` line (line 115), add:

```ts
    if (form.name === 'Lab order') orderFormId = id;
```

- [ ] **Step 5: Replace the workflow-seeding block**

In `packages/bootstrap/src/seed.ts`, replace the sample-workflow block (lines 118-125):

```ts
  // Sample workflow — seeded once (idempotent by stable id) so the Workflows list isn't
  // empty on a fresh install. Matched by id, not name, so a user-renamed copy is never re-created.
  const existingWorkflows = await app.workflows.store.list();
  let workflowsSeeded = 0;
  if (!existingWorkflows.some((w) => w.id === sampleWorkflow.id)) {
    await app.workflows.store.create(sampleWorkflow);
    workflowsSeeded = 1;
  }
```

with:

```ts
  // Default workflows — the inbound lab-order ingestion loop + its reactive companion, seeded
  // once each (idempotent by stable id) so a fresh install ships a real, runnable example. The
  // inbound's Form Validate node is bound to the seeded "Lab order" form's actual id, and the
  // webhook secret is generated per-install (so no secret is committed and reseeds never rotate
  // it). Matched by id, not name, so operator-edited copies are never re-created.
  const existingWorkflows = await app.workflows.store.list();
  let workflowsSeeded = 0;
  if (orderFormId) {
    const defaults = buildDefaultWorkflows({ orderFormId, webhookSecret: randomUUID() });
    for (const wf of defaults) {
      if (!existingWorkflows.some((w) => w.id === wf.id)) {
        await app.workflows.store.create(wf);
        workflowsSeeded += 1;
      }
    }
  } else {
    console.warn('[seed] "Lab order" form not found — skipping default workflow seed');
  }
```

(`randomUUID` is already imported at the top of `seed.ts`.)

- [ ] **Step 6: Update the SeedResult doc comment**

In `packages/bootstrap/src/seed.ts`, the `SeedResult` interface has `workflowsSeeded: number;` (line 13). Leave the field, but ensure no stale "sample workflow" wording remains in nearby comments. No functional change.

- [ ] **Step 7: Run the bootstrap test to verify it passes**

Run: `pnpm -C packages/bootstrap test -- seed`
Expected: PASS (default-workflows describe block green; other seed tests unchanged).

- [ ] **Step 8: Run the cross-package gate**

Run: `pnpm typecheck --force`
Expected: PASS across all packages (bootstrap now compiles against the new export).

- [ ] **Step 9: Commit**

```bash
git add packages/bootstrap/src/seed.ts packages/bootstrap/src/seed.test.ts
git commit -m "feat(bootstrap): seed real default workflows bound to the seeded Lab order form"
```

---

## Task 3: Clean single-trigger canvas starter (apps/studio)

**Files:**
- Rewrite: `apps/studio/src/workflows/lib/sample-workflow.ts`
- Modify: `apps/studio/src/workflows/hooks/use-workflow-store.ts:93`

- [ ] **Step 1: Shrink the canvas starter**

Replace the entire contents of `apps/studio/src/workflows/lib/sample-workflow.ts` with:

```ts
import type { WorkflowNode, WorkflowEdge } from './types';

/**
 * Starter canvas for a brand-new (unsaved) workflow in the builder: a single Manual
 * Trigger, so creating a workflow starts clean instead of from a throwaway demo graph.
 * (The seeded default workflows a fresh install ships live in
 * packages/workflows/src/sample-workflow.ts.)
 */
export const sampleNodes: WorkflowNode[] = [
  {
    id: 'trigger-1',
    type: 'trigger',
    position: { x: 240, y: 200 },
    data: {
      label: 'When clicked',
      triggerType: 'manual',
      config: {},
      templateId: 'manual-trigger',
      iconName: 'Play',
    },
  },
];

export const sampleEdges: WorkflowEdge[] = [];
```

- [ ] **Step 2: Update the default workflow name**

In `apps/studio/src/workflows/hooks/use-workflow-store.ts` line 93, change:

```ts
  workflowName: 'Sample Workflow',
```

to:

```ts
  workflowName: 'Untitled workflow',
```

- [ ] **Step 3: Run the studio workflow tests (isolated)**

Run: `pnpm -C apps/studio test`
Expected: PASS except the one known pre-existing failure (`src/api.test.ts > "includes server error messages for failed JSON responses"`). Re-run isolated if the known parallel flake trips; do not chase either.

- [ ] **Step 4: Typecheck studio**

Run: `pnpm -C apps/studio typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/workflows/lib/sample-workflow.ts apps/studio/src/workflows/hooks/use-workflow-store.ts
git commit -m "feat(studio): start new workflows from a single Manual Trigger canvas"
```

---

## Task 4: Live verification + final gate

**Files:** none committed (scratchpad only — do NOT add scripts to the repo per convention).

- [ ] **Step 1: Bring infra up + apply migrations + seed**

Run (from repo root, infra already configured):

```bash
pnpm openldr db migrate
pnpm openldr db seed
```

Expected: seed logs report the default workflows created (2 on a fresh DB).

- [ ] **Step 2: Confirm the seeded workflows + form binding**

Write a throwaway script under the scratchpad dir (NOT the repo) that opens the internal DB via `@openldr/db` + `@openldr/workflows` `createWorkflowStore`, lists workflows, and prints the inbound's Form Validate `config.formId` alongside the "Lab order" form id. Confirm they match, `wf-sample` is `enabled:false`, `wf-sample-reactive` is `enabled:true`.

- [ ] **Step 3: Drive the loop end-to-end**

Enable `wf-sample` (via API `PUT /api/workflows/wf-sample` or the builder), read its webhook secret, then:

```bash
curl -X POST http://localhost:<port>/api/workflows/hooks/lab-orders \
  -H 'X-Webhook-Token: <secret>' -H 'Content-Type: application/json' \
  -d '{"body":{"patient":"Patient/seed-pat","tests":"ActivityDefinition/cbc","fld-ord-priority":"routine"}}'
```

Expected: the inbound run persists a `ServiceRequest` (check Run History / `fhir_resources`), and `wf-sample-reactive` auto-fires and logs "Reacted to 1 …". (Note: the example wraps the answers under `body` to mirror a real webhook envelope; the Unwrap node also accepts un-wrapped payloads.)

- [ ] **Step 4: Final holistic gate**

Run: `pnpm typecheck --force` and the three package test suites (`packages/workflows`, `packages/bootstrap`, `apps/studio` isolated).
Expected: green (studio 605/606 with the one known pre-existing failure).

- [ ] **Step 5: Update project memory**

Update `real-default-workflow-idea.md` (mark implemented; note the deferred multi-tenant authz Non-Goal) and add a one-line pointer/refresh in `MEMORY.md`.

---

## Self-Review Notes

- **Spec coverage:** two seeded workflows (Task 1 builder, Task 2 seed), unwrap node (Task 1), seed-time form-id + secret injection (Task 2), enabled asymmetry (Task 1 literals + Task 2 test), single-trigger canvas (Task 3), tests (Tasks 1-3), live verify (Task 4), deferred authz recorded in spec Non-Goals. Docs update intentionally omitted (spec Non-Goal).
- **Type consistency:** `buildDefaultWorkflows({ orderFormId, webhookSecret })` signature identical in Task 1 (definition), Task 2 (call site), and the tests. `WEBHOOK_PATH='lab-orders'` / `PERSIST_SOURCE='webhook-lab-orders'` used consistently; persist `source` == event-trigger `source` asserted in both the workflows unit test and implied by the shared constant.
- **No placeholders:** every code + command step is literal.
