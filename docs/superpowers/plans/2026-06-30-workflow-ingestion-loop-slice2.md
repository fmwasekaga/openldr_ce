# Workflow Ingestion Loop — Slice 2 (Event Trigger) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic `event` trigger type that fires a workflow on the `data.persisted` domain event (with source/resourceType filters), plus a builder Event Trigger node — closing the inbound→event half of the loop.

**Architecture:** Mirror the existing `ingest` trigger exactly: a `data.persisted` subscriber in `trigger-runner.ts`, a closure-captured `eventIds` set rebuilt at boot and on workflow save, and a per-node filter. The builder gets an `event-trigger` palette template + a bespoke `EventTriggerForm`. `node.data` is loosely typed, so no schema change.

**Tech Stack:** TypeScript, Vitest. Packages: `@openldr/workflows`, `apps/server`, `apps/web`.

**Conventions:** Run web tests isolated (`pnpm -C apps/web test`); workspace gate via `pnpm exec turbo typecheck --force` (turbo flag, NOT `pnpm typecheck -- --force`). Work on a worktree branch, merge to local `main`, not pushed. Frequent commits.

---

## File Structure

**Modify:**
- `packages/workflows/src/types.ts` — add `'event'` to `TRIGGER_SOURCES`.
- `packages/workflows/src/trigger-runner.ts` — `DATA_PERSISTED` const, `eventIds` set, `setEventWorkflowIds`, `eventNodeMatches`, the `data.persisted` subscriber.
- `packages/workflows/src/trigger-runner.test.ts` — event-trigger subscriber tests.
- `apps/server/src/index.ts` — seed the event-workflow id set at boot.
- `apps/server/src/workflows-routes.ts` — `listEventWorkflowIds` + `setEventWorkflowIds` on create/update/delete.
- `apps/server/src/workflows-routes.test.ts` — `setEventWorkflowIds` spy + indexing test.
- `apps/web/src/workflows/constants.ts` — `event-trigger` palette template + `IMPLEMENTED_TEMPLATE_IDS`.
- `apps/web/src/workflows/components/node-forms/index.tsx` — register `event-trigger`.

**Create:**
- `apps/web/src/workflows/components/node-forms/event-trigger-form.tsx` + its test.

---

## Task 1: Event subscriber in the trigger runner

**Files:**
- Modify: `packages/workflows/src/types.ts`, `packages/workflows/src/trigger-runner.ts`
- Test: `packages/workflows/src/trigger-runner.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/workflows/src/trigger-runner.test.ts` (it already has `fakeEventing()` and `wfWith()` helpers and imports `createWorkflowTriggerRunner` + `runWorkflow`):

```typescript
const eventRunner = (nodes: unknown[], recorded: unknown[]) =>
  createWorkflowTriggerRunner({
    store: { get: async () => wfWith(nodes) } as never,
    runs: { record: async (r: unknown) => { recorded.push(r); } } as never,
    schedules: { list: async () => [], get: async () => undefined, setNextDue: async () => {} } as never,
    webhooks: { resolve: () => undefined } as never,
    runWorkflow,
    logger: { error: () => {}, warn: () => {} },
  });

const fireDataPersisted = async (ev: ReturnType<typeof fakeEventing>, payload: unknown) =>
  ev.handlers.get('data.persisted')!({ type: 'data.persisted', payload });

describe('event trigger (data.persisted)', () => {
  it('runs an event-trigger workflow when source + resourceType filters match', async () => {
    const ev = fakeEventing();
    const recorded: unknown[] = [];
    const runner = eventRunner(
      [{ id: 'e', type: 'trigger', data: { triggerType: 'event', config: { source: 'demo-lab', resourceType: 'Observation' } } }],
      recorded,
    );
    runner.setEventWorkflowIds(['w1']);
    await runner.registerRunner(ev.port as never);
    await fireDataPersisted(ev, { source: 'demo-lab', resourceTypes: ['Observation'], count: 1 });
    expect(recorded.length).toBe(1);
    expect((recorded[0] as { triggerSource: string }).triggerSource).toBe('event');
  });

  it('skips when the source filter does not match', async () => {
    const ev = fakeEventing();
    const recorded: unknown[] = [];
    const runner = eventRunner(
      [{ id: 'e', type: 'trigger', data: { triggerType: 'event', config: { source: 'other' } } }],
      recorded,
    );
    runner.setEventWorkflowIds(['w1']);
    await runner.registerRunner(ev.port as never);
    await fireDataPersisted(ev, { source: 'demo-lab', resourceTypes: ['Observation'], count: 1 });
    expect(recorded.length).toBe(0);
  });

  it('skips when the resourceType filter is not among the event resource types', async () => {
    const ev = fakeEventing();
    const recorded: unknown[] = [];
    const runner = eventRunner(
      [{ id: 'e', type: 'trigger', data: { triggerType: 'event', config: { resourceType: 'ServiceRequest' } } }],
      recorded,
    );
    runner.setEventWorkflowIds(['w1']);
    await runner.registerRunner(ev.port as never);
    await fireDataPersisted(ev, { source: 'demo-lab', resourceTypes: ['Observation'], count: 1 });
    expect(recorded.length).toBe(0);
  });

  it('empty filters match any data.persisted event', async () => {
    const ev = fakeEventing();
    const recorded: unknown[] = [];
    const runner = eventRunner(
      [{ id: 'e', type: 'trigger', data: { triggerType: 'event', config: {} } }],
      recorded,
    );
    runner.setEventWorkflowIds(['w1']);
    await runner.registerRunner(ev.port as never);
    await fireDataPersisted(ev, { source: 'anything', resourceTypes: ['Patient'], count: 9 });
    expect(recorded.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/workflows test trigger-runner.test.ts`
Expected: FAIL — `setEventWorkflowIds` is not a function / no `data.persisted` handler registered.

- [ ] **Step 3: Add `'event'` to TRIGGER_SOURCES**

In `packages/workflows/src/types.ts`, change the `TRIGGER_SOURCES` line to:

```typescript
export const TRIGGER_SOURCES = ['manual', 'schedule', 'webhook', 'ingest', 'event'] as const;
```

- [ ] **Step 4: Add the event constant, set, matcher, subscriber, and method**

In `packages/workflows/src/trigger-runner.ts`:

(a) Next to `const INGEST_DONE = 'ingest.batch.done';`, add:
```typescript
const DATA_PERSISTED = 'data.persisted';
```

(b) In the `WorkflowTriggerRunner` interface, add (next to `setIngestWorkflowIds`):
```typescript
  setEventWorkflowIds(ids: string[]): void;
```

(c) Inside `createWorkflowTriggerRunner`, right after `let ingestIds = new Set<string>();`, add:
```typescript
  let eventIds = new Set<string>();
```

(d) Add this function next to `ingestNodeMatches`:
```typescript
  /**
   * Does this workflow's event trigger accept this data.persisted event? Empty
   * source/resourceType filters match everything; a set source matches the event
   * source case-insensitively; a set resourceType must be among the event's
   * resourceTypes.
   */
  async function eventNodeMatches(
    workflowId: string,
    payload: { source?: unknown; resourceTypes?: unknown },
  ): Promise<boolean> {
    const wf = await deps.store.get(workflowId);
    if (!wf || !wf.enabled) return false;
    const def = WorkflowDefinitionSchema.parse(wf.definition);
    const node = (def.nodes as Array<{ type?: string; data?: Record<string, unknown> }>).find(
      (n) => n.type === 'trigger' && n.data?.triggerType === 'event',
    );
    const cfg = (node?.data?.config ?? {}) as { source?: unknown; resourceType?: unknown };
    const wantSource = String(cfg.source ?? '').trim().toLowerCase();
    const wantType = String(cfg.resourceType ?? '').trim();
    const evSource = String(payload.source ?? '').trim().toLowerCase();
    const evTypes = Array.isArray(payload.resourceTypes) ? payload.resourceTypes.map((t) => String(t)) : [];
    if (wantSource !== '' && wantSource !== evSource) return false;
    if (wantType !== '' && !evTypes.includes(wantType)) return false;
    return true;
  }
```

(e) In `registerRunner`, after the `INGEST_DONE` subscriber block, add a third subscriber:
```typescript
      await eventing.subscribe(DATA_PERSISTED, async (event) => {
        const payload = (event.payload ?? {}) as { source?: unknown; resourceTypes?: unknown };
        for (const workflowId of eventIds) {
          try {
            if (!(await eventNodeMatches(workflowId, payload))) continue;
            await runAndRecord(workflowId, 'event', event.payload);
          } catch (err) {
            deps.logger.error({ err, workflowId }, 'event-triggered workflow run failed');
          }
        }
      });
```

(f) In the returned object literal, after the `setIngestWorkflowIds(ids) { … }` method, add:
```typescript
    setEventWorkflowIds(ids) {
      eventIds = new Set(ids);
    },
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm -C packages/workflows test trigger-runner.test.ts`
Expected: PASS (existing tests + 4 new event tests).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm -C packages/workflows typecheck` → PASS, then:
```bash
git add packages/workflows/src/types.ts packages/workflows/src/trigger-runner.ts packages/workflows/src/trigger-runner.test.ts
git commit -m "feat(workflows): event trigger subscriber for data.persisted"
```

---

## Task 2: Server boot + routes indexing

**Files:**
- Modify: `apps/server/src/index.ts`, `apps/server/src/workflows-routes.ts`
- Test: `apps/server/src/workflows-routes.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/server/src/workflows-routes.test.ts`, extend the fake runner inside `fakeWorkflowExtras()` so it tracks event ids. Add `let eventIds: string[] = [];` near the existing `let ingestIds: string[] = [];`, add `getEventIds: () => eventIds,` to the returned object (next to `getIngestIds`), and add to the `runner` object (next to `setIngestWorkflowIds`):
```typescript
      setEventWorkflowIds: (ids: string[]) => { eventIds = ids; },
```

Then append this test inside the `describe('workflow routes', …)` block:
```typescript
  it('indexes a workflow with an event trigger on create', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);

    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: {
        ...SAMPLE_WORKFLOW,
        id: 'wf-evt',
        definition: { nodes: [{ id: 'e', type: 'trigger', data: { triggerType: 'event', config: {} } }], edges: [] },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.__extras.getEventIds()).toContain('wf-evt');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/server test workflows-routes.test.ts`
Expected: FAIL — `setEventWorkflowIds` not called by the route, so `getEventIds()` is empty.

- [ ] **Step 3: Add the route indexing**

In `apps/server/src/workflows-routes.ts`:

(a) Add a `listEventWorkflowIds` function next to `listIngestWorkflowIds`:
```typescript
/** Scan all saved workflows for event trigger nodes; returns the ids that should fire on data.persisted. */
async function listEventWorkflowIds(ctx: AppContext): Promise<string[]> {
  const all = await ctx.workflows.store.list();
  return all.filter((w) => {
    const def = WorkflowDefinitionSchema.parse(w.definition);
    return (def.nodes as Array<{ type?: string; data?: Record<string, unknown> }>).some(
      (n) => n.type === 'trigger' && n.data?.triggerType === 'event');
  }).map((w) => w.id);
}
```

(b) After EACH existing `ctx.workflows.runner.setIngestWorkflowIds(await listIngestWorkflowIds(ctx));` line — in the POST, PUT, and DELETE `/api/workflows` handlers — add immediately below it:
```typescript
    ctx.workflows.runner.setEventWorkflowIds(await listEventWorkflowIds(ctx));
```

- [ ] **Step 4: Add the boot scan**

In `apps/server/src/index.ts`, find the existing block that calls `ctx.workflows.runner.setIngestWorkflowIds(...)` at startup (it filters `JSON.stringify(w.definition).includes('"triggerType":"ingest"')`). Immediately after that statement, add:
```typescript
    ctx.workflows.runner.setEventWorkflowIds(
      (await ctx.workflows.store.list())
        .filter((w) => JSON.stringify(w.definition).includes('"triggerType":"event"'))
        .map((w) => w.id),
    );
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm -C apps/server test workflows-routes.test.ts`
Expected: PASS (existing + the new indexing test).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm -C apps/server typecheck` → PASS, then:
```bash
git add apps/server/src/index.ts apps/server/src/workflows-routes.ts apps/server/src/workflows-routes.test.ts
git commit -m "feat(server): index + rebuild event-trigger workflows on boot and save"
```

---

## Task 3: Builder palette + Event Trigger form

**Files:**
- Modify: `apps/web/src/workflows/constants.ts`, `apps/web/src/workflows/components/node-forms/index.tsx`
- Create: `apps/web/src/workflows/components/node-forms/event-trigger-form.tsx` + `event-trigger-form.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/workflows/components/node-forms/event-trigger-form.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EventTriggerForm } from './event-trigger-form';

// Radix Select is awkward in jsdom; render it as a native <select> for this test.
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value?: string; onValueChange?: (v: string) => void }) => (
    <select role="combobox" value={value ?? ''} onChange={(e) => onValueChange?.(e.target.value)}>{children}</select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

const node = { id: 'e1', type: 'trigger', data: { label: 'Event Trigger', triggerType: 'event', config: { event: 'data.persisted', source: '', resourceType: '' } } } as never;

describe('EventTriggerForm', () => {
  it('renders the event select and the source + resource type filters', () => {
    render(<EventTriggerForm node={node} update={vi.fn()} />);
    expect(screen.getByText('Event')).toBeInTheDocument();
    expect(screen.getByText('Source filter')).toBeInTheDocument();
    expect(screen.getByText('Resource type filter')).toBeInTheDocument();
  });

  it('writes config.source when the source filter changes', () => {
    const update = vi.fn();
    render(<EventTriggerForm node={node} update={update} />);
    const inputs = screen.getAllByRole('textbox');
    // inputs: [Label, Source filter, Resource type filter]
    fireEvent.change(inputs[1], { target: { value: 'demo-lab' } });
    expect(update).toHaveBeenCalledWith({ config: { event: 'data.persisted', source: 'demo-lab', resourceType: '' } });
  });

  it('writes config.resourceType when the resource type filter changes', () => {
    const update = vi.fn();
    render(<EventTriggerForm node={node} update={update} />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[2], { target: { value: 'Observation' } });
    expect(update).toHaveBeenCalledWith({ config: { event: 'data.persisted', source: '', resourceType: 'Observation' } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/web test event-trigger-form.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the form**

Create `apps/web/src/workflows/components/node-forms/event-trigger-form.tsx`:

```typescript
import type { NodeFormProps } from './index';
import type { TriggerNodeData } from '../../lib/types';
import { FormField, TextInput, Select } from './shared';

/**
 * Event trigger form. Fires the workflow when a matching internal domain event
 * is published (pass one: `data.persisted`, emitted by the Persist Store node).
 *
 * Field-name contract (read by the server's event-trigger indexing + the runner's
 * eventNodeMatches): data.triggerType = 'event', data.config.{event,source,resourceType}.
 */
export function EventTriggerForm({ node, update }: NodeFormProps) {
  const data = node.data as TriggerNodeData;
  const config = data.config ?? {};
  const event = (config.event as string | undefined) ?? 'data.persisted';
  const source = (config.source as string | undefined) ?? '';
  const resourceType = (config.resourceType as string | undefined) ?? '';

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} />
      </FormField>

      <FormField label="Event" hint="Fires when this internal event is published.">
        <Select value={event} onChange={(e) => update({ config: { ...config, event: e.target.value } })}>
          <option value="data.persisted">data.persisted</option>
        </Select>
      </FormField>

      <FormField label="Source filter" hint="Optional. Only run for events from this source (e.g. demo-lab). Empty = all.">
        <TextInput
          value={source}
          onChange={(e) => update({ config: { ...config, source: e.target.value } })}
          placeholder="demo-lab"
        />
      </FormField>

      <FormField label="Resource type filter" hint="Optional. Only run when this resource type was persisted (e.g. Observation). Empty = all.">
        <TextInput
          value={resourceType}
          onChange={(e) => update({ config: { ...config, resourceType: e.target.value } })}
          placeholder="Observation"
        />
      </FormField>
    </div>
  );
}
```

NOTE: the `Select` from `./shared` accepts `value` + `onChange` (an event with `e.target.value`) — the same usage as `PluginField`'s select. If `./shared`'s `Select` signature differs, match how `plugin-node-form.tsx` calls it.

- [ ] **Step 4: Register the form**

In `apps/web/src/workflows/components/node-forms/index.tsx`, add the import near the other form imports:
```typescript
import { EventTriggerForm } from './event-trigger-form';
```
And add to the `FORMS` registry object:
```typescript
  'event-trigger': EventTriggerForm,
```

- [ ] **Step 5: Run the form test to verify it passes**

Run: `pnpm -C apps/web test event-trigger-form.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Add the palette template**

In `apps/web/src/workflows/constants.ts`, add this entry to the Core category's `items` array, right after the `node('ingest', …)` entry:
```typescript
      node('event-trigger', 'trigger', 'Event Trigger', 'Radio', 'Run when a domain event fires (e.g. data persisted)', {
        keywords: ['event', 'trigger', 'data.persisted', 'notify'],
        data: { triggerType: 'event', config: { event: 'data.persisted', source: '', resourceType: '' } },
      }),
```
And add `'event-trigger'` to the `IMPLEMENTED_TEMPLATE_IDS` set (with the other trigger ids).

- [ ] **Step 7: Run the existing sidebar test for no regression**

Run: `pnpm -C apps/web test sidebar.test.tsx sidebar-ingestion-nodes.test.tsx`
Expected: PASS.

- [ ] **Step 8: Typecheck + commit**

Run: `pnpm -C apps/web typecheck` → PASS, then:
```bash
git add apps/web/src/workflows/components/node-forms/event-trigger-form.tsx apps/web/src/workflows/components/node-forms/event-trigger-form.test.tsx apps/web/src/workflows/components/node-forms/index.tsx apps/web/src/workflows/constants.ts
git commit -m "feat(web): Event Trigger palette node + config form"
```

---

## Task 4: Gate

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the workspace**

Run: `pnpm exec turbo typecheck --force`
Expected: PASS (all packages).

- [ ] **Step 2: Run the affected suites**

Run: `pnpm -C packages/workflows test` then `pnpm -C apps/server test` then `pnpm -C apps/web test`
Expected: PASS for each. (Run `apps/web` isolated — the turbo `web#test` is a known parallel flake.)

- [ ] **Step 3: Commit if any incidental fixes were needed**
```bash
git add -A
git commit -m "chore(workflows): slice 2 event trigger — gate green"
```
(Skip if nothing changed.)

---

## Demo / manual verification (controller runs post-merge; not a subagent task)

The seeded Slice-1 inbound workflow already emits `data.persisted` on each run. To see the Event Trigger fire:
1. Extend `scripts/seed-form-ingestion-demo.ts` to also create a second workflow **"Demo: On Persist → Log"** with nodes: Event Trigger (`config: { event: 'data.persisted', source: 'demo-lab' }`) → a `log` node. Index it (the server does this on save/boot).
2. A one-shot verify (against the live DB): `createAppContext(cfg)` → `await ctx.workflows.runner.registerRunner(ctx.eventing)` → `setEventWorkflowIds([<event wf id>])` → run the inbound workflow (`runAndRecord(inboundId, 'manual', {})`, which publishes `data.persisted`) → `await ctx.eventing.drain()` (dispatches the event to the subscriber) → assert the event workflow now has a run record (`ctx.workflows.runs.list(eventWfId)` length increased). PASS = the loop fired without a Run press.

---

## Done criteria for Slice 2

- `event` is a valid `TriggerSource`; the runner fires matching event-trigger workflows on `data.persisted` (filters honored).
- Event-trigger workflows are indexed at boot and on every create/update/delete.
- The builder palette includes a draggable Event Trigger; its config form edits `event`/`source`/`resourceType`.
- `pnpm exec turbo typecheck --force` and the workflows/server/web suites are green.
