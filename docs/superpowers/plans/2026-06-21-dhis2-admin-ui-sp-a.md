# DHIS2 Admin UI — SP-A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing `Dhis2Context` over HTTP (`GET /api/dhis2/status`, `POST /api/dhis2/metadata/pull`) and add a DHIS2 nav entry + a read-only Settings/Status page.

**Architecture:** A new `apps/server/src/dhis2-routes.ts` registrar reads `ctx.cfg` flags for configured-ness and uses an injected `Dhis2Context | null` for live data; `buildApp` threads that context through; the web adds an `api.ts` client, a `Dhis2.tsx` page, a nav item, and a guarded `/dhis2` route. The page works whether or not DHIS2 is configured.

**Tech Stack:** Fastify, Vitest (server), React + react-i18next + shadcn/ui + Testing Library (web), TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-21-dhis2-admin-ui-sp-a-design.md`

---

## File Structure

- Create `apps/server/src/dhis2-routes.ts` — `registerDhis2Routes(app, ctx, dhis2)`: status + metadata-pull routes.
- Create `apps/server/src/dhis2-routes.test.ts` — route tests with injected fakes.
- Modify `apps/server/src/app.ts` — `buildApp(ctx, dhis2)` + register the routes.
- Modify `apps/server/src/index.ts` — build the context when adapter=dhis2; gate sync on `DHIS2_SYNC_ENABLED`.
- Modify `apps/web/src/api.ts` — `getDhis2Status()` / `pullDhis2Metadata()` + types.
- Create `apps/web/src/pages/Dhis2.tsx` — Settings/Status page.
- Create `apps/web/src/pages/Dhis2.test.tsx` — page tests.
- Modify `apps/web/src/App.tsx` — guarded `/dhis2` route.
- Modify `apps/web/src/shell/AppShell.tsx` — nav item.
- Modify `apps/web/src/i18n/index.ts` — `dhis2.*` keys.

---

## Task 1: Server — `GET /api/dhis2/status` route

**Files:**
- Create: `apps/server/src/dhis2-routes.ts`
- Test: `apps/server/src/dhis2-routes.test.ts`

Notes: `ctx.cfg` is the full `Config` (has `REPORTING_TARGET_ADAPTER`, `DHIS2_BASE_URL/USERNAME/PASSWORD`, `DHIS2_SYNC_ENABLED`). `Dhis2Context` is exported from `@openldr/bootstrap` and exposes `target.healthCheck()`, `mappings.list()`, `orgUnits.list()`, `schedules.list()`, `recentPushes(n)`, `pullMetadata()`. `requireRole` lives in `./rbac`; `redact` in `@openldr/core`. Test auth is injected by an `onRequest` hook setting `req.user` (see `users-routes.test.ts`).

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/dhis2-routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerDhis2Routes } from './dhis2-routes';

function configuredCfg(over: Record<string, unknown> = {}) {
  return {
    REPORTING_TARGET_ADAPTER: 'dhis2',
    DHIS2_BASE_URL: 'https://play.dhis2.example/api',
    DHIS2_USERNAME: 'admin',
    DHIS2_PASSWORD: 'secret',
    DHIS2_SYNC_ENABLED: true,
    ...over,
  };
}

function fakeDhis2(over: Record<string, unknown> = {}) {
  return {
    target: { healthCheck: async () => ({ status: 'up' as const, latencyMs: 12 }) },
    mappings: { list: async () => [{ id: 'm1', name: 'A' }] },
    orgUnits: { list: async () => [{ facilityId: 'f1', orgUnit: 'o1' }] },
    schedules: { list: async () => [] },
    recentPushes: async () => [{ id: 'a1', occurredAt: '2026-01-01T00:00:00Z', action: 'dhis2.push', entityType: 'dhis2-mapping', entityId: 'm1', actorType: 'system', actorName: 'system' }],
    pullMetadata: async () => ({ dataElements: [{ id: 'd', name: 'd' }], orgUnits: [], categoryOptionCombos: [], programs: [], programStages: [] }),
    ...over,
  } as never;
}

function appWith(ctxCfg: Record<string, unknown>, dhis2: unknown, roles: string[] = ['lab_admin']) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'admin', username: 'admin', displayName: null, roles };
  });
  registerDhis2Routes(app, { cfg: ctxCfg } as unknown as AppContext, dhis2 as never);
  return app;
}

describe('dhis2 status route', () => {
  it('returns live status when configured', async () => {
    const app = appWith(configuredCfg(), fakeDhis2());
    const res = await app.inject({ method: 'GET', url: '/api/dhis2/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(true);
    expect(body.host).toBe('play.dhis2.example');
    expect(body.reachable).toEqual({ status: 'up', latencyMs: 12 });
    expect(body.counts).toEqual({ mappings: 1, orgUnitMappings: 1, schedules: 0 });
    expect(body.recentPushes).toHaveLength(1);
    // Never leak credentials.
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('returns configured:false (no context calls) when unconfigured', async () => {
    const app = appWith(configuredCfg({ REPORTING_TARGET_ADAPTER: 'pg' }), null);
    const res = await app.inject({ method: 'GET', url: '/api/dhis2/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(false);
    expect(body.reachable).toBeNull();
    expect(body.counts).toBeNull();
    expect(body.recentPushes).toEqual([]);
  });

  it('reports reachable down when healthCheck throws', async () => {
    const app = appWith(configuredCfg(), fakeDhis2({ target: { healthCheck: async () => { throw new Error('ECONNREFUSED'); } } }));
    const body = (await app.inject({ method: 'GET', url: '/api/dhis2/status' })).json();
    expect(body.reachable.status).toBe('down');
  });

  it('rejects non-admins with 403', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['lab_technician']);
    expect((await app.inject({ method: 'GET', url: '/api/dhis2/status' })).statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server test -- --run dhis2-routes.test.ts`
Expected: FAIL — `registerDhis2Routes` not found / module missing.

- [ ] **Step 3: Write minimal implementation**

Create `apps/server/src/dhis2-routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { AppContext, Dhis2Context } from '@openldr/bootstrap';
import { redact } from '@openldr/core';
import { requireRole } from './rbac';

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).host; } catch { return null; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerDhis2Routes(app: FastifyInstance<any, any, any, any>, ctx: AppContext, dhis2: Dhis2Context | null): void {
  const cfg = ctx.cfg;
  const configured =
    cfg.REPORTING_TARGET_ADAPTER === 'dhis2' && !!cfg.DHIS2_BASE_URL && !!cfg.DHIS2_USERNAME && !!cfg.DHIS2_PASSWORD;

  app.get('/api/dhis2/status', { preHandler: requireRole('lab_admin') }, async () => {
    const base = { configured, syncEnabled: cfg.DHIS2_SYNC_ENABLED, host: hostOf(cfg.DHIS2_BASE_URL) };
    if (!configured || !dhis2) {
      return { ...base, reachable: null, counts: null, recentPushes: [] };
    }
    let reachable;
    try {
      reachable = await dhis2.target.healthCheck();
    } catch (e) {
      reachable = { status: 'down' as const, latencyMs: 0, detail: redact(e instanceof Error ? e.message : String(e)) };
    }
    const [mappings, orgUnitMappings, schedules] = await Promise.all([
      dhis2.mappings.list(),
      dhis2.orgUnits.list(),
      dhis2.schedules.list(),
    ]);
    const recentPushes = await dhis2.recentPushes(10);
    return {
      ...base,
      reachable,
      counts: { mappings: mappings.length, orgUnitMappings: orgUnitMappings.length, schedules: schedules.length },
      recentPushes,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/server test -- --run dhis2-routes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/dhis2-routes.ts apps/server/src/dhis2-routes.test.ts
git commit -m "feat(dhis2): GET /api/dhis2/status route (configured/unconfigured)"
```

---

## Task 2: Server — `POST /api/dhis2/metadata/pull` route

**Files:**
- Modify: `apps/server/src/dhis2-routes.ts`
- Test: `apps/server/src/dhis2-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside `apps/server/src/dhis2-routes.test.ts` (after the existing `describe`):

```ts
describe('dhis2 metadata pull route', () => {
  it('returns metadata counts when configured', async () => {
    const app = appWith(configuredCfg(), fakeDhis2());
    const res = await app.inject({ method: 'POST', url: '/api/dhis2/metadata/pull' });
    expect(res.statusCode).toBe(200);
    expect(res.json().counts).toEqual({ dataElements: 1, orgUnits: 0, categoryOptionCombos: 0, programs: 0, programStages: 0 });
  });

  it('returns 409 when not configured', async () => {
    const app = appWith(configuredCfg({ REPORTING_TARGET_ADAPTER: 'pg' }), null);
    const res = await app.inject({ method: 'POST', url: '/api/dhis2/metadata/pull' });
    expect(res.statusCode).toBe(409);
  });

  it('returns 502 (redacted) when pull throws', async () => {
    const app = appWith(configuredCfg(), fakeDhis2({ pullMetadata: async () => { throw new Error('boom'); } }));
    const res = await app.inject({ method: 'POST', url: '/api/dhis2/metadata/pull' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBeTruthy();
  });

  it('rejects non-admins with 403', async () => {
    const app = appWith(configuredCfg(), fakeDhis2(), ['data_analyst']);
    expect((await app.inject({ method: 'POST', url: '/api/dhis2/metadata/pull' })).statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server test -- --run dhis2-routes.test.ts`
Expected: FAIL — pull route returns 404 (not registered).

- [ ] **Step 3: Write minimal implementation**

In `apps/server/src/dhis2-routes.ts`, add this route at the end of `registerDhis2Routes` (after the status route):

```ts
  app.post('/api/dhis2/metadata/pull', { preHandler: requireRole('lab_admin') }, async (_req, reply) => {
    if (!configured || !dhis2) {
      reply.code(409);
      return { error: 'DHIS2 target not configured' };
    }
    try {
      const md = await dhis2.pullMetadata();
      return {
        counts: {
          dataElements: md.dataElements.length,
          orgUnits: md.orgUnits.length,
          categoryOptionCombos: md.categoryOptionCombos.length,
          programs: md.programs?.length ?? 0,
          programStages: md.programStages?.length ?? 0,
        },
      };
    } catch (e) {
      reply.code(502);
      return { error: redact(e instanceof Error ? e.message : String(e)) };
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/server test -- --run dhis2-routes.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/dhis2-routes.ts apps/server/src/dhis2-routes.test.ts
git commit -m "feat(dhis2): POST /api/dhis2/metadata/pull route (200/409/502)"
```

---

## Task 3: Wire the routes into the app + decouple startup from sync gating

**Files:**
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: Thread the context through `buildApp`**

In `apps/server/src/app.ts`, add the import (next to the other route imports):

```ts
import { registerDhis2Routes } from './dhis2-routes';
```

Add a type import (next to `import type { AppContext } from '@openldr/bootstrap';`):

```ts
import type { AppContext, Dhis2Context } from '@openldr/bootstrap';
```

Change the signature and register the routes. Replace:

```ts
export function buildApp(ctx: AppContext) {
```

with:

```ts
export function buildApp(ctx: AppContext, dhis2: Dhis2Context | null = null) {
```

and, immediately after the `registerFormsRoutes(app, ctx);` line, add:

```ts
  registerDhis2Routes(app, ctx, dhis2);
```

- [ ] **Step 2: Build the context when adapter=dhis2, gate sync separately**

In `apps/server/src/index.ts`, replace the body from `const app = buildApp(ctx);` through the `reconcileSchedules` block. Replace:

```ts
  const ctx = await createAppContext(cfg);
  const app = buildApp(ctx);

  const ingest = await createIngestContext(cfg);

  let dhis2: Awaited<ReturnType<typeof createDhis2Context>> | null = null;
  if (cfg.REPORTING_TARGET_ADAPTER === 'dhis2' && cfg.DHIS2_SYNC_ENABLED) {
    dhis2 = await createDhis2Context(cfg);
    await dhis2.registerSync(ingest.eventing, {
      runReport: (id, p) => ctx.reporting.run(id, p ?? {}).then((r) => ({ rows: r.rows })),
      runEventSource: (id, w) => ctx.reporting.runEventSource(id, w),
    });
    await dhis2.reconcileSchedules(ingest.eventing);
  }
```

with:

```ts
  const ctx = await createAppContext(cfg);
  const ingest = await createIngestContext(cfg);

  // Build the DHIS2 context whenever DHIS2 is the reporting target so the admin
  // status + metadata routes work even with sync disabled. Sync wiring stays gated below.
  let dhis2: Awaited<ReturnType<typeof createDhis2Context>> | null = null;
  if (cfg.REPORTING_TARGET_ADAPTER === 'dhis2') {
    dhis2 = await createDhis2Context(cfg);
  }

  const app = buildApp(ctx, dhis2);

  if (dhis2 && cfg.DHIS2_SYNC_ENABLED) {
    await dhis2.registerSync(ingest.eventing, {
      runReport: (id, p) => ctx.reporting.run(id, p ?? {}).then((r) => ({ rows: r.rows })),
      runEventSource: (id, w) => ctx.reporting.runEventSource(id, w),
    });
    await dhis2.reconcileSchedules(ingest.eventing);
  }
```

- [ ] **Step 3: Typecheck + run the server test suite**

Run: `pnpm --filter @openldr/server typecheck && pnpm --filter @openldr/server test -- --run`
Expected: typecheck clean; all server tests PASS (including the new dhis2-routes tests).

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/index.ts
git commit -m "feat(dhis2): register dhis2 routes; decouple admin context from sync gating"
```

---

## Task 4: Web — API client + types

**Files:**
- Modify: `apps/web/src/api.ts`

Notes: `authFetch` is already exported from `api.ts`. The `recentPushes` items are audit events (`{ id, occurredAt, action, entityType, entityId, actorType, actorName, metadata? }`).

- [ ] **Step 1: Add types + client functions**

At the end of `apps/web/src/api.ts`, append:

```ts
// ── DHIS2 admin (SP-A) ─────────────────────────────────────────────────────────
export interface Dhis2RecentPush {
  id: string;
  occurredAt: string;
  action: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}
export interface Dhis2Status {
  configured: boolean;
  syncEnabled: boolean;
  host: string | null;
  reachable: { status: 'up' | 'down' | 'degraded'; latencyMs: number; detail?: string } | null;
  counts: { mappings: number; orgUnitMappings: number; schedules: number } | null;
  recentPushes: Dhis2RecentPush[];
}
export interface Dhis2MetadataCounts {
  dataElements: number;
  orgUnits: number;
  categoryOptionCombos: number;
  programs: number;
  programStages: number;
}

export async function getDhis2Status(): Promise<Dhis2Status> {
  const r = await authFetch('/api/dhis2/status');
  if (!r.ok) throw new Error(`dhis2 status failed: ${r.status}`);
  return r.json();
}

export async function pullDhis2Metadata(): Promise<Dhis2MetadataCounts> {
  const r = await authFetch('/api/dhis2/metadata/pull', { method: 'POST' });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `metadata pull failed: ${r.status}`);
  }
  return (await r.json()).counts;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openldr/web typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api.ts
git commit -m "feat(dhis2): web api client + types for status/metadata"
```

---

## Task 5: Web — Settings/Status page + nav + route + i18n

**Files:**
- Create: `apps/web/src/pages/Dhis2.tsx`
- Test: `apps/web/src/pages/Dhis2.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/shell/AppShell.tsx`
- Modify: `apps/web/src/i18n/index.ts`

- [ ] **Step 1: Add i18n keys**

In `apps/web/src/i18n/index.ts`, add a `dhis2` block inside the `en` object (after the `users` block, before the closing `};`):

```ts
    dhis2: {
      title: 'DHIS2',
      connection: 'Connection',
      configured: 'Configured',
      notConfigured: 'Not configured',
      syncEnabled: 'Sync enabled',
      syncDisabled: 'Sync disabled',
      host: 'Host',
      reachability: 'Reachability',
      up: 'Reachable',
      down: 'Unreachable',
      notConfiguredHelp: 'Set REPORTING_TARGET_ADAPTER=dhis2 and DHIS2_BASE_URL / DHIS2_USERNAME / DHIS2_PASSWORD in the server environment to enable DHIS2.',
      metadata: 'Metadata',
      pullMetadata: 'Pull metadata',
      pulling: 'Pulling…',
      dataElements: 'Data elements',
      orgUnits: 'Org units',
      categoryOptionCombos: 'Category option combos',
      programs: 'Programs',
      programStages: 'Program stages',
      overview: 'Overview',
      mappings: 'Mappings',
      orgUnitMappings: 'OrgUnit mappings',
      schedules: 'Schedules',
      recentPushes: 'Recent pushes',
      noPushes: 'No pushes yet.',
      when: 'When',
      action: 'Action',
      mapping: 'Mapping',
    },
```

- [ ] **Step 2: Write the failing page test**

Create `apps/web/src/pages/Dhis2.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getDhis2Status: vi.fn(), pullDhis2Metadata: vi.fn() };
});
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasRole: () => true }),
}));

import { getDhis2Status, pullDhis2Metadata } from '@/api';
import { Dhis2 } from './Dhis2';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DHIS2 settings page', () => {
  it('shows the not-configured empty state', async () => {
    (getDhis2Status as ReturnType<typeof vi.fn>).mockResolvedValue({
      configured: false, syncEnabled: false, host: null, reachable: null, counts: null, recentPushes: [],
    });
    render(<MemoryRouter><Dhis2 /></MemoryRouter>);
    expect(await screen.findByText(/Not configured/i)).toBeTruthy();
  });

  it('shows host + reachability and pulls metadata when configured', async () => {
    (getDhis2Status as ReturnType<typeof vi.fn>).mockResolvedValue({
      configured: true, syncEnabled: true, host: 'play.dhis2.example', reachable: { status: 'up', latencyMs: 10 },
      counts: { mappings: 2, orgUnitMappings: 1, schedules: 0 }, recentPushes: [],
    });
    (pullDhis2Metadata as ReturnType<typeof vi.fn>).mockResolvedValue({
      dataElements: 5, orgUnits: 3, categoryOptionCombos: 4, programs: 1, programStages: 2,
    });
    render(<MemoryRouter><Dhis2 /></MemoryRouter>);
    expect(await screen.findByText('play.dhis2.example')).toBeTruthy();

    fireEvent.click(screen.getByTestId('dhis2-pull-metadata'));
    await waitFor(() => expect(pullDhis2Metadata).toHaveBeenCalled());
    expect(await screen.findByText('5')).toBeTruthy(); // dataElements count
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @openldr/web test -- --run Dhis2.test.tsx`
Expected: FAIL — `./Dhis2` module missing.

- [ ] **Step 4: Create the `card` shadcn primitive, then the page**

`apps/web/src/components/ui/card.tsx` does not exist yet — create it first (plain-function shadcn style matching `badge.tsx`, using `cn` from `@/lib/cn`):

```tsx
import * as React from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-card text-card-foreground shadow-sm', className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col space-y-1.5 p-4', className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('text-sm font-semibold leading-none tracking-tight', className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pt-0', className)} {...props} />;
}
```

Then create `apps/web/src/pages/Dhis2.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Network } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDhis2Status, pullDhis2Metadata, type Dhis2Status, type Dhis2MetadataCounts } from '@/api';

export function Dhis2() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Dhis2Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Dhis2MetadataCounts | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setStatus(await getDhis2Status()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const doPull = useCallback(async () => {
    setPulling(true); setPullError(null);
    try { setMeta(await pullDhis2Metadata()); }
    catch (e) { setPullError(e instanceof Error ? e.message : String(e)); }
    finally { setPulling(false); }
  }, []);

  const configured = status?.configured ?? false;

  return (
    <AppShell title="DHIS2">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4" data-testid="dhis2-page">
        {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}

        {/* Connection */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Network className="h-4 w-4" /><CardTitle>{t('dhis2.connection')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={configured ? 'default' : 'outline'}>{configured ? t('dhis2.configured') : t('dhis2.notConfigured')}</Badge>
              {configured && <Badge variant="outline">{status?.syncEnabled ? t('dhis2.syncEnabled') : t('dhis2.syncDisabled')}</Badge>}
            </div>
            {configured ? (
              <>
                <div><span className="text-muted-foreground">{t('dhis2.host')}: </span>{status?.host ?? '-'}</div>
                <div>
                  <span className="text-muted-foreground">{t('dhis2.reachability')}: </span>
                  {status?.reachable
                    ? `${status.reachable.status === 'up' ? t('dhis2.up') : t('dhis2.down')} (${status.reachable.latencyMs}ms)`
                    : '-'}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">{t('dhis2.notConfiguredHelp')}</p>
            )}
          </CardContent>
        </Card>

        {/* Metadata */}
        <Card>
          <CardHeader><CardTitle>{t('dhis2.metadata')}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Button onClick={() => void doPull()} disabled={!configured || pulling} data-testid="dhis2-pull-metadata">
              {pulling ? t('dhis2.pulling') : t('dhis2.pullMetadata')}
            </Button>
            {pullError ? <p className="text-destructive">{pullError}</p> : null}
            {meta ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                {([
                  ['dataElements', meta.dataElements], ['orgUnits', meta.orgUnits],
                  ['categoryOptionCombos', meta.categoryOptionCombos], ['programs', meta.programs],
                  ['programStages', meta.programStages],
                ] as const).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t(`dhis2.${k}`)}</dt><dd className="font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </CardContent>
        </Card>

        {/* Overview */}
        {configured && status?.counts ? (
          <Card>
            <CardHeader><CardTitle>{t('dhis2.overview')}</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-6">
                <div><span className="text-muted-foreground">{t('dhis2.mappings')}: </span>{status.counts.mappings}</div>
                <div><span className="text-muted-foreground">{t('dhis2.orgUnitMappings')}: </span>{status.counts.orgUnitMappings}</div>
                <div><span className="text-muted-foreground">{t('dhis2.schedules')}: </span>{status.counts.schedules}</div>
              </div>
              <div>
                <div className="mb-1 font-medium">{t('dhis2.recentPushes')}</div>
                {status.recentPushes.length === 0 ? (
                  <p className="text-muted-foreground">{t('dhis2.noPushes')}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('dhis2.when')}</TableHead><TableHead>{t('dhis2.action')}</TableHead><TableHead>{t('dhis2.mapping')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {status.recentPushes.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="text-xs text-muted-foreground">{new Date(p.occurredAt).toLocaleString()}</TableCell>
                          <TableCell>{p.action}</TableCell><TableCell>{p.entityId}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 5: Run the page test to verify it passes**

Run: `pnpm --filter @openldr/web test -- --run Dhis2.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Add the nav item + route**

In `apps/web/src/shell/AppShell.tsx`, add `Network` to the `lucide-react` import list (line ~3-6) and add to the `NAV` array after the Users entry:

```ts
  { to: '/dhis2', label: 'DHIS2', end: false, icon: Network },
```

In `apps/web/src/App.tsx`, add the import near the other page imports:

```ts
import { Dhis2 } from '@/pages/Dhis2';
```

and add the route after the `/users` route (reuse the existing `RequireRole` wrapper):

```tsx
      <Route path="/dhis2" element={<RequireRole role="lab_admin"><Dhis2 /></RequireRole>} />
```

- [ ] **Step 7: Typecheck + run web tests**

Run: `pnpm --filter @openldr/web typecheck && pnpm --filter @openldr/web test -- --run`
Expected: typecheck clean; all web tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/ui/card.tsx apps/web/src/pages/Dhis2.tsx apps/web/src/pages/Dhis2.test.tsx apps/web/src/App.tsx apps/web/src/shell/AppShell.tsx apps/web/src/i18n/index.ts
git commit -m "feat(dhis2): Settings/Status page + nav entry + guarded /dhis2 route"
```

---

## Task 6: Full gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run: `pnpm turbo typecheck lint test build && pnpm depcruise`
Expected: all green.

- [ ] **Step 2: Fix any failures**

If anything fails, fix it minimally and re-run. Do not proceed until green.

- [ ] **Step 3: Commit any gate fixups (if needed)**

```bash
git add -A
git commit -m "chore(dhis2): gate fixups for SP-A"
```

---

## Notes / Out of Scope

- OrgUnit mapping editor + routes → SP-B.
- Aggregate/tracker mapping authoring + validation surfacing + routes → SP-C.
- Dry-run preview, manual push, push history page, schedule management + action routes → SP-D.
- Metadata caching/persistence; editable connection config.
- Live acceptance against a real DHIS2 instance (tests use injected fakes).
