# SP-A1b — Plugin-UI Web Surface + Reference Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the browser half of plugin-contributed UI on top of the SP-A1a server foundation — the `@openldr/plugin-ui-sdk` package (types + dev mock + the host-injected SDK bootstrap), the sandboxed-iframe host with a host-minted MessagePort RPC handshake, the `/x/:pluginId` route, sidebar nav contribution, the declarative-schema form renderer, and a small **reference UI plugin** that proves the whole loop (renders a panel, round-trips its datastore, calls one gated host service) — verified end-to-end in a real browser via Playwright.

**Architecture:** A plugin's `ui.html` is **untrusted**. The host (`PluginFrame`) fetches the bytes (authenticated) from `GET /api/plugins/:id/ui/asset`, wraps them in a host-controlled document shell with a strict CSP and the **injected SDK bootstrap as the first script**, and renders it in an `<iframe sandbox="allow-scripts">` (no `allow-same-origin` → opaque origin, no token, no ambient network). The only channel is a private `MessagePort` the host transfers via a single `init` postMessage; all plugin↔host traffic is promise-based RPC over that port, forwarded by the host to `POST /api/plugins/:id/broker` (the SP-A1a broker enforces capability + role + policy). Plugins that only need configuration declare `ui.declarative` (a JSON-Schema) and the host renders standard form controls + persists answers to the plugin datastore — **no iframe**.

**Tech Stack:** TypeScript, React 18 + React Router v6, Vite (consumes workspace packages as source), Tailwind v4 + shadcn/Radix, react-i18next (en/fr/pt with compile-time key parity), Vitest + jsdom + @testing-library/react, Playwright (e2e), lucide-react (icons). A trivial Rust→wasm reuse of `wasm/test-sink` for the reference plugin's payload.

**Builds on:** SP-A1a (merged to local `main` `4a490ed`). Server contract already shipped: `GET /api/plugins/ui`, `GET /api/plugins/:id/ui/asset` (text/html + `CSP: sandbox` + nosniff), `POST /api/plugins/:id/broker` → `{ok, data|error}`. Manifest `ui` block (`entry`,`sha256`,`nav`,`uiSdkVersion`,`declarative?`), `plugin_data` store, the broker.

**Locked decisions:**
1. **Two real tiers.** A1a made `ui.entry`/`ui.sha256` required, which only supports the webview tier. Task 1 makes them **optional** so a plugin can be declarative-only (`ui.declarative` + no `entry`). The container picks: `entry` present → iframe webview; else `declarative` present → host-rendered form.
2. **SDK bootstrap is a string constant** (`SDK_BOOTSTRAP_V1`) exported from `@openldr/plugin-ui-sdk`, authored as a real function serialized via `.toString()` so its logic is reviewable; the host inlines it into the srcdoc keyed by `manifest.ui.uiSdkVersion`. The web is trusted host code, so the web injects it (not the server).
3. **Host bridge is a pure, testable module** (`wireHostPort`) taking a `MessagePortLike` + a `call(op)` fn — unit-tested with a hand-rolled linked port pair (no MessageChannel polyfill needed). The real iframe execution is proven by Playwright, since jsdom does not execute srcdoc scripts.
4. **Reference UI plugin = webview tier** (the richer path DHIS2 needs in A2): reuses the prebuilt `wasm/test-sink` binary as its payload (kind:sink, entrypoints from test-sink), a `ui.html` that awaits `openldr.ready`, round-trips `storage`, and calls `reports.list` (gated `host:reports`). The declarative tier is proven by a focused renderer component test (no second installed plugin — YAGNI).
5. **Nav icons** map a small allowlist of lucide names → components with a `Puzzle` fallback (no dynamic import of the whole icon set).

---

## File Structure

**Created — new package `packages/plugin-ui-sdk`:**
- `packages/plugin-ui-sdk/package.json`, `tsconfig.json`
- `packages/plugin-ui-sdk/src/index.ts` — barrel
- `packages/plugin-ui-sdk/src/types.ts` — `OpenLdrPluginApi`, `PluginInitContext`, `PluginBrokerOp`, `PluginRpcResult`
- `packages/plugin-ui-sdk/src/bootstrap.ts` — `SDK_BOOTSTRAP_V1` (the iframe-side runtime)
- `packages/plugin-ui-sdk/src/mock.ts` — `createMockOpenldr()` dev mock
- `packages/plugin-ui-sdk/src/*.test.ts`

**Created — web:**
- `apps/web/src/plugins/host-bridge.ts` — `wireHostPort(port, { call })`
- `apps/web/src/plugins/PluginFrame.tsx` — the sandboxed iframe host
- `apps/web/src/plugins/DeclarativeForm.tsx` — JSON-Schema → form renderer
- `apps/web/src/plugins/PluginContainer.tsx` — route component, picks tier
- `apps/web/src/plugins/icons.ts` — lucide name→component allowlist
- `apps/web/src/plugins/*.test.tsx`

**Created — reference plugin + e2e:**
- `scripts/build-ui-reference.mjs` — stages `reference-plugins/ui-reference/{plugin.wasm,manifest.json,ui.html}`
- `reference-plugins/ui-reference/ui.html` — the panel (committed; the wasm+manifest are gitignored build output)
- `e2e/plugin-ui.mjs` (or a Playwright spec under the existing e2e structure) — the end-to-end proof

**Modified:**
- `packages/marketplace/src/artifact-manifest.ts` — `uiContributionSchema`: `entry`/`sha256` optional.
- `packages/plugins/src/runtime.ts` — install requires ui bytes only when `entry` present; `loadUi` returns undefined when no `entry`.
- `apps/server/src/plugin-ui-routes.ts` — `/api/plugins/ui` returns `hasWebview` + `declarative`; asset route 404s when no `entry`.
- `apps/web/src/api.ts` — `listPluginUis`, `pluginBrokerCall`, `pluginUiAssetUrl`.
- `apps/web/src/App.tsx` — `/x/:pluginId` route.
- `apps/web/src/shell/AppShell.tsx` — render plugin nav entries.
- `apps/web/src/i18n/{en,fr,pt}.ts` — new keys.
- `apps/web/src/setupTests.ts` — only if a test needs a small DOM shim (note in the relevant task).
- root `package.json` — `build:ui-reference` script.

---

## Task 1: Manifest — make the `ui` tiers real (entry optional)

**Files:**
- Modify: `packages/marketplace/src/artifact-manifest.ts`
- Modify: `packages/plugins/src/runtime.ts`
- Modify: `apps/server/src/plugin-ui-routes.ts`
- Test: `packages/marketplace/src/artifact-manifest.test.ts`, `apps/server/src/plugin-ui-routes.test.ts`

- [ ] **Step 1: Failing test (schema allows declarative-only).** Append to `packages/marketplace/src/artifact-manifest.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseArtifactManifest } from './artifact-manifest';

describe('ui tiers', () => {
  const WASM = 'b'.repeat(64);
  it('allows a declarative-only ui block (no entry/sha256)', () => {
    const m = parseArtifactManifest({
      schemaVersion: 1, type: 'plugin', id: 'cfg', version: '1.0.0', compatibility: { ceVersion: '*' },
      payload: { kind: 'plugin', wasmSha256: WASM, ui: { nav: { label: 'Cfg' }, declarative: { type: 'object', properties: { url: { type: 'string' } } } } },
    });
    if (m.payload.kind !== 'plugin') throw new Error('plugin');
    expect(m.payload.ui?.entry).toBeUndefined();
    expect(m.payload.ui?.declarative).toBeDefined();
  });
  it('still allows a webview ui block (entry+sha256)', () => {
    const m = parseArtifactManifest({
      schemaVersion: 1, type: 'plugin', id: 'web', version: '1.0.0', compatibility: { ceVersion: '*' },
      payload: { kind: 'plugin', wasmSha256: WASM, ui: { entry: 'ui.html', sha256: 'a'.repeat(64), nav: { label: 'Web' } } },
    });
    if (m.payload.kind !== 'plugin') throw new Error('plugin');
    expect(m.payload.ui?.entry).toBe('ui.html');
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`entry`/`sha256` currently required): `pnpm -C packages/marketplace test -- artifact-manifest`

- [ ] **Step 3: Relax the schema.** In `packages/marketplace/src/artifact-manifest.ts`, in `uiContributionSchema`, make `entry` and `sha256` optional and add a refinement so a webview ui block carries BOTH or neither:

```typescript
export const uiContributionSchema = z.object({
  entry: z.string().min(1).optional(),
  sha256: z.string().regex(HEX64).optional(),
  nav: z.object({
    label: z.string().min(1),
    icon: z.string().min(1).default('puzzle'),
    section: z.string().min(1).default('apps'),
  }),
  uiSdkVersion: z.literal('1').default('1'),
  declarative: z.unknown().optional(), // SP-A1b will narrow to a JSON-Schema record once the renderer consumes it
}).refine((u) => (u.entry === undefined) === (u.sha256 === undefined), {
  message: 'ui.entry and ui.sha256 must be provided together (a webview tier) or both omitted (declarative tier)',
});
```

- [ ] **Step 4: Run, expect PASS:** `pnpm -C packages/marketplace test -- artifact-manifest`

- [ ] **Step 5: Install — require ui bytes only when entry present.** In `packages/plugins/src/runtime.ts`, change the ui-validation block so it only fires when `uiMeta.entry` is set:

```typescript
      const uiMeta = artifact.payload.kind === 'plugin' ? artifact.payload.ui : undefined;
      if (uiMeta?.entry) {
        if (!opts.ui) throw new Error(`artifact ${artifact.id}: manifest declares payload.ui.entry but no ui bytes were provided`);
        const uiSha = sha256Hex(opts.ui);
        if (uiSha !== uiMeta.sha256) {
          throw new Error(`artifact ${artifact.id}: ui.html sha (${uiSha}) does not match manifest payload.ui.sha256 (${uiMeta.sha256})`);
        }
      }
```

And the persist guard (after `manifestKey` put):

```typescript
      if (uiMeta?.entry && opts.ui) {
        await deps.blob.put(uiKey(artifact.id, artifact.version), opts.ui, 'text/html');
      }
```

And `loadUi` — return undefined when no `entry`:

```typescript
    async loadUi(id, version) {
      const row = await deps.store.get(id, version);
      if (!row) return undefined;
      const m = row.manifest as { payload?: { ui?: { entry?: string } } };
      if (!m.payload?.ui?.entry) return undefined;
      try { return await deps.blob.get(uiKey(row.id, row.version)); } catch { return undefined; }
    },
```

- [ ] **Step 6: Server route — expose tier flags + the declarative schema.** In `apps/server/src/plugin-ui-routes.ts`, widen the `UiPluginRow` ui type to `{ entry?: string; sha256?: string; nav: {...}; uiSdkVersion: string; declarative?: unknown }`, and change the `/api/plugins/ui` map to:

```typescript
      .filter((r) => r.enabled && r.manifest.payload?.kind === 'plugin' && r.manifest.payload.ui)
      .map((r) => {
        const ui = r.manifest.payload!.ui!;
        return {
          id: r.id, version: r.version, nav: ui.nav, uiSdkVersion: ui.uiSdkVersion,
          hasWebview: ui.entry !== undefined,
          hasDeclarative: ui.declarative !== undefined,
          declarative: ui.declarative ?? null,
        };
      });
```

The asset route already returns 404 when `loadUi` yields undefined — with Step 5 that now also covers declarative-only plugins. No change needed there.

- [ ] **Step 7: Update the route test.** In `apps/server/src/plugin-ui-routes.test.ts`, update the existing list test's expectation to include `hasWebview: true, hasDeclarative: false, declarative: null` for `ui-demo`, and add a fixture row for a declarative-only plugin asserting `hasWebview: false, hasDeclarative: true` and that its `declarative` schema round-trips. (Match the existing fakeCtx shape; the manifest for the declarative fixture has `ui: { nav: {...}, declarative: { type: 'object', properties: {} } }` and no `entry`.)

- [ ] **Step 8: Verify + typecheck:** `pnpm -C packages/marketplace test -- artifact-manifest && pnpm -C packages/plugins test -- runtime && pnpm -C apps/server test -- plugin-ui-routes && pnpm -C packages/marketplace typecheck && pnpm -C packages/plugins typecheck && pnpm -C apps/server typecheck`

- [ ] **Step 9: Commit**

```bash
git add packages/marketplace/src/artifact-manifest.ts packages/marketplace/src/artifact-manifest.test.ts packages/plugins/src/runtime.ts apps/server/src/plugin-ui-routes.ts apps/server/src/plugin-ui-routes.test.ts
git commit -m "feat(marketplace): ui tiers — entry/sha256 optional for declarative-only plugins (SP-A1b)"
```

---

## Task 2: `@openldr/plugin-ui-sdk` package — types + dev mock

**Files:**
- Create: `packages/plugin-ui-sdk/package.json`, `tsconfig.json`, `src/index.ts`, `src/types.ts`, `src/mock.ts`, `src/mock.test.ts`

- [ ] **Step 1: Scaffold the package.** Create `packages/plugin-ui-sdk/package.json`:

```json
{
  "name": "@openldr/plugin-ui-sdk",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo \"no lint\""
  },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

Create `packages/plugin-ui-sdk/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 2: Types.** Create `packages/plugin-ui-sdk/src/types.ts`:

```typescript
/** The init context the host mints and transfers to the plugin iframe. */
export interface PluginInitContext {
  pluginId: string;
  capabilities: string[]; // capability kinds granted (e.g. 'host:reports')
  theme: 'light' | 'dark';
  locale: string;
  sessionId: string; // host-minted, opaque to the plugin
}

/** Operations the plugin may request (mirror of the host broker's BrokerOp). */
export type PluginBrokerOp =
  | { kind: 'storage.get'; collection: string; key: string }
  | { kind: 'storage.put'; collection: string; key: string; doc: unknown }
  | { kind: 'storage.delete'; collection: string; key: string }
  | { kind: 'storage.list'; collection: string; where?: { field: string; eq: unknown }; limit?: number }
  | { kind: 'invoke'; entrypoint: string; input: unknown }
  | { kind: 'reports.list' }
  | { kind: 'reports.columns'; id: string }
  | { kind: 'reports.run'; id: string; params?: Record<string, unknown> }
  | { kind: 'connectors.list' }
  | { kind: 'connectors.test'; id: string };

export type PluginRpcResult = { ok: true; data: unknown } | { ok: false; error: string };

/** The `window.openldr` surface available to plugin code inside the iframe. */
export interface OpenLdrPluginApi {
  readonly pluginId: string;
  readonly capabilities: readonly string[];
  readonly theme: 'light' | 'dark';
  readonly locale: string;
  /** Resolves once the host handshake completes; plugin code must await this first. */
  readonly ready: Promise<void>;
  storage: {
    get(collection: string, key: string): Promise<unknown>;
    put(collection: string, key: string, doc: unknown): Promise<void>;
    delete(collection: string, key: string): Promise<void>;
    list(collection: string, opts?: { where?: { field: string; eq: unknown }; limit?: number }): Promise<Array<{ collection: string; key: string; doc: unknown }>>;
  };
  invoke(entrypoint: string, input: unknown): Promise<unknown>;
  reports: {
    list(): Promise<unknown>;
    columns(id: string): Promise<unknown>;
    run(id: string, params?: Record<string, unknown>): Promise<unknown>;
  };
  connectors: {
    list(): Promise<unknown>;
    test(id: string): Promise<unknown>;
  };
}

declare global {
  interface Window { openldr?: OpenLdrPluginApi }
}
```

- [ ] **Step 3: Dev mock (failing test first).** Create `packages/plugin-ui-sdk/src/mock.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createMockOpenldr } from './mock';

describe('createMockOpenldr', () => {
  it('round-trips storage in-memory and resolves ready', async () => {
    const api = createMockOpenldr({ pluginId: 'p1', capabilities: ['host:reports'] });
    await api.ready;
    await api.storage.put('c', 'k', { n: 1 });
    expect(await api.storage.get('c', 'k')).toEqual({ n: 1 });
    const list = await api.storage.list('c');
    expect(list).toEqual([{ collection: 'c', key: 'k', doc: { n: 1 } }]);
  });
  it('reports.list returns the seeded fixture', async () => {
    const api = createMockOpenldr({ pluginId: 'p1', capabilities: ['host:reports'], reports: [{ id: 'r1' }] });
    expect(await api.reports.list()).toEqual([{ id: 'r1' }]);
  });
});
```

- [ ] **Step 4: Run, expect FAIL:** `pnpm -C packages/plugin-ui-sdk test`

- [ ] **Step 5: Implement the mock.** Create `packages/plugin-ui-sdk/src/mock.ts`:

```typescript
import type { OpenLdrPluginApi } from './types';

export interface MockOptions {
  pluginId: string;
  capabilities?: string[];
  theme?: 'light' | 'dark';
  locale?: string;
  reports?: unknown[];
}

/** An in-memory implementation of OpenLdrPluginApi for local plugin development + tests. */
export function createMockOpenldr(opts: MockOptions): OpenLdrPluginApi {
  const mem = new Map<string, unknown>();
  const k = (c: string, key: string) => `${c} ${key}`;
  return {
    pluginId: opts.pluginId,
    capabilities: opts.capabilities ?? [],
    theme: opts.theme ?? 'light',
    locale: opts.locale ?? 'en',
    ready: Promise.resolve(),
    storage: {
      async get(c, key) { return mem.has(k(c, key)) ? mem.get(k(c, key)) : null; },
      async put(c, key, doc) { mem.set(k(c, key), doc); },
      async delete(c, key) { mem.delete(k(c, key)); },
      async list(c) {
        return [...mem.entries()]
          .filter(([kk]) => kk.startsWith(`${c} `))
          .map(([kk, doc]) => ({ collection: c, key: kk.split(' ')[1], doc }));
      },
    },
    async invoke(_e, input) { return { echoed: input }; },
    reports: {
      async list() { return opts.reports ?? []; },
      async columns() { return []; },
      async run() { return { columns: [], rows: [] }; },
    },
    connectors: { async list() { return []; }, async test() { return { ok: true }; } },
  };
}
```

- [ ] **Step 6: Barrel.** Create `packages/plugin-ui-sdk/src/index.ts`:

```typescript
export * from './types';
export * from './mock';
export * from './bootstrap';
```

(`bootstrap` is added in Task 3; create the file now as `export {};` placeholder OR sequence Task 3 before running this — to keep TDD clean, add `export * from './bootstrap';` only after Task 3 creates it. For now barrel only types + mock, and add the bootstrap line in Task 3.)

Adjust: create `src/index.ts` with just:

```typescript
export * from './types';
export * from './mock';
```

- [ ] **Step 7: Install workspace deps + verify.** Run `pnpm install` (registers the new package), then `pnpm -C packages/plugin-ui-sdk test && pnpm -C packages/plugin-ui-sdk typecheck`.

- [ ] **Step 8: Commit**

```bash
git add packages/plugin-ui-sdk pnpm-lock.yaml
git commit -m "feat(plugin-ui-sdk): new package — OpenLdrPluginApi types + dev mock (SP-A1b)"
```

---

## Task 3: SDK bootstrap (`SDK_BOOTSTRAP_V1`)

**Files:**
- Create: `packages/plugin-ui-sdk/src/bootstrap.ts`
- Create: `packages/plugin-ui-sdk/src/bootstrap.test.ts`
- Modify: `packages/plugin-ui-sdk/src/index.ts`

The bootstrap runs **inside the sandboxed iframe**, as the first script. It must be self-contained (no imports). We author it as a function and serialize it, so its logic is reviewable + lint-clean.

- [ ] **Step 1: Failing test.** Create `packages/plugin-ui-sdk/src/bootstrap.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SDK_BOOTSTRAP_V1 } from './bootstrap';

describe('SDK_BOOTSTRAP_V1', () => {
  it('is a self-invoking script string referencing the init handshake + api surface', () => {
    expect(typeof SDK_BOOTSTRAP_V1).toBe('string');
    expect(SDK_BOOTSTRAP_V1.length).toBeGreaterThan(100);
    // It must wire the init message, the ready promise, and the window.openldr surface.
    expect(SDK_BOOTSTRAP_V1).toContain('openldr:init');
    expect(SDK_BOOTSTRAP_V1).toContain('window.openldr');
    expect(SDK_BOOTSTRAP_V1).toMatch(/ready/);
    expect(SDK_BOOTSTRAP_V1).toMatch(/ports\[0\]/);
  });
  it('correlates RPC by id and resolves/rejects per the host result (logic check)', async () => {
    // Exercise the SAME RPC logic the bootstrap uses, via the exported testable core.
    const { makeRpc } = await import('./bootstrap');
    const sent: unknown[] = [];
    const fakePort = { postMessage: (m: unknown) => sent.push(m), onmessage: null as null | ((e: { data: unknown }) => void) };
    const rpc = makeRpc(fakePort as never);
    const p = rpc.call({ kind: 'reports.list' });
    // host replies over the port:
    const req = sent[0] as { id: number };
    fakePort.onmessage?.({ data: { id: req.id, result: { ok: true, data: [{ id: 'r1' }] } } });
    expect(await p).toEqual([{ id: 'r1' }]);
  });
  it('rejects when the host result is not ok', async () => {
    const { makeRpc } = await import('./bootstrap');
    const sent: unknown[] = [];
    const fakePort = { postMessage: (m: unknown) => sent.push(m), onmessage: null as null | ((e: { data: unknown }) => void) };
    const rpc = makeRpc(fakePort as never);
    const p = rpc.call({ kind: 'reports.list' });
    const req = sent[0] as { id: number };
    fakePort.onmessage?.({ data: { id: req.id, result: { ok: false, error: 'denied' } } });
    await expect(p).rejects.toThrow(/denied/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL:** `pnpm -C packages/plugin-ui-sdk test -- bootstrap`

- [ ] **Step 3: Implement.** Create `packages/plugin-ui-sdk/src/bootstrap.ts`:

```typescript
import type { PluginBrokerOp, PluginRpcResult } from './types';

/** Minimal MessagePort surface used by the RPC core (works for real ports + test fakes). */
export interface PortLike {
  postMessage(message: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  start?(): void;
}

/** Promise-based, id-correlated RPC over a MessagePort. Shared by the bootstrap (in-iframe)
 *  so the host can reply { id, result } and the plugin's await resolves/rejects accordingly. */
export function makeRpc(port: PortLike): { call(op: PluginBrokerOp): Promise<unknown> } {
  let seq = 0;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  port.onmessage = (ev) => {
    const msg = ev.data as { id?: number; result?: PluginRpcResult };
    if (typeof msg?.id !== 'number') return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    const r = msg.result;
    if (r && r.ok) waiter.resolve(r.data);
    else waiter.reject(new Error(r && !r.ok ? r.error : 'plugin host call failed'));
  };
  port.start?.();
  return {
    call(op) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        port.postMessage({ id, op });
      });
    },
  };
}

/** The in-iframe runtime, authored as a function so it is reviewable + lintable, then
 *  serialized into SDK_BOOTSTRAP_V1. It references only browser globals (window) and inlines
 *  its own RPC (it cannot import makeRpc at runtime inside the iframe). Keep the two in sync. */
function pluginBootstrapV1(): void {
  let resolveReady: () => void;
  const ready = new Promise<void>((r) => { resolveReady = r; });
  let port: MessagePort | null = null;
  let seq = 0;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();

  function call(op: unknown): Promise<unknown> {
    if (!port) return Promise.reject(new Error('openldr: not initialized'));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      port!.postMessage({ id, op });
    });
  }

  window.addEventListener('message', (ev: MessageEvent) => {
    const data = ev.data as { type?: string; context?: Record<string, unknown> } | undefined;
    if (!data || data.type !== 'openldr:init' || port) return; // only the first init, with a port
    port = ev.ports[0];
    if (!port) return;
    port.onmessage = (e: MessageEvent) => {
      const m = e.data as { id?: number; result?: { ok: boolean; data?: unknown; error?: string } };
      if (typeof m?.id !== 'number') return;
      const w = pending.get(m.id);
      if (!w) return;
      pending.delete(m.id);
      if (m.result && m.result.ok) w.resolve(m.result.data);
      else w.reject(new Error(m.result?.error ?? 'plugin host call failed'));
    };
    port.start();
    const ctx = (data.context ?? {}) as { pluginId?: string; capabilities?: string[]; theme?: string; locale?: string };
    (window as unknown as { openldr: unknown }).openldr = {
      pluginId: ctx.pluginId ?? '',
      capabilities: ctx.capabilities ?? [],
      theme: ctx.theme ?? 'light',
      locale: ctx.locale ?? 'en',
      ready,
      storage: {
        get: (c: string, k: string) => call({ kind: 'storage.get', collection: c, key: k }),
        put: (c: string, k: string, doc: unknown) => call({ kind: 'storage.put', collection: c, key: k, doc }),
        delete: (c: string, k: string) => call({ kind: 'storage.delete', collection: c, key: k }),
        list: (c: string, o?: unknown) => call({ kind: 'storage.list', collection: c, ...(o as object ?? {}) }),
      },
      invoke: (entrypoint: string, input: unknown) => call({ kind: 'invoke', entrypoint, input }),
      reports: {
        list: () => call({ kind: 'reports.list' }),
        columns: (id: string) => call({ kind: 'reports.columns', id }),
        run: (id: string, params?: Record<string, unknown>) => call({ kind: 'reports.run', id, params }),
      },
      connectors: {
        list: () => call({ kind: 'connectors.list' }),
        test: (id: string) => call({ kind: 'connectors.test', id }),
      },
    };
    resolveReady();
  });
}

/** The bootstrap source the host inlines as the first <script> in the iframe document. */
export const SDK_BOOTSTRAP_V1: string = `(${pluginBootstrapV1.toString()})();`;
```

- [ ] **Step 4: Wire the barrel.** In `packages/plugin-ui-sdk/src/index.ts` add `export * from './bootstrap';`.

- [ ] **Step 5: Run, expect PASS:** `pnpm -C packages/plugin-ui-sdk test && pnpm -C packages/plugin-ui-sdk typecheck`

> Note: `pluginBootstrapV1` is serialized via `.toString()`, so it must not reference module-scope identifiers (it doesn't — only `window` + locals). The `makeRpc` export mirrors its RPC logic and is what the unit tests exercise; keep the two correlation implementations behaviorally identical.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-ui-sdk/src/bootstrap.ts packages/plugin-ui-sdk/src/bootstrap.test.ts packages/plugin-ui-sdk/src/index.ts
git commit -m "feat(plugin-ui-sdk): SDK_BOOTSTRAP_V1 in-iframe runtime + id-correlated RPC (SP-A1b)"
```

---

## Task 4: Web API client helpers

**Files:**
- Modify: `apps/web/src/api.ts`
- Test: `apps/web/src/api.plugins.test.ts` (create)

- [ ] **Step 1: Failing test.** Create `apps/web/src/api.plugins.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listPluginUis, pluginBrokerCall, pluginUiAssetUrl } from './api';

describe('plugin-ui api', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('listPluginUis GETs /api/plugins/ui', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => [{ id: 'ui-demo', nav: { label: 'Demo' } }] });
    const r = await listPluginUis();
    expect((fetch as any).mock.calls[0][0]).toContain('/api/plugins/ui');
    expect(r[0].id).toBe('ui-demo');
  });

  it('pluginBrokerCall POSTs { op } to the plugin broker and returns the result', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: [{ id: 'r1' }] }) });
    const r = await pluginBrokerCall('ui-demo', { kind: 'reports.list' });
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toContain('/api/plugins/ui-demo/broker');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ op: { kind: 'reports.list' } });
    expect(r).toEqual({ ok: true, data: [{ id: 'r1' }] });
  });

  it('pluginUiAssetUrl builds the asset path', () => {
    expect(pluginUiAssetUrl('ui-demo')).toBe('/api/plugins/ui-demo/ui/asset');
  });
});
```

- [ ] **Step 2: Run, expect FAIL:** `pnpm -C apps/web test -- api.plugins`

- [ ] **Step 3: Implement.** In `apps/web/src/api.ts`, add (use the existing `authFetch`, `apiGet`, `jbody`, `okJson` helpers — match their signatures):

```typescript
import type { PluginBrokerOp, PluginRpcResult } from '@openldr/plugin-ui-sdk';

export interface PluginUiEntry {
  id: string;
  version: string;
  nav: { label: string; icon: string; section: string };
  uiSdkVersion: string;
  hasWebview: boolean;
  hasDeclarative: boolean;
  declarative: unknown | null;
}

export const listPluginUis = (): Promise<PluginUiEntry[]> =>
  apiGet<PluginUiEntry[]>('/api/plugins/ui', 'list plugin UIs');

export const pluginUiAssetUrl = (id: string): string => `/api/plugins/${encodeURIComponent(id)}/ui/asset`;

export const pluginBrokerCall = (id: string, op: PluginBrokerOp): Promise<PluginRpcResult> =>
  authFetch(`/api/plugins/${encodeURIComponent(id)}/broker`, jbody({ op }, 'POST'))
    .then((r) => okJson<PluginRpcResult>(r, 'plugin broker call'));
```

Add `@openldr/plugin-ui-sdk` to `apps/web/package.json` dependencies as `"@openldr/plugin-ui-sdk": "workspace:*"` (mirror the `@openldr/forms` entry), then `pnpm install`.

- [ ] **Step 4: Run, expect PASS:** `pnpm -C apps/web test -- api.plugins && pnpm -C apps/web typecheck`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/api.plugins.test.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): plugin-ui api client (list, broker call, asset url) (SP-A1b)"
```

---

## Task 5: Host bridge (`wireHostPort`)

**Files:**
- Create: `apps/web/src/plugins/host-bridge.ts`
- Create: `apps/web/src/plugins/host-bridge.test.ts`

The bridge listens on the host's end of the MessagePort for `{ id, op }` from the plugin, calls the broker, and posts back `{ id, result }`.

- [ ] **Step 1: Failing test.** Create `apps/web/src/plugins/host-bridge.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { wireHostPort, type HostPortLike } from './host-bridge';

// Hand-rolled linked port pair (no MessageChannel polyfill needed).
function linkedPorts(): [HostPortLike, { post(m: unknown): void; onmessage: ((e: { data: unknown }) => void) | null }] {
  let aOnmessage: ((e: { data: unknown }) => void) | null = null;
  const peer = { onmessage: null as null | ((e: { data: unknown }) => void), post(m: unknown) { aOnmessage?.({ data: m }); } };
  const host: HostPortLike = {
    set onmessage(fn) { aOnmessage = fn; },
    get onmessage() { return aOnmessage; },
    postMessage(m: unknown) { peer.onmessage?.({ data: m }); },
    start() {},
  };
  return [host, peer];
}

describe('wireHostPort', () => {
  it('forwards a plugin op to the broker call and replies with the result, correlated by id', async () => {
    const [host, peer] = linkedPorts();
    const call = vi.fn(async () => ({ ok: true, data: [{ id: 'r1' }] }));
    wireHostPort(host, { call });
    const replies: any[] = [];
    peer.onmessage = (e) => replies.push(e.data);
    peer.post({ id: 7, op: { kind: 'reports.list' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(call).toHaveBeenCalledWith({ kind: 'reports.list' });
    expect(replies).toEqual([{ id: 7, result: { ok: true, data: [{ id: 'r1' }] } }]);
  });

  it('a thrown/rejected call still replies ok:false (never leaves the plugin hanging)', async () => {
    const [host, peer] = linkedPorts();
    const call = vi.fn(async () => { throw new Error('boom'); });
    wireHostPort(host, { call });
    const replies: any[] = [];
    peer.onmessage = (e) => replies.push(e.data);
    peer.post({ id: 1, op: { kind: 'reports.list' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(replies[0]).toEqual({ id: 1, result: { ok: false, error: 'boom' } });
  });

  it('ignores malformed messages (no id)', async () => {
    const [host, peer] = linkedPorts();
    const call = vi.fn(async () => ({ ok: true, data: null }));
    wireHostPort(host, { call });
    peer.post({ op: { kind: 'reports.list' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(call).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL:** `pnpm -C apps/web test -- host-bridge`

- [ ] **Step 3: Implement.** Create `apps/web/src/plugins/host-bridge.ts`:

```typescript
import type { PluginBrokerOp, PluginRpcResult } from '@openldr/plugin-ui-sdk';

export interface HostPortLike {
  postMessage(message: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  start?(): void;
}

export interface HostBridgeDeps {
  /** Forward an op to the server broker; must resolve to a structured result (never throw
   *  in normal operation, but the bridge defends against throws too). */
  call(op: PluginBrokerOp): Promise<PluginRpcResult>;
}

/** Wire the host end of the plugin MessagePort: plugin posts { id, op }; we call the broker
 *  and post back { id, result }. A thrown call is converted to ok:false so the plugin's RPC
 *  never hangs. */
export function wireHostPort(port: HostPortLike, deps: HostBridgeDeps): void {
  port.onmessage = (ev) => {
    const msg = ev.data as { id?: number; op?: PluginBrokerOp };
    if (typeof msg?.id !== 'number' || !msg.op) return;
    const id = msg.id;
    deps
      .call(msg.op)
      .then((result) => port.postMessage({ id, result }))
      .catch((err: unknown) => port.postMessage({ id, result: { ok: false, error: err instanceof Error ? err.message : String(err) } }));
  };
  port.start?.();
}
```

- [ ] **Step 4: Run, expect PASS:** `pnpm -C apps/web test -- host-bridge && pnpm -C apps/web typecheck`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/plugins/host-bridge.ts apps/web/src/plugins/host-bridge.test.ts
git commit -m "feat(web): host-bridge — forwards plugin MessagePort RPC to the broker (SP-A1b)"
```

---

## Task 6: `PluginFrame` — the sandboxed iframe host

**Files:**
- Create: `apps/web/src/plugins/PluginFrame.tsx`
- Create: `apps/web/src/plugins/PluginFrame.test.tsx`

- [ ] **Step 1: Failing test.** Create `apps/web/src/plugins/PluginFrame.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { PluginFrame } from './PluginFrame';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual,
    pluginUiAssetUrl: (id: string) => `/api/plugins/${id}/ui/asset`,
    pluginBrokerCall: vi.fn(async () => ({ ok: true, data: null })),
  };
});

describe('PluginFrame', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '<div id="panel">hi</div>' })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders a sandboxed iframe (allow-scripts, NOT allow-same-origin) with the wrapped doc', async () => {
    const { container } = render(<PluginFrame pluginId="ui-demo" context={{ pluginId: 'ui-demo', capabilities: [], theme: 'light', locale: 'en', sessionId: 's1' }} />);
    const iframe = await waitFor(() => {
      const f = container.querySelector('iframe');
      if (!f || !f.getAttribute('srcdoc')) throw new Error('not ready');
      return f as HTMLIFrameElement;
    });
    const sandbox = iframe.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
    const srcdoc = iframe.getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain('<div id="panel">hi</div>'); // plugin body
    expect(srcdoc).toContain('openldr:init'); // injected bootstrap present
    expect(srcdoc).toContain('Content-Security-Policy'); // host-controlled shell CSP
  });
});
```

- [ ] **Step 2: Run, expect FAIL:** `pnpm -C apps/web test -- PluginFrame`

- [ ] **Step 3: Implement.** Create `apps/web/src/plugins/PluginFrame.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react';
import { SDK_BOOTSTRAP_V1, type PluginInitContext } from '@openldr/plugin-ui-sdk';
import { authFetch, pluginUiAssetUrl, pluginBrokerCall } from '@/api';
import { wireHostPort } from './host-bridge';

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'";

/** Wrap the plugin's body HTML in a host-controlled document: strict CSP + the injected SDK
 *  bootstrap as the FIRST script, then the plugin content. No same-origin, no network. */
function buildSrcdoc(pluginBodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"></head><body><script>${SDK_BOOTSTRAP_V1}</script>${pluginBodyHtml}</body></html>`;
}

export function PluginFrame({ pluginId, context }: { pluginId: string; context: PluginInitContext }): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [srcdoc, setSrcdoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authFetch(pluginUiAssetUrl(pluginId))
      .then(async (r) => { if (!r.ok) throw new Error(`asset ${r.status}`); return r.text(); })
      .then((html) => { if (!cancelled) setSrcdoc(buildSrcdoc(html)); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [pluginId]);

  // On iframe load, mint a private MessagePort, wire the host end to the broker, and post init.
  function onLoad() {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const channel = new MessageChannel();
    wireHostPort(channel.port1, { call: (op) => pluginBrokerCall(pluginId, op) });
    channel.port1.start();
    win.postMessage({ type: 'openldr:init', context }, '*', [channel.port2]);
  }

  if (error) return <div className="p-6 text-sm text-destructive">Failed to load plugin UI: {error}</div>;
  if (!srcdoc) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  return (
    <iframe
      ref={iframeRef}
      title={`plugin-${pluginId}`}
      sandbox="allow-scripts"
      srcDoc={srcdoc}
      onLoad={onLoad}
      className="h-full w-full border-0"
    />
  );
}
```

- [ ] **Step 4: Run, expect PASS:** `pnpm -C apps/web test -- PluginFrame && pnpm -C apps/web typecheck`

> jsdom does not execute srcdoc scripts and may not fire `onLoad` for srcdoc; the test only asserts the rendered attributes + wrapped document. The live `init`/handshake is proven in the Playwright e2e (Task 12). `new MessageChannel()` is only constructed inside `onLoad`, which jsdom won't invoke during this test — so no MessageChannel polyfill is needed here.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/plugins/PluginFrame.tsx apps/web/src/plugins/PluginFrame.test.tsx
git commit -m "feat(web): PluginFrame — sandboxed iframe host + MessagePort init handshake (SP-A1b)"
```

---

## Task 7: `DeclarativeForm` — JSON-Schema → form (declarative tier)

**Files:**
- Create: `apps/web/src/plugins/DeclarativeForm.tsx`
- Create: `apps/web/src/plugins/DeclarativeForm.test.tsx`

A minimal renderer for a flat object JSON-Schema: `{ type: 'object', properties: { <key>: { type: 'string'|'number'|'boolean', title?, enum? } } }`. Loads current values from the plugin datastore (broker `storage.get` on collection `config`, key `declarative`) and saves on submit.

- [ ] **Step 1: Failing test.** Create `apps/web/src/plugins/DeclarativeForm.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeclarativeForm } from './DeclarativeForm';
import * as api from '@/api';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, pluginBrokerCall: vi.fn() };
});

const schema = { type: 'object', properties: {
  baseUrl: { type: 'string', title: 'Base URL' },
  retries: { type: 'number', title: 'Retries' },
  enabled: { type: 'boolean', title: 'Enabled' },
} };

describe('DeclarativeForm', () => {
  beforeEach(() => {
    (api.pluginBrokerCall as any).mockReset();
    (api.pluginBrokerCall as any).mockResolvedValueOnce({ ok: true, data: { baseUrl: 'https://x', retries: 2, enabled: true } }); // initial load
  });

  it('renders fields from the schema and saves edited values via the broker', async () => {
    (api.pluginBrokerCall as any).mockResolvedValue({ ok: true, data: null }); // subsequent put
    render(<DeclarativeForm pluginId="cfg" schema={schema} />);
    const url = await screen.findByLabelText('Base URL') as HTMLInputElement;
    expect(url.value).toBe('https://x');
    fireEvent.change(url, { target: { value: 'https://y' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      const putCall = (api.pluginBrokerCall as any).mock.calls.find((c: any) => c[1]?.kind === 'storage.put');
      expect(putCall[1]).toMatchObject({ kind: 'storage.put', collection: 'config', key: 'declarative', doc: { baseUrl: 'https://y', retries: 2, enabled: true } });
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL:** `pnpm -C apps/web test -- DeclarativeForm`

- [ ] **Step 3: Implement.** Create `apps/web/src/plugins/DeclarativeForm.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pluginBrokerCall } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface JsonProp { type: 'string' | 'number' | 'boolean'; title?: string; enum?: string[] }
interface JsonSchema { type: 'object'; properties: Record<string, JsonProp> }

const COLLECTION = 'config';
const KEY = 'declarative';

export function DeclarativeForm({ pluginId, schema }: { pluginId: string; schema: unknown }): JSX.Element {
  const { t } = useTranslation();
  const props = ((schema as JsonSchema | null)?.properties) ?? {};
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void pluginBrokerCall(pluginId, { kind: 'storage.get', collection: COLLECTION, key: KEY }).then((r) => {
      if (!cancelled && r.ok && r.data && typeof r.data === 'object') setValues(r.data as Record<string, unknown>);
    });
    return () => { cancelled = true; };
  }, [pluginId]);

  function set(k: string, v: unknown) { setValues((prev) => ({ ...prev, [k]: v })); }

  async function save() {
    setSaving(true);
    try { await pluginBrokerCall(pluginId, { kind: 'storage.put', collection: COLLECTION, key: KEY, doc: values }); }
    finally { setSaving(false); }
  }

  return (
    <div className="max-w-xl space-y-4 p-6">
      {Object.entries(props).map(([key, p]) => {
        const label = p.title ?? key;
        if (p.type === 'boolean') {
          return (
            <div key={key} className="flex items-center justify-between">
              <Label htmlFor={key}>{label}</Label>
              <Switch id={key} checked={Boolean(values[key])} onCheckedChange={(c) => set(key, c)} />
            </div>
          );
        }
        if (p.enum) {
          return (
            <div key={key} className="space-y-1">
              <Label htmlFor={key}>{label}</Label>
              <Select value={String(values[key] ?? '')} onValueChange={(v) => set(key, v)}>
                <SelectTrigger id={key}><SelectValue /></SelectTrigger>
                <SelectContent>{p.enum.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          );
        }
        return (
          <div key={key} className="space-y-1">
            <Label htmlFor={key}>{label}</Label>
            <Input
              id={key}
              type={p.type === 'number' ? 'number' : 'text'}
              value={String(values[key] ?? '')}
              onChange={(e) => set(key, p.type === 'number' ? Number(e.target.value) : e.target.value)}
            />
          </div>
        );
      })}
      <Button onClick={save} disabled={saving}>{t('common.save')}</Button>
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS:** `pnpm -C apps/web test -- DeclarativeForm && pnpm -C apps/web typecheck`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/plugins/DeclarativeForm.tsx apps/web/src/plugins/DeclarativeForm.test.tsx
git commit -m "feat(web): DeclarativeForm — JSON-Schema config tier persisted via the broker (SP-A1b)"
```

---

## Task 8: `PluginContainer` + `/x/:pluginId` route + icon map

**Files:**
- Create: `apps/web/src/plugins/icons.ts`
- Create: `apps/web/src/plugins/PluginContainer.tsx`
- Create: `apps/web/src/plugins/PluginContainer.test.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Icon allowlist.** Create `apps/web/src/plugins/icons.ts`:

```typescript
import { Puzzle, Share2, BarChart3, Database, Plug, Settings, FileText, type LucideIcon } from 'lucide-react';

const MAP: Record<string, LucideIcon> = {
  puzzle: Puzzle, 'share-2': Share2, 'bar-chart-3': BarChart3, database: Database, plug: Plug, settings: Settings, 'file-text': FileText,
};

/** Resolve a manifest nav icon name to a lucide component, falling back to Puzzle. */
export function pluginIcon(name: string | undefined): LucideIcon {
  return (name && MAP[name]) || Puzzle;
}
```

- [ ] **Step 2: Failing test.** Create `apps/web/src/plugins/PluginContainer.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PluginContainer } from './PluginContainer';
import * as api from '@/api';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listPluginUis: vi.fn() };
});
vi.mock('./PluginFrame', () => ({ PluginFrame: ({ pluginId }: { pluginId: string }) => <div data-testid="frame">{pluginId}</div> }));
vi.mock('./DeclarativeForm', () => ({ DeclarativeForm: ({ pluginId }: { pluginId: string }) => <div data-testid="declform">{pluginId}</div> }));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u', roles: ['lab_admin'] }, hasRole: () => true }) }));

function renderAt(id: string) {
  return render(<MemoryRouter initialEntries={[`/x/${id}`]}><Routes><Route path="/x/:pluginId" element={<PluginContainer />} /></Routes></MemoryRouter>);
}

describe('PluginContainer', () => {
  it('renders PluginFrame for a webview plugin', async () => {
    (api.listPluginUis as any).mockResolvedValue([{ id: 'web', version: '1', nav: { label: 'W', icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1', hasWebview: true, hasDeclarative: false, declarative: null }]);
    renderAt('web');
    await waitFor(() => expect(screen.getByTestId('frame')).toHaveTextContent('web'));
  });
  it('renders DeclarativeForm for a declarative-only plugin', async () => {
    (api.listPluginUis as any).mockResolvedValue([{ id: 'cfg', version: '1', nav: { label: 'C', icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1', hasWebview: false, hasDeclarative: true, declarative: { type: 'object', properties: {} } }]);
    renderAt('cfg');
    await waitFor(() => expect(screen.getByTestId('declform')).toHaveTextContent('cfg'));
  });
  it('shows not-found for an unknown plugin', async () => {
    (api.listPluginUis as any).mockResolvedValue([]);
    renderAt('ghost');
    await waitFor(() => expect(screen.getByText(/not found|not installed/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Run, expect FAIL:** `pnpm -C apps/web test -- PluginContainer`

- [ ] **Step 4: Implement.** Create `apps/web/src/plugins/PluginContainer.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { listPluginUis, type PluginUiEntry } from '@/api';
import { PluginFrame } from './PluginFrame';
import { DeclarativeForm } from './DeclarativeForm';

export function PluginContainer(): JSX.Element {
  const { pluginId = '' } = useParams();
  const { t } = useTranslation();
  const [entry, setEntry] = useState<PluginUiEntry | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void listPluginUis().then((list) => { if (!cancelled) setEntry(list.find((e) => e.id === pluginId) ?? null); });
    return () => { cancelled = true; };
  }, [pluginId]);

  if (entry === undefined) return <div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div>;
  if (entry === null) return <div className="p-6 text-sm text-muted-foreground">{t('plugins.notFound')}</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-3 text-lg font-semibold">{entry.nav.label}</div>
      <div className="min-h-0 flex-1">
        {entry.hasWebview ? (
          <PluginFrame
            pluginId={entry.id}
            context={{ pluginId: entry.id, capabilities: [], theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light', locale: i18n.language, sessionId: crypto.randomUUID() }}
          />
        ) : entry.hasDeclarative ? (
          <DeclarativeForm pluginId={entry.id} schema={entry.declarative} />
        ) : (
          <div className="p-6 text-sm text-muted-foreground">{t('plugins.noUi')}</div>
        )}
      </div>
    </div>
  );
}
```

> `capabilities: []` in the init context is acceptable for A1b (the broker is the real enforcement; the context's capability list is advisory for the plugin's own UX). If a plugin wants to hide controls it lacks, a later refinement can populate this from the grant.

- [ ] **Step 5: Add the route.** In `apps/web/src/App.tsx`, import `PluginContainer` and add (inside the authenticated area, NOT under `/settings`; `<RequireRole>` with no props = any authenticated user):

```typescript
        <Route path="/x/:pluginId" element={<RequireRole><PluginContainer /></RequireRole>} />
```

- [ ] **Step 6: Run, expect PASS:** `pnpm -C apps/web test -- PluginContainer && pnpm -C apps/web typecheck`

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/plugins/icons.ts apps/web/src/plugins/PluginContainer.tsx apps/web/src/plugins/PluginContainer.test.tsx apps/web/src/App.tsx
git commit -m "feat(web): /x/:pluginId container — picks webview vs declarative tier (SP-A1b)"
```

---

## Task 9: Sidebar nav contribution

**Files:**
- Modify: `apps/web/src/shell/AppShell.tsx`
- Test: `apps/web/src/shell/AppShell.plugins.test.tsx` (create)

- [ ] **Step 1: Failing test.** Create `apps/web/src/shell/AppShell.plugins.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from './AppShell';
import * as api from '@/api';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listPluginUis: vi.fn(async () => [{ id: 'ui-demo', version: '1', nav: { label: 'Demo Plugin', icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1', hasWebview: true, hasDeclarative: false, declarative: null }]) };
});
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u', username: 'admin', roles: ['lab_admin'] }, hasRole: () => true, logout: vi.fn() }) }));

describe('AppShell plugin nav', () => {
  it('renders a sidebar entry for an installed UI plugin linking to /x/:id', async () => {
    render(<MemoryRouter><AppShell><div>content</div></AppShell></MemoryRouter>);
    const link = await waitFor(() => screen.getByRole('link', { name: /Demo Plugin/ }));
    expect(link.getAttribute('href')).toBe('/x/ui-demo');
  });
});
```

(Match how AppShell is actually rendered — if it takes `children` vs an `<Outlet />`, adjust. If AppShell wraps `<Outlet/>`, render it inside a `<Routes>` with an index route. Inspect `AppShell.tsx` first.)

- [ ] **Step 2: Run, expect FAIL:** `pnpm -C apps/web test -- AppShell.plugins`

- [ ] **Step 3: Implement.** In `apps/web/src/shell/AppShell.tsx`:

Add imports:
```typescript
import { useEffect, useState } from 'react';
import { listPluginUis, type PluginUiEntry } from '@/api';
import { pluginIcon } from '@/plugins/icons';
```

Inside the component, load plugin UIs:
```typescript
  const [pluginUis, setPluginUis] = useState<PluginUiEntry[]>([]);
  useEffect(() => { void listPluginUis().then(setPluginUis).catch(() => setPluginUis([])); }, []);
```

After the static `NAV.filter(...).map(...)` block in the nav area, render the plugin entries (mirror the existing `NavLink` styling exactly — copy the `className` from the static entries):
```typescript
        {pluginUis.map((p) => {
          const Icon = pluginIcon(p.nav.icon);
          return (
            <NavLink
              key={p.id}
              to={`/x/${p.id}`}
              className={({ isActive }) =>
                cn(
                  'flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium no-underline transition-colors',
                  isActive ? 'bg-accent text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{p.nav.label}</span>}
            </NavLink>
          );
        })}
```

(Use the actual `collapsed`/`cn` identifiers from AppShell. If the static entries use `t(labelKey)`, note plugin labels are raw strings from the manifest — render `p.nav.label` directly, NOT through `t()`.)

- [ ] **Step 4: Run, expect PASS:** `pnpm -C apps/web test -- AppShell && pnpm -C apps/web typecheck`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/shell/AppShell.tsx apps/web/src/shell/AppShell.plugins.test.tsx
git commit -m "feat(web): sidebar renders installed plugin-UI nav entries → /x/:id (SP-A1b)"
```

---

## Task 10: i18n keys (en/fr/pt)

**Files:**
- Modify: `apps/web/src/i18n/en.ts`, `fr.ts`, `pt.ts`
- Test: `apps/web/src/i18n/parity.test.ts` (existing — must stay green)

- [ ] **Step 1: Add keys.** In `apps/web/src/i18n/en.ts`, add a `plugins` section (place near other top-level sections):

```typescript
  plugins: {
    notFound: 'Plugin not found or not installed.',
    noUi: 'This plugin contributes no UI.',
    loadError: 'Failed to load plugin UI.',
  },
```

In `fr.ts`:
```typescript
  plugins: {
    notFound: "Extension introuvable ou non installée.",
    noUi: "Cette extension ne fournit aucune interface.",
    loadError: "Échec du chargement de l'interface de l'extension.",
  },
```

In `pt.ts`:
```typescript
  plugins: {
    notFound: 'Plugin não encontrado ou não instalado.',
    noUi: 'Este plugin não fornece interface.',
    loadError: 'Falha ao carregar a interface do plugin.',
  },
```

- [ ] **Step 2: Run the parity test, expect PASS:** `pnpm -C apps/web test -- parity`
Expected: PASS (all three locales carry identical key paths). If it fails, the keys differ across files — align them.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/i18n/en.ts apps/web/src/i18n/fr.ts apps/web/src/i18n/pt.ts
git commit -m "feat(web): i18n en/fr/pt plugin-ui strings (SP-A1b)"
```

---

## Task 11: Reference UI plugin (build + ui.html)

**Files:**
- Create: `scripts/build-ui-reference.mjs`
- Create: `reference-plugins/ui-reference/ui.html` (committed)
- Modify: `reference-plugins/.gitignore` (ensure `ui.html` is NOT ignored)
- Modify: root `package.json` (add `build:ui-reference` script)

The reference plugin reuses the prebuilt `wasm/test-sink` binary (so no new Rust build), declares a webview `ui` block, and ships a `ui.html` that proves the loop: awaits `openldr.ready`, round-trips `storage`, and calls `reports.list`.

- [ ] **Step 1: The panel.** Create `reference-plugins/ui-reference/ui.html` (body content only — the host wraps it; inline script uses `window.openldr`):

```html
<style>
  .ref { font-family: system-ui, sans-serif; padding: 16px; color: #111; }
  .ref h1 { font-size: 16px; margin: 0 0 8px; }
  .ref pre { background: #f4f4f5; padding: 8px; border-radius: 6px; font-size: 12px; overflow:auto; }
  .ref button { padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px; background: #fff; cursor: pointer; }
</style>
<div class="ref">
  <h1>OpenLDR Reference Plugin</h1>
  <p>Proves the host handshake, datastore, and a gated host service.</p>
  <button id="ping">Save + reload note</button>
  <p>Saved note: <span id="note" data-testid="note">…</span></p>
  <h2 style="font-size:14px">reports.list (host:reports)</h2>
  <pre id="reports" data-testid="reports">…</pre>
</div>
<script>
  (async function () {
    await window.openldr.ready;
    var noteEl = document.getElementById('note');
    var reportsEl = document.getElementById('reports');
    async function refresh() {
      var saved = await window.openldr.storage.get('notes', 'last');
      noteEl.textContent = saved && saved.text ? saved.text : '(none)';
    }
    document.getElementById('ping').addEventListener('click', async function () {
      await window.openldr.storage.put('notes', 'last', { text: 'hello ' + new Date().toISOString() });
      await refresh();
    });
    try {
      var reports = await window.openldr.reports.list();
      reportsEl.textContent = JSON.stringify(reports).slice(0, 500);
    } catch (e) {
      reportsEl.textContent = 'error: ' + (e && e.message ? e.message : String(e));
    }
    await refresh();
    document.body.setAttribute('data-openldr-ready', '1');
  })();
</script>
```

- [ ] **Step 2: The build script.** Create `scripts/build-ui-reference.mjs` (mirror `build-test-sink.mjs`/`build-wasm-plugins.mjs` conventions — read those first for the exact `root`/path helpers):

```javascript
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'reference-plugins', 'ui-reference');
mkdirSync(outDir, { recursive: true });

// Reuse the prebuilt test-sink wasm as the payload (run `pnpm build:test-sink` first).
const srcWasm = join(root, 'reference-plugins', 'test-sink', 'plugin.wasm');
if (!existsSync(srcWasm)) { console.error('Build test-sink first: pnpm build:test-sink'); process.exit(1); }
const stagedWasm = join(outDir, 'plugin.wasm');
copyFileSync(srcWasm, stagedWasm);
const wasmSha = createHash('sha256').update(readFileSync(stagedWasm)).digest('hex');

const uiHtml = readFileSync(join(outDir, 'ui.html'));
const uiSha = createHash('sha256').update(uiHtml).digest('hex');

const manifest = {
  id: 'ui-reference',
  version: '0.1.0',
  kind: 'sink',
  entrypoints: ['health_check', 'push_aggregate'],
  wasmSha256: wasmSha,
  description: 'Reference plugin proving the plugin-UI surface (panel + datastore + gated host service)',
  license: 'Apache-2.0',
  wasi: true,
  limits: { memoryMb: 256, timeoutMs: 30000 },
  capabilities: [{ kind: 'host:reports' }],
  ui: { entry: 'ui.html', sha256: uiSha, nav: { label: 'Reference Plugin', icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1' },
};
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('staged reference-plugins/ui-reference (wasm', wasmSha.slice(0, 12), 'ui', uiSha.slice(0, 12), ')');
```

- [ ] **Step 3: gitignore + script.** Ensure `reference-plugins/.gitignore` does NOT ignore `ui.html` (it ignores `plugin.wasm` + `manifest.json`). If it uses a blanket pattern, add `!ui-reference/ui.html`. Add to root `package.json` scripts:

```json
"build:ui-reference": "pnpm build:test-sink && node scripts/build-ui-reference.mjs",
```

- [ ] **Step 4: Build it + sanity check.** Run `pnpm build:ui-reference`. Confirm `reference-plugins/ui-reference/{plugin.wasm,manifest.json}` exist and `manifest.json` has `ui.entry: 'ui.html'` + a 64-hex `ui.sha256` matching `sha256(ui.html)`. (No unit test — this is a build artifact; it's exercised by the Task 12 e2e.)

- [ ] **Step 5: Commit**

```bash
git add scripts/build-ui-reference.mjs reference-plugins/ui-reference/ui.html reference-plugins/.gitignore package.json
git commit -m "feat: reference UI plugin (panel + datastore + reports.list over test-sink wasm) (SP-A1b)"
```

---

## Task 12: Playwright e2e — the full loop in a real browser

**Files:**
- Create: an e2e spec under the existing structure (inspect `e2e/` + `e2e/playwright.config.ts` first — match how existing specs install fixtures + navigate). Name it `e2e/tests/plugin-ui.spec.ts` or mirror the existing `*.mjs` smoke pattern.

This is the only place the real iframe executes (jsdom can't). It must: ensure the reference plugin is installed, log in via `AUTH_DEV_BYPASS`, navigate to `/x/ui-reference`, and assert the iframe's panel rendered + the gated `reports.list` call returned + storage round-trips.

- [ ] **Step 1: Pre-req — build + install the reference plugin.** Document + script the setup the e2e relies on (mirror `e2e:seed`): `pnpm build:ui-reference && pnpm openldr plugin install reference-plugins/ui-reference` (the CLI install path — verify it accepts a directory containing manifest.json + plugin.wasm + ui.html; if the CLI only reads wasm+manifest, confirm the install flows ui.html through — it must, since marketplace/CLI install was wired in SP-A1a to pass `bundle.ui`. If the CLI `plugin install` path does NOT build a Bundle with `ui` (it reads a raw wasm+manifest, not a bundle dir), then install via the marketplace/bundle path instead, OR extend the CLI `plugin install` to read an adjacent `ui.html` when the manifest declares `ui.entry`. Resolve this concretely while implementing — the reference plugin MUST install with its ui.html persisted, else loadUi 404s.).

> IMPORTANT decision point for the implementer: verify which install path persists `ui.html`. SP-A1a wired `ui: bundle.ui` into `ctx.plugins.install` at the marketplace-routes, `cli/market.ts`, and `cli/artifact.ts` call sites — but `cli/plugin.ts` calls `ctx.plugins.install(wasm, manifest)` with NO ui bytes. So `pnpm openldr plugin install <dir>` will NOT persist ui.html as written. Fix `packages/cli/src/plugin.ts` to read an adjacent `ui.html` (when `manifest.ui.entry` is set) and pass it as `{ ui }` to `install`. Add a unit test for that CLI behavior. Commit this as part of this task (it is the real install path for dev/e2e).

- [ ] **Step 2: Write the e2e.** Following the existing e2e patterns (Playwright, `AUTH_DEV_BYPASS`, `BASE_URL`), assert:

```typescript
import { test, expect } from '@playwright/test';

test('reference plugin UI loads, calls a gated host service, and round-trips storage', async ({ page }) => {
  await page.goto('/x/ui-reference');
  const frame = page.frameLocator('iframe[title="plugin-ui-reference"]');
  // The panel signals readiness once the handshake completed + reports.list resolved.
  await expect(frame.locator('[data-testid="reports"]')).not.toHaveText('…', { timeout: 15_000 });
  await expect(frame.locator('[data-testid="reports"]')).not.toContainText('error:');
  // Storage round-trip: click save, the note updates from '(none)' to a 'hello …' string.
  await frame.locator('#ping').click();
  await expect(frame.locator('[data-testid="note"]')).toContainText('hello');
});
```

(Adjust the iframe title selector to match `PluginFrame`'s `title={`plugin-${pluginId}`}` → `plugin-ui-reference`. Adjust login/navigation to the existing e2e helpers.)

- [ ] **Step 3: Run the e2e.** Build + install the plugin, then `pnpm e2e` (or the targeted spec). Expected: green — the iframe renders, `reports.list` returns (proving the broker capability path end-to-end through a real MessagePort), and storage round-trips.

> If the live run reveals the `onLoad` handshake doesn't fire reliably for srcdoc in the target browser, fall back to posting `init` from a `useEffect` after a microtask in `PluginFrame` (in addition to `onLoad`), guarded so it posts at most once. Resolve empirically.

- [ ] **Step 4: Commit**

```bash
git add e2e packages/cli/src/plugin.ts packages/cli/src/plugin.test.ts
git commit -m "test(e2e): reference plugin UI end-to-end (handshake + gated host service + storage); cli install persists ui.html (SP-A1b)"
```

---

## Task 13: Full gate + depcruise

**Files:** none (verification only)

- [ ] **Step 1: Full gate with `--force --continue`** (turbo cache masks cross-package typecheck; `--continue` runs all tasks):

```bash
pnpm turbo run typecheck lint test build --force --continue
```
Expected: green. The new `@openldr/plugin-ui-sdk` package gets typecheck/lint/test/build tasks auto-discovered. **Gotchas:** `@openldr/web#test`, `plugins#test`, `marketplace#test`, `users#test`, `audit#test` flake under parallel load — re-run any red one in isolation (`pnpm -C apps/web test`, etc.) and trust the isolated result. Never pipe turbo through `tail` (masks exit code — capture `$?`).

- [ ] **Step 2: depcruise** (a NEW package + a new apps/web → `@openldr/plugin-ui-sdk` edge):

```bash
pnpm depcruise
```
Expected: clean. `@openldr/plugin-ui-sdk` is a leaf domain package (no deps on adapters); `apps/web` and `apps/server`(via routes? no — only web + the broker types in api.ts) depend on it. If depcruise flags the new package, confirm it has no disallowed imports (it imports nothing but its own types) and that the web→sdk edge is permitted (web already depends on `@openldr/forms`, same layer).

- [ ] **Step 3: Commit any residue** (lockfile, etc.):

```bash
git add -A && git commit -m "chore: SP-A1b gate green (typecheck/lint/test/build + depcruise)" || echo "nothing to commit"
```

---

## Self-Review (run before handoff)

**Spec coverage (SP-A web portion):**
- `@openldr/plugin-ui-sdk` (types + dev mock + injected SDK) → Tasks 2, 3. ✓
- Sandboxed iframe (allow-scripts, no same-origin), host-built srcdoc + injected bootstrap first, strict CSP, no token/ambient net → Task 6. ✓
- Host-minted private MessagePort, single `init` transfer, promise RPC, `ready` → Tasks 3 (plugin side), 5 + 6 (host side). ✓
- Broker forwarding (capability/role/policy enforced server-side from A1a) → Task 4 + 5. ✓
- Nav contribution (`/x/:pluginId`, icon+label) → Tasks 8, 9. ✓
- Declarative-schema tier → Tasks 1 (schema), 7 (renderer), 8 (container picks it). ✓
- Reference UI plugin proving handshake/isolation/broker/datastore/nav end-to-end → Tasks 11, 12. ✓
- i18n en/fr/pt → Task 10. ✓
- Testing strategy (jsdom unit for renderer/bridge/handshake-logic; Playwright for real iframe) → Tasks 3,5,6,7,8,9 (jsdom) + 12 (Playwright). ✓

**Carried from A1a deferral / consistency:** the `BrokerOp`/`PluginRpcResult` types in the SDK (Task 2) mirror the server broker's `BrokerOp`/`BrokerResult` exactly — keep them in sync (same `kind` discriminants). The CLI `plugin install` ui.html gap is explicitly fixed in Task 12 Step 1.

**Placeholder scan:** none — every step carries code + commands. Two empirical decision points are explicitly flagged (CLI install ui path in Task 12; srcdoc `onLoad` timing fallback in Task 12) with concrete resolutions, not vague TODOs.

**Type consistency:** `PluginUiEntry` (Task 4) is consumed by Tasks 8, 9. `PluginInitContext` (Task 2) is built in Task 8, consumed in Task 6, read by the bootstrap (Task 3). `HostPortLike`/`wireHostPort` (Task 5) used by Task 6. `pluginBrokerCall`/`listPluginUis`/`pluginUiAssetUrl` (Task 4) used by 5/6/7/8/9. ✓

---

## Execution Handoff

Plan complete and saved. Recommended: **Subagent-Driven** (fresh subagent per task, two-stage spec+quality review between tasks, merge to local `main`, full gate green per task) — same discipline as SP-A1a.
