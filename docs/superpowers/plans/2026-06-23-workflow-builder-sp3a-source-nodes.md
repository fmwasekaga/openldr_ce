# Workflow Builder — SP-3a Source Nodes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three source nodes so workflows can read real lab data — a gated SQL query over the reporting ExternalSchema, a FHIR query, and an allow-listed HTTP fetch — feeding the Code/Set/Filter/Merge nodes already shipped.

**Architecture:** The engine defines a `WorkflowServices` interface (`runSql`/`fhirQuery`/`httpFetch`) injected via `RunWorkflowOptions` → `ExecutionContext` (no engine→bootstrap coupling). The server implements it from `ctx.dashboards.query` (gated sql-runner), `ctx.fhirStore.listByType`, and a `guardedFetch` that enforces `WORKFLOW_HTTP_ALLOWLIST`. Three new handlers route as action subtypes.

**Tech Stack:** TypeScript, Kysely/Postgres (via dashboards sql-runner), `@openldr/db` FhirStore, global `fetch`, Vitest, Zod (config), React (forms).

**Reference spec:** `docs/superpowers/specs/2026-06-23-workflow-builder-sp3a-source-nodes-design.md`
**Builds on:** `main` `9fa8289` (SP-1+SP-4+SP-2). No migrations.

---

## Conventions
- CWD is the worktree `D:/Projects/Repositories/openldr_ce/.claude/worktrees/feat-workflow-builder-sp3`. Deps installed.
- Commit after each task with the shown message. Package gate after package tasks; full `turbo` gate at the end.

---

## Task 1: `WorkflowServices` interface + guardedFetch + threading

**Files:**
- Create: `packages/workflows/src/engine/services.ts`, `packages/workflows/src/engine/services.test.ts`
- Modify: `packages/workflows/src/engine/execution-context.ts`
- Modify: `packages/workflows/src/engine/run-workflow.ts`
- Modify: `packages/workflows/src/index.ts`

- [ ] **Step 1: Write the failing guardedFetch test** (`services.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest';
import { guardedFetch, parseAllowlist } from './services';

const okFetch = vi.fn(async () => new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json' } }));

describe('parseAllowlist', () => {
  it('splits, trims, lowercases, drops blanks', () => {
    expect(parseAllowlist(' A.com, b.org ,, ')).toEqual(['a.com', 'b.org']);
  });
});

describe('guardedFetch', () => {
  it('rejects a host not on the allow-list', async () => {
    await expect(guardedFetch({ url: 'https://evil.com/x' }, 'api.good.com', okFetch as never)).rejects.toThrow(/not allowed/);
  });
  it('allows an on-list host and parses JSON', async () => {
    const r = await guardedFetch({ url: 'https://api.good.com/x' }, 'api.good.com', okFetch as never);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ a: 1 });
  });
  it('empty allow-list rejects everything', async () => {
    await expect(guardedFetch({ url: 'https://api.good.com/x' }, '', okFetch as never)).rejects.toThrow(/not allowed/);
  });
  it('returns text when body is not JSON', async () => {
    const textFetch = vi.fn(async () => new Response('hello', { status: 200 }));
    const r = await guardedFetch({ url: 'https://api.good.com/x' }, 'api.good.com', textFetch as never);
    expect(r.data).toBe('hello');
  });
  it('rejects an invalid URL', async () => {
    await expect(guardedFetch({ url: 'not a url' }, 'api.good.com', okFetch as never)).rejects.toThrow(/invalid URL/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/workflows test services`
Expected: FAIL — no `./services`.

- [ ] **Step 3: Write `services.ts`**

```ts
export interface SqlResult {
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
}
export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
}

/** Capabilities the server injects so source handlers can reach lab data. */
export interface WorkflowServices {
  runSql(sql: string): Promise<SqlResult>;
  fhirQuery(resourceType: string, limit: number): Promise<{ resources: unknown[] }>;
  httpFetch(req: HttpRequest): Promise<HttpResponse>;
}

export function parseAllowlist(raw: string): string[] {
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * fetch wrapper that rejects any host not on the comma-separated allow-list
 * before making the request (SSRF guard). `fetchImpl` is injectable for tests.
 */
export async function guardedFetch(
  req: HttpRequest,
  allowlistRaw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HttpResponse> {
  if (!req.url) throw new Error('HTTP Request: URL is required');
  let host: string;
  try {
    host = new URL(req.url).hostname.toLowerCase();
  } catch {
    throw new Error(`HTTP Request: invalid URL: ${req.url}`);
  }
  const allow = parseAllowlist(allowlistRaw);
  if (!allow.includes(host)) throw new Error(`HTTP host not allowed: ${host}`);

  const method = (req.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { ...(req.headers ?? {}) };
  let body: string | undefined;
  if (['POST', 'PUT', 'PATCH'].includes(method) && req.body !== undefined) {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
  }

  const res = await fetchImpl(req.url, { method, headers, body });
  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => { responseHeaders[k] = v; });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, headers: responseHeaders, data };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/workflows test services`
Expected: PASS (6 tests).

- [ ] **Step 5: Thread `services` through the context.** In `execution-context.ts` add the field + param:

```ts
import type { RunEvent } from '../types';
import type { WorkflowServices } from './services';

export interface ExecutionContext {
  input: unknown;
  nodeOutputs: Record<string, unknown>;
  logs: Record<string, import('../types').LogEntry[]>;
  emit: (evt: RunEvent) => void;
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null }>;
  codeLimits: { timeoutMs: number; memoryMb: number };
  /** Server-provided data capabilities for source nodes (undefined in pure-engine tests). */
  services?: WorkflowServices;
}

export function createContext(
  input: unknown,
  emit: (evt: RunEvent) => void,
  edges: ExecutionContext['edges'] = [],
  codeLimits: ExecutionContext['codeLimits'] = { timeoutMs: 5000, memoryMb: 128 },
  services?: WorkflowServices,
): ExecutionContext {
  return { input, nodeOutputs: {}, logs: {}, emit, edges, codeLimits, services };
}
```

- [ ] **Step 6: Pass it from the runner.** In `run-workflow.ts`: add `services?: WorkflowServices` to `RunWorkflowOptions` (import the type from `./services`) and forward it:

```ts
  const ctx = createContext(opts.input, opts.onEvent ?? (() => {}), edges, opts.codeLimits, opts.services);
```

- [ ] **Step 7: Export from `index.ts`** — append:

```ts
export { guardedFetch, parseAllowlist, type WorkflowServices, type SqlResult, type HttpRequest, type HttpResponse } from './engine/services';
```

- [ ] **Step 8: Gate + commit**

Run: `pnpm --filter @openldr/workflows typecheck && pnpm --filter @openldr/workflows test`
Expected: green.

```bash
git add packages/workflows/src/engine/services.ts packages/workflows/src/engine/services.test.ts packages/workflows/src/engine/execution-context.ts packages/workflows/src/engine/run-workflow.ts packages/workflows/src/index.ts
git commit -m "feat(workflows): WorkflowServices interface + guarded HTTP fetch + threading"
```

---

## Task 2: Source handlers (sql, fhir, http) + routing + tests

**Files:**
- Create: `packages/workflows/src/engine/node-handlers/{sql,fhir,http}.ts`
- Modify: `packages/workflows/src/engine/node-handlers/index.ts`
- Create: `packages/workflows/src/engine/node-handlers/source-handlers.test.ts`
- Modify: `packages/workflows/src/engine/run-workflow.test.ts`

- [ ] **Step 1: Write the failing handler tests** (`source-handlers.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest';
import { sqlHandler } from './sql';
import { fhirHandler } from './fhir';
import { httpHandler } from './http';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';

const services: WorkflowServices = {
  runSql: vi.fn(async (sql: string) => ({ columns: [{ key: 'n', label: 'n' }], rows: [{ n: 1, sql }] })),
  fhirQuery: vi.fn(async (rt: string, limit: number) => ({ resources: [{ resourceType: rt, limit }] })),
  httpFetch: vi.fn(async (req) => ({ status: 200, headers: {}, data: { url: req.url } })),
};
const ctxWith = (svc?: WorkflowServices) => {
  const c = createContext(undefined, () => {}, [], undefined, svc);
  return c;
};

describe('source handlers', () => {
  it('sqlHandler templates the query and delegates to runSql', async () => {
    const ctx = ctxWith(services);
    const out = await sqlHandler({ id: 's', type: 'action', data: { action: 'sql-query', config: { sql: 'select {{ $input.n }}' } } }, ctx, { n: 5 });
    expect((out as { rows: { sql: string }[] }).rows[0].sql).toBe('select 5');
  });
  it('fhirHandler delegates to fhirQuery', async () => {
    const ctx = ctxWith(services);
    const out = await fhirHandler({ id: 'f', type: 'action', data: { action: 'fhir-query', config: { resourceType: 'Observation', limit: 10 } } }, ctx, undefined);
    expect(out).toEqual({ resources: [{ resourceType: 'Observation', limit: 10 }] });
  });
  it('httpHandler delegates to httpFetch with resolved url', async () => {
    const ctx = ctxWith(services);
    const out = await httpHandler({ id: 'h', type: 'action', data: { action: 'http-request', config: { url: 'https://x/{{ $input.id }}', method: 'GET' } } }, ctx, { id: 'abc' });
    expect((out as { data: { url: string } }).data.url).toBe('https://x/abc');
  });
  it('each throws a clear error when services are absent', async () => {
    const ctx = ctxWith(undefined);
    await expect(sqlHandler({ id: 's', type: 'action', data: { config: { sql: 'x' } } }, ctx, undefined)).rejects.toThrow(/requires server services/);
    await expect(fhirHandler({ id: 'f', type: 'action', data: { config: { resourceType: 'X' } } }, ctx, undefined)).rejects.toThrow(/requires server services/);
    await expect(httpHandler({ id: 'h', type: 'action', data: { config: { url: 'https://x' } } }, ctx, undefined)).rejects.toThrow(/requires server services/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/workflows test source-handlers`
Expected: FAIL — no `./sql`.

- [ ] **Step 3: Write `sql.ts`**

```ts
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';

export const sqlHandler: NodeHandler = async (node, ctx, upstream) => {
  if (!ctx.services) throw new Error('SQL node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const sql = resolveTemplate(String(config.sql ?? ''), ctx, upstream);
  if (!sql.trim()) throw new Error('SQL node: query is required');
  return ctx.services.runSql(sql);
};
```

- [ ] **Step 4: Write `fhir.ts`**

```ts
import type { NodeHandler } from './types';

export const fhirHandler: NodeHandler = async (node, ctx) => {
  if (!ctx.services) throw new Error('FHIR node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const resourceType = String(config.resourceType ?? '').trim();
  if (!resourceType) throw new Error('FHIR node: resourceType is required');
  const limit = Number(config.limit ?? 100);
  return ctx.services.fhirQuery(resourceType, Number.isFinite(limit) && limit > 0 ? limit : 100);
};
```

- [ ] **Step 5: Write `http.ts`** (adapts the standalone handler: template resolution stays here; fetch + allow-list happen in `services.httpFetch`)

```ts
import type { NodeHandler } from './types';
import { resolveTemplate, resolveTemplatesDeep } from '../template';

export const httpHandler: NodeHandler = async (node, ctx, upstream) => {
  if (!ctx.services) throw new Error('HTTP node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const url = resolveTemplate(String(config.url ?? ''), ctx, upstream);
  const method = String(config.method ?? 'GET');

  let headers: Record<string, string> = {};
  const rawHeaders = config.headers;
  if (typeof rawHeaders === 'string' && rawHeaders.trim()) {
    try { headers = JSON.parse(resolveTemplate(rawHeaders, ctx, upstream)); }
    catch { throw new Error('HTTP Request: headers must be valid JSON'); }
  } else if (rawHeaders && typeof rawHeaders === 'object') {
    headers = resolveTemplatesDeep(rawHeaders as Record<string, string>, ctx, upstream);
  }

  const body = config.body !== undefined ? resolveTemplate(String(config.body ?? ''), ctx, upstream) : undefined;
  return ctx.services.httpFetch({ url, method, headers, body });
};
```

- [ ] **Step 6: Route them** in `node-handlers/index.ts` — import the three and add to `ACTION_HANDLERS`:

```ts
import { sqlHandler } from './sql';
import { fhirHandler } from './fhir';
import { httpHandler } from './http';
// ...
const ACTION_HANDLERS: Record<string, NodeHandler> = {
  log: logHandler,
  set: setHandler,
  merge: mergeHandler,
  'sql-query': sqlHandler,
  'fhir-query': fhirHandler,
  'http-request': httpHandler,
  'no-op': defaultHandler,
};
```

- [ ] **Step 7: Run handler tests**

Run: `pnpm --filter @openldr/workflows test source-handlers`
Expected: PASS (4 tests).

- [ ] **Step 8: Add a run-workflow integration test** to `run-workflow.test.ts` (injects a fake `services`):

```ts
  it('runs a SQL source node and feeds rows downstream', async () => {
    const services = {
      runSql: async () => ({ columns: [{ key: 'name', label: 'name' }], rows: [{ name: 'alice' }] }),
      fhirQuery: async () => ({ resources: [] }),
      httpFetch: async () => ({ status: 200, headers: {}, data: null }),
    };
    const nodes = [
      { id: 't', type: 'trigger', data: {} },
      { id: 'q', type: 'action', data: { action: 'sql-query', config: { sql: 'select name from x' } } },
      { id: 'l', type: 'action', data: { action: 'log', message: 'first={{ $input.rows.0.name }}' } },
    ];
    const edges = [
      { id: 'e1', source: 't', target: 'q' },
      { id: 'e2', source: 'q', target: 'l' },
    ];
    const logs: string[] = [];
    const res = await runWorkflow(nodes, edges, { services, onEvent: (e) => { if (e.type === 'node:log') logs.push(e.entry.message); } });
    expect(res.status).toBe('completed');
    expect(logs).toContain('first=alice');
  });
```

(Note: the template resolver supports numeric dot-path segments like `rows.0.name` via the generic object index — verify; if it doesn't resolve array indices, assert on the SQL node's output instead: `expect(res.results.find(r=>r.nodeId==='q')?.output).toEqual({columns:[...],rows:[{name:'alice'}]})`.)

- [ ] **Step 9: Run + commit**

Run: `pnpm --filter @openldr/workflows test && pnpm --filter @openldr/workflows typecheck`
Expected: green.

```bash
git add packages/workflows/src/engine/node-handlers/sql.ts packages/workflows/src/engine/node-handlers/fhir.ts packages/workflows/src/engine/node-handlers/http.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/engine/node-handlers/source-handlers.test.ts packages/workflows/src/engine/run-workflow.test.ts
git commit -m "feat(workflows): SQL/FHIR/HTTP source handlers"
```

---

## Task 3: Config flag + server `WorkflowServices` impl + wiring

**Files:**
- Modify: `packages/config/src/schema.ts` (+ `schema.test.ts`)
- Modify: `packages/bootstrap/src/index.ts`
- Modify: `apps/server/src/workflows-routes.ts`
- Modify: `packages/workflows/src/trigger-runner.ts`
- Modify: `apps/server/src/workflows-routes.test.ts`

- [ ] **Step 1: Add the config flag.** In `packages/config/src/schema.ts` near the `WORKFLOW_CODE_*` lines:

```ts
    WORKFLOW_HTTP_ALLOWLIST: z.string().default(''),
```
Add a test to `schema.test.ts`:
```ts
  it('defaults WORKFLOW_HTTP_ALLOWLIST to empty', () => {
    expect(ConfigSchema.parse(base).WORKFLOW_HTTP_ALLOWLIST).toBe('');
  });
```
Run: `pnpm --filter @openldr/config test` → green.

- [ ] **Step 2: Build the service impl + attach to ctx.workflows.** In `packages/bootstrap/src/index.ts`:
  - import: `import { ..., guardedFetch, type WorkflowServices } from '@openldr/workflows';`
  - construct after the dashboards + fhir store are available (termFhirStore is defined later in the file — place this AFTER `termFhirStore`; if ordering is awkward, build `workflowServices` just before the `return {...}` and reference it there):

```ts
  const workflowServices: WorkflowServices = {
    runSql: async (sql) => {
      const r = await dashboards.query({ mode: 'sql', sql });
      return { columns: r.columns.map((c) => ({ key: c.key, label: c.label })), rows: r.rows };
    },
    fhirQuery: async (resourceType, limit) => ({
      resources: (await termFhirStore.listByType(resourceType, limit)).map((x) => x.resource),
    }),
    httpFetch: (req) => guardedFetch(req, cfg.WORKFLOW_HTTP_ALLOWLIST),
  };
```
  - add `services: workflowServices` to the `workflows` object, and `codeLimits`/`services` are already passed to the runner — add `services: workflowServices` to the `createWorkflowTriggerRunner({...})` deps.
  - widen the `AppContext.workflows` interface to include `services: WorkflowServices`.

> `dashboards` and `termFhirStore` are both in scope in `createAppContext`. If `workflowServices` must reference `termFhirStore` which is declared lower in the function than the runner construction, move the `workflowServices` const to just below `termFhirStore`'s declaration and construct the runner after it (or pass a thunk). Keep it simple: declare `workflowServices` right after `termFhirStore`, then build the runner.

- [ ] **Step 3: Pass services from the execute-stream route.** In `apps/server/src/workflows-routes.ts`, add to the manual `runWorkflow(...)` opts: `services: ctx.workflows.services` (alongside the existing `codeLimits`).

- [ ] **Step 4: Pass services in the trigger runner.** In `packages/workflows/src/trigger-runner.ts`: add `services?: WorkflowServices` to `RunnerDeps` (import the type), and in `runAndRecord` pass `services: deps.services` in the `runWorkflow(...)` opts.

- [ ] **Step 5: Update the route test stub.** In `apps/server/src/workflows-routes.test.ts`, add `services: undefined` (or a small fake) to both `ctx.workflows` stubs so the shape matches; existing execute-stream test uses trigger→log (no source node) so `undefined` is fine.

- [ ] **Step 6: Gate + commit**

Run: `pnpm --filter @openldr/config typecheck && pnpm --filter @openldr/workflows typecheck && pnpm --filter @openldr/bootstrap typecheck && pnpm --filter @openldr/server typecheck && pnpm --filter @openldr/server test workflows-routes`
Expected: green.

```bash
git add packages/config/src/schema.ts packages/config/src/schema.test.ts packages/bootstrap/src/index.ts apps/server/src/workflows-routes.ts packages/workflows/src/trigger-runner.ts apps/server/src/workflows-routes.test.ts
git commit -m "feat: WORKFLOW_HTTP_ALLOWLIST + server WorkflowServices impl + wiring"
```

---

## Task 4: Web — enable source nodes + forms

**Files:**
- Modify: `apps/web/src/workflows/constants.ts`
- Create: `apps/web/src/workflows/components/node-forms/sql-form.tsx`, `fhir-form.tsx`
- Modify: `apps/web/src/workflows/components/node-forms/index.tsx`

- [ ] **Step 1: Add SQL + FHIR templates and enable all three.** In `constants.ts`:
  - Add two action templates next to the existing `http-request` one (use the same `node('<id>','action','<label>','<icon>','<desc>',{ action:'<id>', config:{...} })` helper — READ the file for its exact signature; the `http-request` template is around line 156). Add `node('sql-query','action','SQL Query','Database','Run a SELECT over the reporting schema', { action:'sql-query', config:{ sql:'' } })` and `node('fhir-query','action','FHIR Query','Activity','Fetch FHIR resources by type', { action:'fhir-query', config:{ resourceType:'', limit:100 } })`. Pick valid lucide icon names that already resolve in the project (e.g. `Database`, `Activity`) — confirm against `icons.tsx`/lucide.
  - Add `'sql-query'`, `'fhir-query'`, `'http-request'` to `IMPLEMENTED_TEMPLATE_IDS`.

- [ ] **Step 2: Create `sql-form.tsx`**

```tsx
import type { NodeFormProps } from './index';
import { FormField, TextArea, TextInput } from './shared';

export function SqlForm({ node, update }: NodeFormProps) {
  const data = node.data as { label?: string; config?: { sql?: string } };
  const config = data.config ?? {};
  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} />
      </FormField>
      <FormField label="SQL (SELECT only)" hint="Runs over the reporting schema (read-only, row-capped). Use {{ $input.x }} to template values.">
        <TextArea
          className="h-48 resize-none font-mono text-xs"
          value={config.sql ?? ''}
          onChange={(e) => update({ config: { ...config, sql: e.target.value } })}
          spellCheck={false}
          placeholder={'select specimen_type, count(*) as n\nfrom lab_results\ngroup by specimen_type'}
        />
      </FormField>
    </div>
  );
}
```

- [ ] **Step 3: Create `fhir-form.tsx`**

```tsx
import type { NodeFormProps } from './index';
import { FormField, TextInput } from './shared';

export function FhirForm({ node, update }: NodeFormProps) {
  const data = node.data as { label?: string; config?: { resourceType?: string; limit?: number } };
  const config = data.config ?? {};
  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} />
      </FormField>
      <FormField label="Resource type" hint="e.g. Observation, Specimen, Patient">
        <TextInput value={config.resourceType ?? ''} onChange={(e) => update({ config: { ...config, resourceType: e.target.value } })} />
      </FormField>
      <FormField label="Limit">
        <TextInput type="number" value={String(config.limit ?? 100)} onChange={(e) => update({ config: { ...config, limit: Number(e.target.value) } })} />
      </FormField>
    </div>
  );
}
```

> `FormField`/`TextInput`/`TextArea` are the shared helpers used by the other forms (confirm their props in `node-forms/shared.tsx`; if `TextInput` doesn't pass through `type`, use the raw input pattern the other forms use). `NodeFormProps` is exported from `node-forms/index.tsx`.

- [ ] **Step 4: Register the forms** in `node-forms/index.tsx`'s `pickForm` — keyed by templateId `sql-query` → `SqlForm`, `fhir-query` → `FhirForm`. (HTTP form already exists; add a one-line hint in it that only allow-listed hosts are reachable.)

- [ ] **Step 5: Gate + commit**

Run: `pnpm --filter @openldr/web typecheck && pnpm --filter @openldr/web test`
Expected: green.

```bash
git add apps/web/src/workflows/constants.ts apps/web/src/workflows/components/node-forms/sql-form.tsx apps/web/src/workflows/components/node-forms/fhir-form.tsx apps/web/src/workflows/components/node-forms/index.tsx
git commit -m "feat(web): enable SQL/FHIR/HTTP source nodes + forms"
```

---

## Task 5: Full gate + verification

- [ ] **Step 1: Full monorepo gate**

Run: `pnpm turbo typecheck lint test build`
Expected: PASS. If `@openldr/web#test` flakes in parallel (known Terminology flake), re-run isolated: `pnpm --filter @openldr/web test`.

- [ ] **Step 2: depcruise**

Run: `pnpm depcruise`
Expected: clean — `services.ts` adds no cross-package import; bootstrap→workflows already allowed.

- [ ] **Step 3: Manual e2e** (live stack + login): set `WORKFLOW_HTTP_ALLOWLIST` to a test host; build Manual Trigger → SQL Query (`select 1 as n`) → Log (`n={{ $input.rows.0.n }}`); Run; confirm rows appear in the Output tab + the log. Confirm an HTTP node to an off-list host fails with "host not allowed", and a FHIR node returns resources.

- [ ] **Step 4: Commit any fixes, then finish**

```bash
git add -A && git commit -m "chore(workflows): SP-3a verification fixes"
```

Proceed to `superpowers:finishing-a-development-branch`.

---

## Self-review notes (author)
- **Spec coverage:** §2 services injection → Task 1; §3 SQL/FHIR/HTTP handlers → Task 2; §4 config → Task 3; server impl/wiring → Task 3; §5 web → Task 4; §6 testing → Tasks 1,2,3 + Task 5.
- **Type consistency:** `WorkflowServices`/`SqlResult`/`HttpRequest`/`HttpResponse`, `guardedFetch`/`parseAllowlist`, `sqlHandler`/`fhirHandler`/`httpHandler`, `ExecutionContext.services`, `RunWorkflowOptions.services`, `RunnerDeps.services`, `ctx.workflows.services` are used identically across tasks. Node config keys: `config.sql`, `config.resourceType`/`config.limit`, `config.url`/`config.method`/`config.headers`/`config.body` — uniform between handlers (Task 2) and forms (Task 4).
- **Soft spots flagged for the implementer:** the `node(...)` catalog helper signature + valid lucide icon names (Task 4 Step 1); `shared.tsx` helper props incl. `type` passthrough (Task 4 Step 3); template resolver array-index support `rows.0.n` (Task 2 Step 8 — fallback assertion given); placement of `workflowServices` relative to `termFhirStore` in bootstrap (Task 3 Step 2); the existing `base` fixture name in `schema.test.ts` (Task 3 Step 1).
- **Placeholder scan:** none — all code blocks concrete; "verify against real file" notes are guardrails.
