# Workflow Listener Triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `postgres-trigger` (Postgres `LISTEN/NOTIFY`) and `email-trigger` (IMAP poll) via a shared host-side listener manager that owns connection lifecycle and calls the existing `runAndRecord`.

**Architecture:** A `WorkflowListenerManager` (bootstrap) derives listener specs from enabled workflow definitions, keeps one persistent listener per spec (started via a per-`triggerType` driver), reconciles on boot + after every workflow save, and stops all on shutdown. Two drivers: a raw node-postgres `Client` doing `LISTEN`, and an `imapflow` poll loop. Both resolve their connector's decrypted config at start.

**Tech Stack:** TypeScript, `@openldr/bootstrap`, `@openldr/config`, `@openldr/workflows`, node-postgres (`pg`), `imapflow` + `mailparser`, React (builder), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-01-workflow-listener-triggers-design.md`

---

## Background the implementer needs

- **Existing triggers** are event-driven: `packages/workflows/src/trigger-runner.ts` subscribes schedule/ingest/event to an internal `EventingPort`. Listener triggers do NOT use the EventingPort — they own external connections. `runAndRecord(workflowId, source, input, files?)` is exported on the `WorkflowTriggerRunner` (already handles run + record + failure capture); reuse it as the fire callback.
- **Connector resolution** (mirror `packages/bootstrap/src/connector-sql-service.ts`): `connectors.get(id) → { type, enabled } | null`; `connectors.getDecryptedConfig(id, secretsKey) → Record<string,string>`. Bad/missing/disabled connector → the driver's `start` throws; the manager catches + logs + skips.
- **pg connection**: reuse `buildPgUrl(config)` + `validatePort` from `packages/bootstrap/src/connector-db.ts`.
- **Binary attachments**: the injected `writeBinary({ bytes, fileName, contentType }) → BinaryRef` (Slice C, on `WorkflowServices`) materializes a file; `runAndRecord`'s `files` param seeds them onto the trigger item's `binary` channel (like the ingest trigger, see trigger-runner `INGEST_DONE`).
- **Boot sequence**: `apps/server/src/index.ts` calls `ctx.workflows.runner.registerRunner` → `setIngest/EventWorkflowIds` → `runner.reconcile`. It has a `close()` on SIGTERM/SIGINT that calls `ctx.close()`. `apps/server/src/workflows-routes.ts` `syncWorkflowTriggers` + `setIngest/EventWorkflowIds` re-sync on create/update/delete.
- **Connector test probe**: `packages/bootstrap/src/connector-test.ts` `testConnector(type, config, deps)` with injectable per-type deps.
- **Web connectors**: `apps/web/src/pages/settings/Connectors.tsx` — `HOST_TYPES` (product-name labels, not i18n'd) + `CONNECTOR_TYPE_FIELDS: Record<string, TypeField[]>` (`{ key, labelKey, kind }`). Reuse `settings.connectors.fieldHost/fieldPort/fieldUser/fieldPassword/fieldSecure` (no new i18n keys).
- **Node forms**: registered by template id in `apps/web/src/workflows/components/node-forms/index.tsx` `FORMS`. Trigger nodes carry `data.triggerType` + `data.config`.

### File map
- `packages/workflows/src/types.ts` — `TRIGGER_SOURCES` += `postgres`,`email`.
- `packages/config/src/schema.ts` (+ test) — 3 knobs.
- Create `packages/bootstrap/src/workflow-listeners.ts` (+ test) — manager + driver interface.
- Create `packages/bootstrap/src/listener-postgres.ts` (+ test) — pg driver.
- Create `packages/bootstrap/src/listener-email.ts` (+ test) — IMAP driver.
- `packages/bootstrap/src/connector-test.ts` (+ test) — `imap` probe.
- `packages/bootstrap/src/index.ts` — construct + expose `ctx.workflows.listeners`; stop on close.
- `apps/server/src/index.ts` — reconcile on boot.
- `apps/server/src/workflows-routes.ts` — reconcile on save.
- Web: `node-forms/postgres-trigger-form.tsx` + `email-trigger-form.tsx` + register; `Connectors.tsx` imap fields + HOST_TYPES; `constants.ts` palette + IMPLEMENTED; `lib/types.ts` trigger union.
- `packages/bootstrap/package.json` — deps `pg`, `imapflow`, `mailparser` (+ `@types/pg`).

---

## Task 1: `TriggerSource` values + config knobs

**Files:**
- Modify: `packages/workflows/src/types.ts`
- Modify: `packages/config/src/schema.ts`
- Test: `packages/config/src/schema.test.ts`

- [ ] **Step 1: Write the failing config test** — append to `schema.test.ts` inside the existing `'workflow code sandbox config'` describe (mirror the neighbors using `ConfigSchema.parse(base)`):
```ts
  it('defaults listener knobs', () => {
    const c = ConfigSchema.parse(base);
    expect(c.WORKFLOW_LISTENERS_ENABLED).toBe(true);
    expect(c.WORKFLOW_EMAIL_POLL_MIN_SECONDS).toBe(30);
    expect(c.WORKFLOW_EMAIL_MAX_PER_POLL).toBe(50);
  });
  it('coerces listener knob overrides', () => {
    const c = ConfigSchema.parse({ ...base, WORKFLOW_EMAIL_POLL_MIN_SECONDS: '15', WORKFLOW_EMAIL_MAX_PER_POLL: '10', WORKFLOW_LISTENERS_ENABLED: 'false' });
    expect(c.WORKFLOW_EMAIL_POLL_MIN_SECONDS).toBe(15);
    expect(c.WORKFLOW_EMAIL_MAX_PER_POLL).toBe(10);
    expect(c.WORKFLOW_LISTENERS_ENABLED).toBe(false);
  });
```

- [ ] **Step 2: Run to verify it fails**
Run: `pnpm -C packages/config exec vitest run` → FAIL (undefined knobs).

- [ ] **Step 3: Add the knobs** in `packages/config/src/schema.ts`, after `WORKFLOW_LOOP_MAX_ITEMS` (use `envBoolean` — already imported/used for `WORKFLOW_CODE_ENABLED`):
```ts
    // Master switch for external listener triggers (postgres LISTEN / IMAP poll).
    WORKFLOW_LISTENERS_ENABLED: envBoolean(true),
    // Floor for an email-trigger's poll interval (seconds).
    WORKFLOW_EMAIL_POLL_MIN_SECONDS: z.coerce.number().int().positive().default(30),
    // Max unseen messages processed per email-trigger poll.
    WORKFLOW_EMAIL_MAX_PER_POLL: z.coerce.number().int().positive().default(50),
```
Confirm `envBoolean(true)` supports a `true` default (check its signature; the existing `WORKFLOW_CODE_ENABLED: envBoolean(false)` proves the helper — pass `true`). If `envBoolean` takes no arg, use the same pattern the file uses for a default-true boolean; if none exists, use `z.coerce.boolean()`-equivalent already in the file. Match the file's real helper.

- [ ] **Step 4: Add TriggerSource values** in `packages/workflows/src/types.ts`:
```ts
export const TRIGGER_SOURCES = ['manual', 'schedule', 'webhook', 'ingest', 'event', 'postgres', 'email'] as const;
```

- [ ] **Step 5: Gate**
Run: `pnpm -C packages/config exec vitest run` → PASS.
Run: `pnpm -C packages/config exec tsc --noEmit` → 0 errors.
Run: `pnpm -C packages/workflows exec tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**
```bash
git add packages/workflows/src/types.ts packages/config/src/schema.ts packages/config/src/schema.test.ts
git commit -m "feat(config): listener trigger knobs + postgres/email TriggerSource values"
```

---

## Task 2: Listener manager foundation

**Files:**
- Create: `packages/bootstrap/src/workflow-listeners.ts`
- Test: `packages/bootstrap/src/workflow-listeners.test.ts`

- [ ] **Step 1: Write the failing test** — create `workflow-listeners.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createWorkflowListenerManager, extractListenerSpecs, type ListenerDriver } from './workflow-listeners';

const wf = (id: string, enabled: boolean, nodes: unknown[]) => ({ id, enabled, definition: { nodes, edges: [] } });
const pgNode = (nodeId: string, connectorId = 'c1', channel = 'ch') =>
  ({ id: nodeId, type: 'trigger', data: { triggerType: 'postgres', config: { connectorId, channel } } });

function fakeDriver() {
  const stops: string[] = [];
  const starts: string[] = [];
  const driver: ListenerDriver = {
    async start(spec, _onFire) {
      starts.push(`${spec.workflowId}:${spec.nodeId}`);
      return { stop: async () => { stops.push(`${spec.workflowId}:${spec.nodeId}`); } };
    },
  };
  return { driver, starts, stops };
}

describe('extractListenerSpecs', () => {
  it('collects postgres/email trigger nodes from enabled workflows only', () => {
    const specs = extractListenerSpecs([
      wf('w1', true, [pgNode('n1'), { id: 'x', type: 'action', data: {} }]),
      wf('w2', false, [pgNode('n2')]),
      wf('w3', true, [{ id: 'e1', type: 'trigger', data: { triggerType: 'email', config: { connectorId: 'c2' } } }]),
    ]);
    expect(specs.map((s) => `${s.workflowId}:${s.nodeId}:${s.triggerType}`).sort())
      .toEqual(['w1:n1:postgres', 'w3:e1:email']);
  });
});

describe('listener manager sync', () => {
  const deps = (driver: ListenerDriver, list: unknown[]) => ({
    store: { list: vi.fn(async () => list) },
    runAndRecord: vi.fn(async () => {}),
    logger: { error: vi.fn(), warn: vi.fn() },
    cfg: { WORKFLOW_LISTENERS_ENABLED: true },
    drivers: { postgres: driver, email: driver },
  });

  it('starts a listener per spec on reconcile', async () => {
    const { driver, starts } = fakeDriver();
    const m = createWorkflowListenerManager(deps(driver, [wf('w1', true, [pgNode('n1')])]) as never);
    await m.reconcile();
    expect(starts).toEqual(['w1:n1']);
  });

  it('stops removed and restarts changed listeners on re-reconcile', async () => {
    const { driver, starts, stops } = fakeDriver();
    const store = { list: vi.fn() };
    const d = deps(driver, []) as never;
    (d as { store: unknown }).store = store;
    const m = createWorkflowListenerManager(d);
    store.list.mockResolvedValueOnce([wf('w1', true, [pgNode('n1', 'c1', 'chA')])]);
    await m.reconcile();
    // config change → restart; and w2 added, w1 stays if unchanged
    store.list.mockResolvedValueOnce([wf('w1', true, [pgNode('n1', 'c1', 'chB')])]);
    await m.reconcile();
    expect(starts).toEqual(['w1:n1', 'w1:n1']); // started, then restarted
    expect(stops).toEqual(['w1:n1']);           // old one stopped on restart
  });

  it('master switch off → no listeners', async () => {
    const { driver, starts } = fakeDriver();
    const d = deps(driver, [wf('w1', true, [pgNode('n1')])]) as never;
    (d as { cfg: { WORKFLOW_LISTENERS_ENABLED: boolean } }).cfg.WORKFLOW_LISTENERS_ENABLED = false;
    const m = createWorkflowListenerManager(d);
    await m.reconcile();
    expect(starts).toEqual([]);
  });

  it('a driver start failure is logged and skipped (no throw)', async () => {
    const bad: ListenerDriver = { async start() { throw new Error('bad connector'); } };
    const d = deps(bad, [wf('w1', true, [pgNode('n1')])]) as never;
    const m = createWorkflowListenerManager(d);
    await expect(m.reconcile()).resolves.toBeUndefined();
    expect((d as { logger: { error: ReturnType<typeof vi.fn> } }).logger.error).toHaveBeenCalled();
  });

  it('stopAll stops every active listener', async () => {
    const { driver, stops } = fakeDriver();
    const m = createWorkflowListenerManager(deps(driver, [wf('w1', true, [pgNode('n1')])]) as never);
    await m.reconcile();
    await m.stopAll();
    expect(stops).toEqual(['w1:n1']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `pnpm -C packages/bootstrap exec vitest run src/workflow-listeners.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `workflow-listeners.ts`**:
```ts
import type { BinaryRef } from '@openldr/workflows';

export interface ListenerSpec {
  workflowId: string;
  nodeId: string;
  triggerType: 'postgres' | 'email';
  config: Record<string, unknown>;
}
export type OnFire = (input: unknown, files?: Record<string, BinaryRef>) => Promise<void>;
export interface ListenerHandle { stop(): Promise<void>; }
export interface ListenerDriver { start(spec: ListenerSpec, onFire: OnFire): Promise<ListenerHandle>; }

interface WorkflowRow { id: string; enabled: boolean; definition: unknown }

/** Pull every postgres/email trigger node out of the enabled workflows. */
export function extractListenerSpecs(rows: WorkflowRow[]): ListenerSpec[] {
  const out: ListenerSpec[] = [];
  for (const w of rows) {
    if (!w.enabled) continue;
    const nodes = ((w.definition as { nodes?: unknown[] } | null)?.nodes ?? []) as Array<{
      id?: string; type?: string; data?: { triggerType?: string; config?: Record<string, unknown> };
    }>;
    for (const n of nodes) {
      const tt = n.data?.triggerType;
      if (n.type === 'trigger' && (tt === 'postgres' || tt === 'email') && n.id) {
        out.push({ workflowId: w.id, nodeId: n.id, triggerType: tt, config: n.data?.config ?? {} });
      }
    }
  }
  return out;
}

export interface ListenerManagerDeps {
  store: { list(): Promise<WorkflowRow[]> };
  runAndRecord: (workflowId: string, source: 'postgres' | 'email', input: unknown, files?: Record<string, BinaryRef>) => Promise<void>;
  logger: { error(o: unknown, m?: string): void; warn(o: unknown, m?: string): void };
  cfg: { WORKFLOW_LISTENERS_ENABLED: boolean };
  drivers: { postgres: ListenerDriver; email: ListenerDriver };
}

export interface WorkflowListenerManager {
  reconcile(): Promise<void>;
  stopAll(): Promise<void>;
}

const keyOf = (s: ListenerSpec) => `${s.workflowId}:${s.nodeId}`;

export function createWorkflowListenerManager(deps: ListenerManagerDeps): WorkflowListenerManager {
  const active = new Map<string, { hash: string; handle: ListenerHandle }>();

  async function startOne(spec: ListenerSpec): Promise<void> {
    const driver = deps.drivers[spec.triggerType];
    try {
      const handle = await driver.start(spec, (input, files) =>
        deps.runAndRecord(spec.workflowId, spec.triggerType, input, files));
      active.set(keyOf(spec), { hash: JSON.stringify(spec.config), handle });
    } catch (err) {
      deps.logger.error({ err, workflowId: spec.workflowId, nodeId: spec.nodeId }, 'listener start failed');
    }
  }

  async function stopKey(key: string): Promise<void> {
    const cur = active.get(key);
    if (!cur) return;
    active.delete(key);
    try { await cur.handle.stop(); } catch (err) { deps.logger.warn({ err, key }, 'listener stop failed'); }
  }

  return {
    async reconcile() {
      if (!deps.cfg.WORKFLOW_LISTENERS_ENABLED) { await this.stopAll(); return; }
      const specs = extractListenerSpecs(await deps.store.list());
      const desired = new Map(specs.map((s) => [keyOf(s), s]));
      // Stop removed or config-changed.
      for (const [key, cur] of [...active]) {
        const want = desired.get(key);
        if (!want || JSON.stringify(want.config) !== cur.hash) await stopKey(key);
      }
      // Start new (or restart the ones just stopped due to a config change).
      for (const [key, spec] of desired) {
        if (!active.has(key)) await startOne(spec);
      }
    },
    async stopAll() {
      for (const key of [...active.keys()]) await stopKey(key);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm -C packages/bootstrap exec vitest run src/workflow-listeners.test.ts` → PASS.

- [ ] **Step 5: Typecheck**
Run: `pnpm -C packages/bootstrap exec tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**
```bash
git add packages/bootstrap/src/workflow-listeners.ts packages/bootstrap/src/workflow-listeners.test.ts
git commit -m "feat(bootstrap): workflow listener manager (spec extraction, sync/reconcile, stopAll)"
```

---

## Task 3: Postgres `LISTEN` driver

**Files:**
- Modify: `packages/bootstrap/package.json` (deps `pg` + `@types/pg`)
- Create: `packages/bootstrap/src/listener-postgres.ts`
- Test: `packages/bootstrap/src/listener-postgres.test.ts`

- [ ] **Step 1: Add deps**
Run: `pnpm -C packages/bootstrap add pg && pnpm -C packages/bootstrap add -D @types/pg`
(If offline/registry issues, add `"pg": "^8.13.0"` to dependencies and `"@types/pg": "^8.11.0"` to devDependencies in `packages/bootstrap/package.json`, then `pnpm install` at the repo root.)

- [ ] **Step 2: Write the failing test** — create `listener-postgres.test.ts`. It injects a fake pg `Client` factory + a fake connector store:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createPostgresListenerDriver, parseNotifyPayload, validateChannel } from './listener-postgres';

describe('parseNotifyPayload', () => {
  it('parses JSON objects and wraps non-JSON', () => {
    expect(parseNotifyPayload('ch', '{"a":1}')).toEqual({ channel: 'ch', a: 1 });
    expect(parseNotifyPayload('ch', 'hello')).toEqual({ channel: 'ch', payload: 'hello' });
    expect(parseNotifyPayload('ch', '')).toEqual({ channel: 'ch', payload: '' });
    expect(parseNotifyPayload('ch', '[1,2]')).toEqual({ channel: 'ch', payload: '[1,2]' }); // non-object JSON → wrapped
  });
});

describe('validateChannel', () => {
  it('accepts identifiers, rejects injection', () => {
    expect(() => validateChannel('my_channel')).not.toThrow();
    expect(() => validateChannel('bad-name')).toThrow(/invalid channel/);
    expect(() => validateChannel('a"; DROP')).toThrow(/invalid channel/);
  });
});

describe('postgres listener driver', () => {
  function fakeClient() {
    const handlers: Record<string, (arg: unknown) => void> = {};
    return {
      connect: vi.fn(async () => {}),
      query: vi.fn(async () => ({})),
      on: vi.fn((evt: string, cb: (arg: unknown) => void) => { handlers[evt] = cb; }),
      removeAllListeners: vi.fn(),
      end: vi.fn(async () => {}),
      emit: (evt: string, arg: unknown) => handlers[evt]?.(arg),
    };
  }
  const connectors = {
    get: vi.fn(async () => ({ type: 'postgres', enabled: true })),
    getDecryptedConfig: vi.fn(async () => ({ host: 'h', port: '5432', database: 'd', user: 'u', password: 'p' })),
  };

  it('LISTENs and fires onFire on notification', async () => {
    const client = fakeClient();
    const driver = createPostgresListenerDriver({ connectors, secretsKey: 'k', logger: { error: vi.fn(), warn: vi.fn() }, makeClient: () => client as never });
    const onFire = vi.fn(async () => {});
    const handle = await driver.start({ workflowId: 'w', nodeId: 'n', triggerType: 'postgres', config: { connectorId: 'c1', channel: 'ch' } }, onFire);
    expect(client.connect).toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('LISTEN "ch"');
    client.emit('notification', { channel: 'ch', payload: '{"x":1}' });
    await new Promise((r) => setTimeout(r, 0));
    expect(onFire).toHaveBeenCalledWith({ channel: 'ch', x: 1 }, undefined);
    await handle.stop();
    expect(client.end).toHaveBeenCalled();
  });

  it('throws when the connector is the wrong type', async () => {
    const driver = createPostgresListenerDriver({
      connectors: { get: vi.fn(async () => ({ type: 'mysql', enabled: true })), getDecryptedConfig: vi.fn(async () => ({})) },
      secretsKey: 'k', logger: { error: vi.fn(), warn: vi.fn() }, makeClient: () => fakeClient() as never,
    });
    await expect(driver.start({ workflowId: 'w', nodeId: 'n', triggerType: 'postgres', config: { connectorId: 'c1', channel: 'ch' } }, vi.fn())).rejects.toThrow(/postgres connector/);
  });
});
```

- [ ] **Step 3: Implement `listener-postgres.ts`**:
```ts
import { Client } from 'pg';
import { buildPgUrl } from './connector-db';
import type { ListenerDriver, ListenerHandle, ListenerSpec, OnFire } from './workflow-listeners';

const CHANNEL_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateChannel(channel: string): string {
  if (!CHANNEL_RE.test(channel)) throw new Error(`Postgres trigger: invalid channel: ${channel}`);
  return channel;
}

/** NOTIFY payload → run input. JSON objects are spread; anything else is wrapped. `channel` is always attached. */
export function parseNotifyPayload(channel: string, payload: string): Record<string, unknown> {
  try {
    const v = JSON.parse(payload);
    if (v && typeof v === 'object' && !Array.isArray(v)) return { channel, ...(v as Record<string, unknown>) };
  } catch { /* not JSON */ }
  return { channel, payload };
}

export interface PostgresDriverDeps {
  connectors: {
    get(id: string): Promise<{ type: string | null; enabled: boolean } | null>;
    getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>>;
  };
  secretsKey: string | undefined;
  logger: { error(o: unknown, m?: string): void; warn(o: unknown, m?: string): void };
  /** Injectable for tests. */
  makeClient?: (connectionString: string) => Client;
}

const BACKOFF_START = 1000;
const BACKOFF_MAX = 30_000;

export function createPostgresListenerDriver(deps: PostgresDriverDeps): ListenerDriver {
  const make = deps.makeClient ?? ((cs: string) => new Client({ connectionString: cs }));
  return {
    async start(spec: ListenerSpec, onFire: OnFire): Promise<ListenerHandle> {
      const connectorId = String(spec.config.connectorId ?? '');
      const channel = validateChannel(String(spec.config.channel ?? ''));
      const c = await deps.connectors.get(connectorId);
      if (!c || !c.enabled) throw new Error(`Postgres trigger: connector ${connectorId} not found or disabled`);
      if (c.type !== 'postgres') throw new Error(`Postgres trigger: connector ${connectorId} is not a postgres connector`);
      const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
      const url = buildPgUrl(config);

      let client: Client | null = null;
      let stopped = false;
      let backoff = BACKOFF_START;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;

      const connect = async (): Promise<void> => {
        if (stopped) return;
        const cl = make(url);
        client = cl;
        cl.on('notification', (msg: { channel?: string; payload?: string }) => {
          void onFire(parseNotifyPayload(msg.channel ?? channel, msg.payload ?? ''), undefined)
            .catch((err) => deps.logger.error({ err, workflowId: spec.workflowId }, 'postgres trigger run failed'));
        });
        cl.on('error', (err: unknown) => { deps.logger.warn({ err, workflowId: spec.workflowId }, 'postgres listener error'); scheduleReconnect(); });
        cl.on('end', () => scheduleReconnect());
        await cl.connect();
        await cl.query(`LISTEN "${channel}"`);
        backoff = BACKOFF_START; // reset on a clean connect
      };

      const scheduleReconnect = (): void => {
        if (stopped || retryTimer) return;
        const old = client; client = null;
        if (old) { old.removeAllListeners(); old.end().catch(() => {}); }
        retryTimer = setTimeout(() => {
          retryTimer = null;
          connect().catch((err) => { deps.logger.warn({ err, workflowId: spec.workflowId }, 'postgres listener reconnect failed'); scheduleReconnect(); });
        }, backoff);
        backoff = Math.min(backoff * 2, BACKOFF_MAX);
      };

      await connect();
      return {
        async stop() {
          stopped = true;
          if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
          const cl = client; client = null;
          if (cl) { cl.removeAllListeners(); await cl.end().catch(() => {}); }
        },
      };
    },
  };
}
```

- [ ] **Step 4: Run test + typecheck**
Run: `pnpm -C packages/bootstrap exec vitest run src/listener-postgres.test.ts` → PASS.
Run: `pnpm -C packages/bootstrap exec tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**
```bash
git add packages/bootstrap/package.json packages/bootstrap/src/listener-postgres.ts packages/bootstrap/src/listener-postgres.test.ts ../../pnpm-lock.yaml
git commit -m "feat(bootstrap): postgres LISTEN/NOTIFY listener driver"
```

---

## Task 4: IMAP poll (email) driver

**Files:**
- Modify: `packages/bootstrap/package.json` (deps `imapflow` + `mailparser`)
- Create: `packages/bootstrap/src/listener-email.ts`
- Test: `packages/bootstrap/src/listener-email.test.ts`

- [ ] **Step 1: Add deps**
Run: `pnpm -C packages/bootstrap add imapflow mailparser`
(`imapflow` ships its own types; `mailparser` types are bundled. If a type is missing at tsc, add a minimal `declare module 'mailparser'`/`'imapflow'` ambient in `packages/bootstrap/src/` with a `/// <reference>` from `listener-email.ts` — same pattern as the Slice-C `pdf-parse.d.ts`.)

- [ ] **Step 2: Write the failing test** — create `listener-email.test.ts`. It injects a fake IMAP client + a fake `simpleParser` + a fake `writeBinary`, and drives ONE poll directly (via an exported `pollOnce`):
```ts
import { describe, it, expect, vi } from 'vitest';
import { pollOnce, clampPollSeconds } from './listener-email';

describe('clampPollSeconds', () => {
  it('floors to the min and defaults', () => {
    expect(clampPollSeconds(undefined, 30)).toBe(60);   // default 60 when unset
    expect(clampPollSeconds(5, 30)).toBe(30);            // below min → min
    expect(clampPollSeconds(120, 30)).toBe(120);
  });
});

describe('email pollOnce', () => {
  function fakeImap(uids: number[], sources: Record<number, Buffer>) {
    const seen: number[] = [];
    return {
      seen,
      connect: vi.fn(async () => {}),
      logout: vi.fn(async () => {}),
      getMailboxLock: vi.fn(async () => ({ release: () => {} })),
      search: vi.fn(async () => uids),
      download: vi.fn(async (uid: number) => ({ content: bufToStream(sources[uid]) })),
      messageFlagsAdd: vi.fn(async (uid: number) => { seen.push(uid); }),
    };
  }
  function bufToStream(buf: Buffer) { const { Readable } = require('node:stream'); return Readable.from([buf]); }

  const parser = vi.fn(async () => ({
    from: { text: 'a@b.c' }, to: { text: 'x@y.z' }, subject: 'hi', date: new Date(0),
    text: 'body', html: '<p>body</p>', headerLines: [],
    attachments: [{ filename: 'f.txt', contentType: 'text/plain', content: Buffer.from('att'), size: 3 }],
  }));

  it('fetches unseen, fires onFire with materialized attachments, marks seen AFTER onFire', async () => {
    const client = fakeImap([1], { 1: Buffer.from('raw') });
    const order: string[] = [];
    const onFire = vi.fn(async () => { order.push('fired'); });
    const writeBinary = vi.fn(async () => { order.push('wrote'); return { objectKey: 'k', contentType: 'text/plain', fileName: 'f.txt', byteSize: 3 }; });
    await pollOnce({
      client: client as never, parser: parser as never, folder: 'INBOX', markSeen: true, maxPerPoll: 50, maxBytes: 1_000,
      onFire, writeBinary, logger: { error: vi.fn(), warn: vi.fn() },
    });
    expect(onFire).toHaveBeenCalledTimes(1);
    const [input, files] = onFire.mock.calls[0];
    expect(input).toMatchObject({ subject: 'hi', from: 'a@b.c', text: 'body' });
    expect(files.attachment_0).toMatchObject({ objectKey: 'k' });
    expect(client.seen).toEqual([1]);                    // marked seen
    expect(order).toEqual(['wrote', 'fired']);           // wrote attachment, then fired; seen happens after
  });

  it('skips oversize attachments', async () => {
    const client = fakeImap([1], { 1: Buffer.from('raw') });
    const onFire = vi.fn(async () => {});
    const writeBinary = vi.fn(async () => ({ objectKey: 'k', contentType: 'text/plain', byteSize: 3 }));
    await pollOnce({
      client: client as never, parser: parser as never, folder: 'INBOX', markSeen: true, maxPerPoll: 50, maxBytes: 1, // tiny cap
      onFire, writeBinary, logger: { error: vi.fn(), warn: vi.fn() },
    });
    expect(writeBinary).not.toHaveBeenCalled();          // 3-byte attachment > 1-byte cap → skipped
    const [, files] = onFire.mock.calls[0];
    expect(files).toEqual({});
  });
});
```

- [ ] **Step 3: Implement `listener-email.ts`**:
```ts
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { BinaryRef } from '@openldr/workflows';
import type { ListenerDriver, ListenerHandle, ListenerSpec, OnFire } from './workflow-listeners';

export function clampPollSeconds(raw: number | undefined, min: number): number {
  const n = Number.isFinite(raw) ? Math.floor(raw as number) : 60;
  return Math.max(min, n > 0 ? n : 60);
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks);
}

export interface PollOnceArgs {
  client: ImapFlow;
  parser: typeof simpleParser;
  folder: string;
  markSeen: boolean;
  maxPerPoll: number;
  maxBytes: number;
  onFire: OnFire;
  writeBinary: (input: { bytes: Uint8Array; fileName: string; contentType: string }) => Promise<BinaryRef>;
  logger: { error(o: unknown, m?: string): void; warn(o: unknown, m?: string): void };
}

/** One poll cycle: connect must already be done by the caller; searches UNSEEN, fires per message, marks seen after. */
export async function pollOnce(args: PollOnceArgs): Promise<void> {
  const lock = await args.client.getMailboxLock(args.folder);
  try {
    const uids = (await args.client.search({ seen: false }, { uid: true })) || [];
    for (const uid of uids.slice(0, args.maxPerPoll)) {
      const dl = await args.client.download(String(uid), undefined, { uid: true });
      const raw = await streamToBuffer(dl.content);
      const mail = await args.parser(raw);
      const files: Record<string, BinaryRef> = {};
      const attachmentsMeta: Array<{ field: string; fileName: string; contentType: string; byteSize: number }> = [];
      let i = 0;
      for (const att of mail.attachments ?? []) {
        const bytes = att.content as Buffer;
        if (bytes.byteLength > args.maxBytes) { args.logger.warn({ fileName: att.filename }, 'email attachment exceeds size cap; skipped'); continue; }
        const field = `attachment_${i++}`;
        const ref = await args.writeBinary({ bytes, fileName: att.filename ?? field, contentType: att.contentType ?? 'application/octet-stream' });
        files[field] = ref;
        attachmentsMeta.push({ field, fileName: ref.fileName ?? att.filename ?? field, contentType: ref.contentType, byteSize: ref.byteSize });
      }
      const input = {
        from: mail.from?.text ?? '', to: mail.to?.text ?? '', subject: mail.subject ?? '',
        date: mail.date?.toISOString() ?? '', text: mail.text ?? '', html: mail.html || '',
        headers: mail.headerLines ?? [], attachments: attachmentsMeta,
      };
      await args.onFire(input, Object.keys(files).length ? files : {});
      if (args.markSeen) await args.client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    }
  } finally {
    lock.release();
  }
}

export interface EmailDriverDeps {
  connectors: {
    get(id: string): Promise<{ type: string | null; enabled: boolean } | null>;
    getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>>;
  };
  secretsKey: string | undefined;
  writeBinary: PollOnceArgs['writeBinary'];
  logger: PollOnceArgs['logger'];
  cfg: { WORKFLOW_EMAIL_POLL_MIN_SECONDS: number; WORKFLOW_EMAIL_MAX_PER_POLL: number; WORKFLOW_FILE_MAX_BYTES: number };
  /** Injectable for tests. */
  makeClient?: (config: Record<string, string>) => ImapFlow;
}

export function createEmailListenerDriver(deps: EmailDriverDeps): ListenerDriver {
  const make = deps.makeClient ?? ((config) => new ImapFlow({
    host: config.host ?? 'localhost',
    port: Number(config.port ?? 993),
    secure: config.tls !== 'false',
    auth: { user: config.user ?? '', pass: config.password ?? '' },
    logger: false,
  }));
  return {
    async start(spec: ListenerSpec, onFire: OnFire): Promise<ListenerHandle> {
      const connectorId = String(spec.config.connectorId ?? '');
      const c = await deps.connectors.get(connectorId);
      if (!c || !c.enabled) throw new Error(`Email trigger: connector ${connectorId} not found or disabled`);
      if (c.type !== 'imap') throw new Error(`Email trigger: connector ${connectorId} is not an imap connector`);
      const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
      const folder = String(spec.config.folder ?? 'INBOX') || 'INBOX';
      const markSeen = spec.config.markSeen !== false;
      const pollMs = clampPollSeconds(spec.config.pollSeconds as number | undefined, deps.cfg.WORKFLOW_EMAIL_POLL_MIN_SECONDS) * 1000;

      let stopped = false;
      let polling = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const tick = async (): Promise<void> => {
        if (stopped || polling) { schedule(); return; }
        polling = true;
        const client = make(config);
        try {
          await client.connect();
          await pollOnce({
            client, parser: simpleParser, folder, markSeen,
            maxPerPoll: deps.cfg.WORKFLOW_EMAIL_MAX_PER_POLL, maxBytes: deps.cfg.WORKFLOW_FILE_MAX_BYTES,
            onFire, writeBinary: deps.writeBinary, logger: deps.logger,
          });
        } catch (err) {
          deps.logger.warn({ err, workflowId: spec.workflowId }, 'email poll failed');
        } finally {
          await client.logout().catch(() => {});
          polling = false;
          schedule();
        }
      };
      const schedule = (): void => { if (!stopped && !timer) timer = setTimeout(() => { timer = null; void tick(); }, pollMs); };

      // Kick off the first poll on the next tick (don't block start()).
      timer = setTimeout(() => { timer = null; void tick(); }, 0);
      return {
        async stop() { stopped = true; if (timer) { clearTimeout(timer); timer = null; } },
      };
    },
  };
}
```
(Note: `imapflow`'s `search`/`download`/`messageFlagsAdd` signatures — verify against the installed version's types at tsc time and adjust the `{ uid: true }` option shape / `download` args if the types differ. The `pollOnce` unit test mocks the client, so the real signatures only need to satisfy tsc in the driver.)

- [ ] **Step 4: Run test + typecheck**
Run: `pnpm -C packages/bootstrap exec vitest run src/listener-email.test.ts` → PASS.
Run: `pnpm -C packages/bootstrap exec tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**
```bash
git add packages/bootstrap/package.json packages/bootstrap/src/listener-email.ts packages/bootstrap/src/listener-email.test.ts ../../pnpm-lock.yaml
git commit -m "feat(bootstrap): IMAP poll (email) listener driver"
```

---

## Task 5: `imap` connector test probe

**Files:**
- Modify: `packages/bootstrap/src/connector-test.ts`
- Test: `packages/bootstrap/src/connector-test.test.ts`

- [ ] **Step 1: Write the failing test** — add to `connector-test.test.ts` a case mirroring the existing `sftp` probe test, injecting an `imap` dep:
```ts
  it('probes an imap connector (connect + logout)', async () => {
    const connect = vi.fn(async () => {});
    const logout = vi.fn(async () => {});
    const getMailboxLock = vi.fn(async () => ({ release: () => {} }));
    await testConnector('imap', { host: 'h', port: '993', user: 'u', password: 'p', tls: 'true' }, {
      imap: () => ({ connect, logout, getMailboxLock } as never),
    });
    expect(connect).toHaveBeenCalled();
    expect(logout).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify it fails**
Run: `pnpm -C packages/bootstrap exec vitest run src/connector-test.test.ts` → FAIL (`imap` unsupported).

- [ ] **Step 3: Implement** — in `connector-test.ts`:
- Add to `ConnectorTestDeps`:
```ts
  imap?: (config: Record<string, string>) => { connect(): Promise<void>; logout(): Promise<void>; getMailboxLock(f: string): Promise<{ release(): void }> };
```
- Add a branch before the final throw:
```ts
  if (type === 'imap') {
    const { ImapFlow } = await import('imapflow');
    const client = (deps.imap ?? ((c) => new ImapFlow({ host: c.host ?? 'localhost', port: Number(c.port ?? 993), secure: c.tls !== 'false', auth: { user: c.user ?? '', pass: c.password ?? '' }, logger: false }) as never))(config);
    await client.connect();
    try { const lock = await client.getMailboxLock('INBOX'); lock.release(); } finally { await client.logout(); }
    return;
  }
```

- [ ] **Step 4: Run test + typecheck**
Run: `pnpm -C packages/bootstrap exec vitest run src/connector-test.test.ts` → PASS.
Run: `pnpm -C packages/bootstrap exec tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**
```bash
git add packages/bootstrap/src/connector-test.ts packages/bootstrap/src/connector-test.test.ts
git commit -m "feat(bootstrap): imap connector test probe"
```

---

## Task 6: Bootstrap + server wiring

**Files:**
- Modify: `packages/bootstrap/src/index.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/workflows-routes.ts`

- [ ] **Step 1: Construct the manager in `bootstrap/index.ts`.**
Read the file around the `workflowRunner`/`workflows` object (~line 410-416) and the `close`/teardown. Add imports:
```ts
import { createWorkflowListenerManager } from './workflow-listeners';
import { createPostgresListenerDriver } from './listener-postgres';
import { createEmailListenerDriver } from './listener-email';
```
After `workflowServices` is fully wired (so `writeBinary` exists — it's set at the literal, see Slice C) and after `workflowRunner` is created, construct:
```ts
  const workflowListeners = createWorkflowListenerManager({
    store: { list: () => workflowStore.list() },
    runAndRecord: (id, source, input, files) => workflowRunner.runAndRecord(id, source, input, files),
    logger,
    cfg,
    drivers: {
      postgres: createPostgresListenerDriver({ connectors: connectorStore, secretsKey: cfg.SECRETS_ENCRYPTION_KEY, logger }),
      email: createEmailListenerDriver({
        connectors: connectorStore, secretsKey: cfg.SECRETS_ENCRYPTION_KEY,
        writeBinary: (i) => workflowServices.writeBinary!(i),
        logger, cfg,
      }),
    },
  });
```
Add `listeners: workflowListeners` to the `workflows` object literal:
```ts
  const workflows = { store: workflowStore, runs: workflowRuns, /* … */ runner: workflowRunner, services: workflowServices, datasets: workflowDatasets, listeners: workflowListeners };
```
Verify `workflowStore.list()` exists and returns `{ id, enabled, definition }[]` (it's used by `listIngestWorkflowIds`). If its row shape differs, adapt the `store.list` adapter to map to `{ id, enabled, definition }`.
In `ctx.close` (the teardown function returned as `close`), add `await workflowListeners.stopAll();` before other teardown.
`TriggerSource` now includes `'postgres'|'email'`, so `runAndRecord`'s `source` param accepts them (Task 1). If `runAndRecord`'s signature typed `source` narrowly, it already takes `TriggerSource`.

- [ ] **Step 2: Reconcile on boot in `apps/server/src/index.ts`.**
After the existing `await ctx.workflows.runner.reconcile(ingest.eventing);` (~line 106), add:
```ts
  await ctx.workflows.listeners.reconcile();
```
(The `close` handler already calls `ctx.close()`, which now stops listeners — no server-file change needed for teardown.)

- [ ] **Step 3: Reconcile on save in `apps/server/src/workflows-routes.ts`.**
Everywhere the routes currently call `ctx.workflows.runner.setIngestWorkflowIds(...)` / `setEventWorkflowIds(...)` after a create/update/delete (there are several — search for `setIngestWorkflowIds`), add immediately after:
```ts
      await ctx.workflows.listeners.reconcile();
```
(Reconcile is idempotent + diff-based, so calling it after each mutation is safe and cheap.)

- [ ] **Step 4: Cross-package gate**
Run: `pnpm -C packages/bootstrap exec tsc --noEmit` → 0 errors.
Run: `pnpm -C apps/server exec tsc --noEmit` → 0 errors.
Run: `pnpm -C packages/bootstrap exec vitest run` → 0 failures (report count).
Run: `pnpm -C apps/server exec vitest run` → 0 failures (the workflows-routes test mock of `ctx.workflows.runner` may need a `listeners: { reconcile: async () => {} }` stub — add it to the test's ctx mock if tsc/tests complain).

- [ ] **Step 5: Commit**
```bash
git add packages/bootstrap/src/index.ts apps/server/src/index.ts apps/server/src/workflows-routes.ts apps/server/src/workflows-routes.test.ts
git commit -m "feat(bootstrap): wire the workflow listener manager (reconcile on boot + save, stop on close)"
```

---

## Task 7: Web — node forms, imap connector, palette

**Files:**
- Create: `apps/web/src/workflows/components/node-forms/postgres-trigger-form.tsx`
- Create: `apps/web/src/workflows/components/node-forms/email-trigger-form.tsx`
- Modify: `apps/web/src/workflows/components/node-forms/index.tsx`
- Modify: `apps/web/src/pages/settings/Connectors.tsx`
- Modify: `apps/web/src/workflows/constants.ts`
- Modify: `apps/web/src/workflows/lib/types.ts`
- Test: `apps/web/src/workflows/components/node-forms/listener-forms.test.tsx`

- [ ] **Step 1: Write the failing test** — create `listener-forms.test.tsx`. Render each form and assert it writes config via a captured `update`. Mirror an existing node-form test (e.g. `event-trigger-form.test.tsx`) for the render harness + the connector-options fetch mock (both forms fetch connectors via the same hook the DB node forms use — check how a DB/connector-backed form lists connectors; if they use `optionsSource`/`node-options`, mirror that; otherwise a plain fetch of `/api/connectors`). Assertions: postgres form renders a channel input that calls `update({ config: { ...connectorId, channel } })`; email form renders folder/pollSeconds/markSeen controls that call `update`.
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { PostgresTriggerForm } from './postgres-trigger-form';
import { EmailTriggerForm } from './email-trigger-form';

const node = (config: Record<string, unknown> = {}) => ({ id: 't', type: 'trigger', data: { label: 'x', triggerType: 'postgres', config } } as never);

describe('listener trigger forms', () => {
  it('postgres form writes the channel', () => {
    const update = vi.fn();
    const { getByLabelText } = render(<PostgresTriggerForm node={node()} update={update} />);
    fireEvent.change(getByLabelText(/channel/i), { target: { value: 'my_ch' } });
    expect(update).toHaveBeenCalledWith({ config: expect.objectContaining({ channel: 'my_ch' }) });
  });

  it('email form writes pollSeconds', () => {
    const update = vi.fn();
    const { getByLabelText } = render(<EmailTriggerForm node={node({ folder: 'INBOX' })} update={update} />);
    fireEvent.change(getByLabelText(/poll/i), { target: { value: '90' } });
    expect(update).toHaveBeenCalledWith({ config: expect.objectContaining({ pollSeconds: 90 }) });
  });
});
```
(If connector selection requires an async options fetch, mock it; keep the assertions on the plain inputs — channel and pollSeconds — which don't need the fetch.)

- [ ] **Step 2: Run to verify it fails**
Run: `pnpm -C apps/web exec vitest run src/workflows/components/node-forms/listener-forms.test.tsx` → FAIL (modules missing).

- [ ] **Step 3: Implement the two forms.** Mirror `wait-form.tsx`/`event-trigger-form.tsx` structure (`FormField`, `TextInput`, `Select` from `./shared`; `patchConfig` helper). For the connector picker, mirror how a DB node form (e.g. the postgres/sql node's declarative form) lists connectors of a given type — reuse that connector-select component/hook if one exists; otherwise a `Select` populated from a `/api/connectors?type=postgres` (or `imap`) fetch.

`postgres-trigger-form.tsx`:
```tsx
import type { NodeFormProps } from './index';
import type { TriggerNodeData } from '../../lib/types';
import { FormField, TextInput } from './shared';
import { ConnectorSelect } from './connector-select'; // reuse if it exists; else inline a Select of /api/connectors?type=postgres

export function PostgresTriggerForm({ node, update }: NodeFormProps) {
  const data = node.data as TriggerNodeData;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const patch = (p: Record<string, unknown>) => update({ config: { ...config, ...p } });
  return (
    <div className="space-y-4">
      <FormField label="Connector" hint="A Postgres connector to LISTEN on.">
        <ConnectorSelect type="postgres" value={(config.connectorId as string) ?? ''} onChange={(id) => patch({ connectorId: id })} />
      </FormField>
      <FormField label="Channel" hint="NOTIFY channel name (identifier). Your DB trigger must NOTIFY this channel.">
        <TextInput value={(config.channel as string) ?? ''} onChange={(e) => patch({ channel: e.target.value })} placeholder="my_channel" className="font-mono" />
      </FormField>
    </div>
  );
}
```
`email-trigger-form.tsx`:
```tsx
import type { NodeFormProps } from './index';
import type { TriggerNodeData } from '../../lib/types';
import { FormField, TextInput } from './shared';
import { ConnectorSelect } from './connector-select';

export function EmailTriggerForm({ node, update }: NodeFormProps) {
  const data = node.data as TriggerNodeData;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const patch = (p: Record<string, unknown>) => update({ config: { ...config, ...p } });
  return (
    <div className="space-y-4">
      <FormField label="Connector" hint="An IMAP connector to poll.">
        <ConnectorSelect type="imap" value={(config.connectorId as string) ?? ''} onChange={(id) => patch({ connectorId: id })} />
      </FormField>
      <FormField label="Folder"><TextInput value={(config.folder as string) ?? 'INBOX'} onChange={(e) => patch({ folder: e.target.value })} /></FormField>
      <FormField label="Poll seconds" hint="Minimum 30s."><TextInput type="number" min={30} value={(config.pollSeconds as number) ?? 60} onChange={(e) => patch({ pollSeconds: parseInt(e.target.value) || 60 })} /></FormField>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="markSeen" checked={config.markSeen !== false} onChange={(e) => patch({ markSeen: e.target.checked })} className="h-3.5 w-3.5 rounded border-border" />
        <label htmlFor="markSeen" className="text-xs text-muted-foreground">Mark processed emails as read</label>
      </div>
    </div>
  );
}
```
If a `ConnectorSelect` component does not already exist, create a minimal one under `node-forms/connector-select.tsx` that fetches `/api/connectors`, filters by `type`, and renders a shadcn `Select`. (Check first — the DB node forms already pick a connector; reuse their mechanism to avoid a second pattern.)
Register both in `node-forms/index.tsx` `FORMS`:
```ts
  'postgres-trigger': PostgresTriggerForm,
  'email-trigger': EmailTriggerForm,
```

- [ ] **Step 4: imap connector type** in `apps/web/src/pages/settings/Connectors.tsx`:
- Add to `HOST_TYPES`: `{ value: 'imap', label: 'IMAP Email' },`
- Add to `CONNECTOR_TYPE_FIELDS`:
```ts
  imap: [
    { key: 'host', labelKey: 'settings.connectors.fieldHost', kind: 'text' },
    { key: 'port', labelKey: 'settings.connectors.fieldPort', kind: 'number' },
    { key: 'user', labelKey: 'settings.connectors.fieldUser', kind: 'text' },
    { key: 'password', labelKey: 'settings.connectors.fieldPassword', kind: 'password' },
    { key: 'tls', labelKey: 'settings.connectors.fieldSecure', kind: 'boolean' },
  ],
```

- [ ] **Step 5: Palette + types** in `apps/web/src/workflows/constants.ts`:
- Reword + seed the two nodes (find the existing `email-trigger` + `postgres-trigger` entries):
```ts
      node('email-trigger', 'trigger', 'Email Trigger (IMAP)', 'Inbox', 'Trigger on new emails (IMAP poll)', {
        data: { triggerType: 'email', config: { folder: 'INBOX', pollSeconds: 60, markSeen: true } },
      }),
      node('postgres-trigger', 'trigger', 'Postgres Trigger', 'Database', 'Listen on a NOTIFY channel', {
        data: { triggerType: 'postgres', config: { channel: '' } },
      }),
```
- Add both ids to `IMPLEMENTED_TEMPLATE_IDS` (near the trigger group):
```ts
  'postgres-trigger', 'email-trigger',
```
In `apps/web/src/workflows/lib/types.ts`, widen `TriggerNodeData.triggerType`:
```ts
  triggerType: 'manual' | 'webhook' | 'schedule' | 'ingest' | 'event' | 'postgres' | 'email';
```

- [ ] **Step 6: Web gate**
Run: `pnpm -C apps/web exec tsc --noEmit` → 0 errors.
Run: `pnpm -C apps/web exec vitest run src/workflows src/pages/settings` → 0 failures (isolated; report count). (The `Connectors.test.tsx` may assert the HOST_TYPES list — update its expectation if it enumerates types.)

- [ ] **Step 7: Commit**
```bash
git add apps/web/src/workflows/components/node-forms/postgres-trigger-form.tsx apps/web/src/workflows/components/node-forms/email-trigger-form.tsx apps/web/src/workflows/components/node-forms/index.tsx apps/web/src/pages/settings/Connectors.tsx apps/web/src/workflows/constants.ts apps/web/src/workflows/lib/types.ts apps/web/src/workflows/components/node-forms/listener-forms.test.tsx
# include connector-select.tsx if created, and Connectors.test.tsx if updated
git commit -m "feat(web): postgres/email trigger forms + imap connector type + palette enablement"
```

---

## Task 8: Holistic gate + memory

- [ ] **Step 1: Full per-package gate**
```
pnpm -C packages/config exec tsc --noEmit && pnpm -C packages/config exec vitest run
pnpm -C packages/workflows exec tsc --noEmit && pnpm -C packages/workflows exec vitest run
pnpm -C packages/bootstrap exec tsc --noEmit && pnpm -C packages/bootstrap exec vitest run
pnpm -C apps/server exec tsc --noEmit && pnpm -C apps/server exec vitest run
pnpm -C apps/web exec tsc --noEmit && pnpm -C apps/web exec vitest run src/workflows src/pages/settings
```
Expected: all green. (`@openldr/web#test` has a known parallel flake — run web tests isolated.)

- [ ] **Step 2: Manual sanity (optional)** — with `WORKFLOW_LISTENERS_ENABLED=true` and a reachable Postgres: create a `postgres` connector, a workflow with a Postgres Trigger (channel `test_ch`) → a Log node, enable it; from psql run `NOTIFY test_ch, '{"hello":1}';` and confirm a run appears. For email: create an `imap` connector, a workflow with an Email Trigger; send a mail; confirm a run within one poll interval and attachments materialized.

- [ ] **Step 3: Update memory** — `workflow-node-palette.md`: add a Slice I paragraph (listener manager + postgres LISTEN driver + IMAP poll driver + imap connector type + 3 config knobs + reconcile-on-boot/save + stopAll-on-close; deps `pg`/`imapflow`/`mailparser`; at-least-once email + missed-while-disconnected pg). Move `postgres-trigger`/`email-trigger` out of "Still disabled" — only `read-write-file` remains. Refresh the `MEMORY.md` pointer.

- [ ] **Step 4: Commit (if in-repo files changed)**
```bash
git add -A && git commit -m "docs(workflows): record Slice I (listener triggers) complete"
```
(Per repo convention: merge to local `main` is the operator's call; do NOT push.)

---

## Self-review notes (for the implementer)

- **Spec coverage:** manager (Task 2), pg driver (Task 3), email driver + attachments + at-least-once (Task 4), imap connector type + probe (Task 4 make + Task 5 + Task 7), config knobs + master switch (Task 1), TriggerSource (Task 1), wiring reconcile-on-boot/save + stopAll-on-close (Task 6), web forms + palette (Task 7). Fail-soft on bad connector (Task 2 test). Deferred: live e2e, IMAP IDLE, OAuth, pooling.
- **Type consistency:** `ListenerSpec { workflowId, nodeId, triggerType, config }`, `ListenerDriver.start(spec, onFire) → { stop() }`, `OnFire(input, files?)` identical across manager (Task 2), pg driver (Task 3), email driver (Task 4). `runAndRecord(workflowId, source, input, files?)` matches the trigger-runner export. `writeBinary({bytes,fileName,contentType})→BinaryRef` matches Slice C.
- **Library-signature risk:** `imapflow`/`pg` real method signatures must satisfy tsc in the drivers; unit tests mock them, so verify shapes at implementation time and adjust the option objects (`{ uid: true }`, `download` args) to the installed versions. This is the main place tsc may push back — resolve by reading `node_modules/imapflow` types, not by casting to `any`.
- **Idempotent reconcile:** safe to call after every mutation; diff by config hash prevents needless restarts.
