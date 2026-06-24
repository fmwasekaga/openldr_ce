# SP-A2 — DHIS2 as a Removable Webview Plugin (full parity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This is a LARGE plan in 5 phases — expect it to span multiple sessions; the phases are ordered so the host DHIS2 keeps working until the Phase 4 cutover.

**Goal:** Make DHIS2 a removable plugin: rebuild its 6 screens as a sandboxed webview bundled into the existing `dhis2-sink` plugin, move its host DB tables into the per-plugin `plugin_data` datastore, run scheduling by invoking the wasm headless via a host runner, and **delete the host-side DHIS2 page/routes/context** so DHIS2 can be uninstalled — verified end-to-end against the Docker DHIS2 SL demo.

**Architecture:** The `dhis2-sink` plugin (already shipping the Rust→wasm sink with `health_check`/`pull_metadata`/`push_aggregate`/`push_tracker`) gains a **webview `ui` block** — a Preact SPA bundled by esbuild into a single self-contained `ui.html` (inline JS+CSS, no host imports) that talks ONLY through `window.openldr`. SP-A1 gave it storage/invoke/reports.list/connectors.list+test; SP-A2 **extends the broker** with the remaining host-services the screens need: `reports.columns`, `reports.eventSources`, `fhir.facilities` (Location list), `connectors.metadata` (full DHIS2 metadata), and `connectors.push` (the report→rows→wasm-push→connector-egress orchestration that today lives in `dhis2-context.runMapping`, moved into a generic host op), plus `schedule.register/list/remove` (`host:schedule`) with a host runner that fires the push headlessly. DHIS2-domain data (mappings, org-unit maps, schedules, metadata cache, push history) moves into `plugin_data(plugin_id='dhis2-sink', collection, key, doc)` via a one-time idempotent migration. Then the host `dhis2-routes`/`dhis2-context`/stores/screens/CLI are deleted; the `dhis2-push` workflow node repoints to the same host orchestration reading mappings from `plugin_data`.

**Tech Stack:** TypeScript, Preact + esbuild (the plugin SPA, bundled+inlined), zod, Kysely (Postgres + pg-mem), Fastify broker routes (unchanged — op-dispatched), Extism (existing `dhis2-sink` wasm), Vitest + jsdom, Playwright (live e2e against Docker DHIS2 :8085 admin/district).

**Builds on:** SP-A1a (broker + `plugin_data` + `createPluginTarget` + connectors) and SP-A1b (`@openldr/plugin-ui-sdk` + `PluginFrame` + `/x/:pluginId` + the broker op surface). All merged to local `main` (`16a43a1`).

---

## Locked architecture decisions

1. **One plugin, not two.** The UI ships inside the existing `dhis2-sink` plugin (it already has the wasm + entrypoints + is installed + published). Its manifest gains the `ui` block (entry `ui.html`, nav `{label:'DHIS2', icon:'share-2', section:'apps'}`) + the new capabilities (`host:reports`, `host:connectors`, `host:schedule`, `host:fhir`). Migration target `plugin_id = 'dhis2-sink'`.
2. **Plugin UI = Preact SPA bundled to one inlined `ui.html`.** Source under `wasm/dhis2-sink/ui/src/` (TSX, Preact + a tiny in-bundle SDK client typed against `@openldr/plugin-ui-sdk`); `scripts/build-dhis2-sink.mjs` (extended) runs esbuild (bundle+minify, JSX=preact, format=iife) and inlines the JS+CSS into a `ui.html` template (body content only — `PluginFrame` wraps it; CSP allows `script-src 'unsafe-inline'`). The plugin's own minimal CSS replaces shadcn. No host React/components reach the iframe.
3. **Broker is the seam; the host keeps the orchestration.** `runMapping` (report→rows→`createPluginTarget`→push) does NOT move into the wasm — it stays host-side, re-exposed as the generic broker op `connectors.push`. The wasm still does only protocol/egress (`push_aggregate`/`push_tracker`/`pull_metadata`). The plugin UI calls `connectors.push`/`connectors.metadata`; the host resolves the connector + runs the report. DHIS2-domain mapping shapes are opaque to the host (passed through to the wasm).
4. **Data migration = internal migration 036**, idempotent (`ON CONFLICT DO NOTHING`), copying the 4 host tables → `plugin_data`. Old tables are LEFT in place (rollback safety); host code stops reading them. A later cleanup migration to drop them is out of scope.
5. **Validation + period logic** (`validateMapping`/`validateTrackerMapping`, `periodFor`/`currentPeriod`/`nextPeriodBoundary`) stay in `@openldr/dhis2` (host-only helpers) and are used by the broker's `connectors.push`/validate op + the schedule runner. The plugin UI calls a `connectors.validate`-style broker op (host runs `validateMapping` against the stored metadata) rather than re-implementing validation in the sandbox.
6. **Cutover is atomic in Phase 4**: install the UI-bearing `dhis2-sink`, run migration 036, delete the host DHIS2 surface, repoint the workflow node — all in one phase so there's no window where DHIS2 is half-broken.

---

## Phase 1 — Broker + SDK host-service extensions (additive, safe; host DHIS2 keeps working)

These add the host-services the DHIS2 webview needs. They are purely additive — no host DHIS2 code is removed yet. After Phase 1 the surface exists but is unused by the still-host DHIS2 screens.

### Task 1: Extend capabilities + SDK op types + server BrokerOp with the new ops

**Files:**
- Modify: `packages/marketplace/src/capabilities.ts` (add `host:fhir`)
- Modify: `packages/plugin-ui-sdk/src/types.ts` (add the new `PluginBrokerOp` members + `OpenLdrPluginApi` methods)
- Modify: `packages/bootstrap/src/plugin-broker.ts` (add the new `BrokerOp` members + `gateFor`/`rolesFor` entries — dispatch impl in Task 2)
- Test: `packages/marketplace/src/capabilities.test.ts`, `packages/plugin-ui-sdk/src/types.test.ts` (create), `packages/bootstrap/src/plugin-broker.test.ts`

- [ ] **Step 1: Failing test — capability.** Append to `packages/marketplace/src/capabilities.test.ts`:

```typescript
it('parses host:fhir presence gate', () => {
  const caps = parseCapabilities([{ kind: 'host:fhir' }]);
  expect(caps[0].kind).toBe('host:fhir');
});
```

- [ ] **Step 2: Run, expect FAIL:** `pnpm -C packages/marketplace test -- capabilities`

- [ ] **Step 3: Add `host:fhir`** to the `capabilitySchema` discriminated union in `packages/marketplace/src/capabilities.ts` (after `host:schedule`):

```typescript
  z.object({ kind: z.literal('host:fhir') }),
```

- [ ] **Step 4: Run, expect PASS:** `pnpm -C packages/marketplace test -- capabilities`

- [ ] **Step 5: Extend the SDK op union + api.** In `packages/plugin-ui-sdk/src/types.ts`, add to `PluginBrokerOp`:

```typescript
  | { kind: 'reports.eventSources' }
  | { kind: 'fhir.facilities' }
  | { kind: 'connectors.metadata'; id: string }
  | { kind: 'connectors.push'; connectorId: string; mapping: unknown; orgUnitMap?: Record<string, string>; period: string; dryRun: boolean }
  | { kind: 'connectors.validate'; connectorId: string; mapping: unknown }
  | { kind: 'schedule.register'; schedule: unknown }
  | { kind: 'schedule.list' }
  | { kind: 'schedule.remove'; id: string }
```

And to `OpenLdrPluginApi`, extend `reports`, `connectors`, and add `fhir` + `schedule`:

```typescript
  reports: {
    list(): Promise<unknown>;
    columns(id: string): Promise<unknown>;
    run(id: string, params?: Record<string, unknown>): Promise<unknown>;
    eventSources(): Promise<unknown>;
  };
  connectors: {
    list(): Promise<unknown>;
    test(id: string): Promise<unknown>;
    metadata(id: string): Promise<unknown>;
    push(input: { connectorId: string; mapping: unknown; orgUnitMap?: Record<string, string>; period: string; dryRun: boolean }): Promise<unknown>;
    validate(input: { connectorId: string; mapping: unknown }): Promise<unknown>;
  };
  fhir: { facilities(): Promise<unknown> };
  schedule: {
    register(schedule: unknown): Promise<unknown>;
    list(): Promise<unknown>;
    remove(id: string): Promise<unknown>;
  };
```

- [ ] **Step 6: Mirror into the bootstrap SDK runtime.** In `packages/plugin-ui-sdk/src/bootstrap.ts` `pluginBootstrapV1`, extend the `window.openldr` literal with the new methods (each `() => call({kind:...})`), matching the api shape above:

```typescript
      reports: {
        list: () => call({ kind: 'reports.list' }),
        columns: (id: string) => call({ kind: 'reports.columns', id }),
        run: (id: string, params?: Record<string, unknown>) => call({ kind: 'reports.run', id, params }),
        eventSources: () => call({ kind: 'reports.eventSources' }),
      },
      connectors: {
        list: () => call({ kind: 'connectors.list' }),
        test: (id: string) => call({ kind: 'connectors.test', id }),
        metadata: (id: string) => call({ kind: 'connectors.metadata', id }),
        push: (input: unknown) => call({ kind: 'connectors.push', ...(input as object) }),
        validate: (input: unknown) => call({ kind: 'connectors.validate', ...(input as object) }),
      },
      fhir: { facilities: () => call({ kind: 'fhir.facilities' }) },
      schedule: {
        register: (schedule: unknown) => call({ kind: 'schedule.register', schedule }),
        list: () => call({ kind: 'schedule.list' }),
        remove: (id: string) => call({ kind: 'schedule.remove', id }),
      },
```

(Keep `storage`/`invoke` unchanged. Add the mock equivalents in `packages/plugin-ui-sdk/src/mock.ts` returning empty/ok stubs for the new methods so `createMockOpenldr` still satisfies `OpenLdrPluginApi`.)

- [ ] **Step 7: Extend the server BrokerOp + gates (dispatch in Task 2).** In `packages/bootstrap/src/plugin-broker.ts`, add the new members to `BrokerOp` (identical shapes to the SDK), and extend `gateFor`:

```typescript
    case 'reports.list': case 'reports.columns': case 'reports.run': case 'reports.eventSources': return 'host:reports';
    case 'connectors.list': case 'connectors.test': case 'connectors.metadata': case 'connectors.push': case 'connectors.validate': return 'host:connectors';
    case 'fhir.facilities': return 'host:fhir';
    case 'schedule.register': case 'schedule.list': case 'schedule.remove': return 'host:schedule';
```

and `rolesFor` (the write/egress ops require lab_admin like the native routes; reads can stay any-authed):

```typescript
function rolesFor(op: BrokerOp): string[] {
  switch (op.kind) {
    case 'connectors.list': case 'connectors.test': case 'connectors.metadata':
    case 'connectors.push': case 'connectors.validate':
    case 'schedule.register': case 'schedule.list': case 'schedule.remove':
      return ['lab_admin'];
    default: return [];
  }
}
```

Add failing broker tests asserting `host:fhir`/`host:schedule` gating + lab_admin role-gating for the new ops (mirror the existing capability/role tests), then make them pass with the gate additions. (Dispatch impls land in Task 2; for Task 1, the dispatch `default` returns `{ok:false,'unknown operation'}` for the new ops — assert the GATE denials only here, not the happy paths.)

- [ ] **Step 8: Run + typecheck:** `pnpm -C packages/marketplace test && pnpm -C packages/plugin-ui-sdk test && pnpm -C packages/bootstrap test -- plugin-broker && pnpm -C packages/plugin-ui-sdk typecheck && pnpm -C packages/bootstrap typecheck`

- [ ] **Step 9: Commit**

```bash
git add packages/marketplace/src/capabilities.ts packages/marketplace/src/capabilities.test.ts packages/plugin-ui-sdk/src packages/bootstrap/src/plugin-broker.ts packages/bootstrap/src/plugin-broker.test.ts
git commit -m "feat(broker): host:fhir cap + reports.eventSources/connectors.metadata|push|validate/fhir.facilities/schedule.* op types + gates (SP-A2)"
```

### Task 2: Broker dispatch + AppContext wiring for the new ops

**Files:**
- Modify: `packages/bootstrap/src/plugin-broker.ts` (dispatch + deps)
- Modify: `packages/bootstrap/src/index.ts` (wire the new broker deps from `ctx`)
- Modify: `packages/bootstrap/src/connector-target.ts` OR a new `packages/bootstrap/src/dhis2-orchestration.ts` (the `runMapping`-equivalent `pushViaConnector`)
- Test: `packages/bootstrap/src/plugin-broker.test.ts`

- [ ] **Step 1: Extend `PluginBrokerDeps`** in `plugin-broker.ts`:

```typescript
  reporting: { list(): unknown; columns(id: string): Promise<unknown>; run(id: string, params: unknown): Promise<unknown>; eventSources(): unknown };
  connectors: { list(): Promise<unknown[]>; get(id: string): Promise<unknown | null> };
  testConnector?: (id: string) => Promise<unknown>;
  /** Full DHIS2 metadata for a connector (resolve→createPluginTarget→pullMetadata). */
  connectorMetadata?: (id: string) => Promise<unknown>;
  /** report→rows→wasm push→connector egress (the moved runMapping). */
  connectorPush?: (input: { connectorId: string; mapping: unknown; orgUnitMap?: Record<string, string>; period: string; dryRun: boolean }) => Promise<unknown>;
  /** host-side mapping validation against cached metadata. */
  connectorValidate?: (input: { connectorId: string; mapping: unknown }) => Promise<unknown>;
  /** Location list for org-unit mapping. */
  facilities?: () => Promise<unknown>;
  /** plugin schedule register/list/remove, scoped by pluginId. */
  schedules?: { register(pluginId: string, schedule: unknown): Promise<unknown>; list(pluginId: string): Promise<unknown>; remove(pluginId: string, id: string): Promise<unknown> };
```

- [ ] **Step 2: Add dispatch cases** in `handle`'s switch (after the existing `connectors.test`):

```typescript
          case 'reports.eventSources': return { ok: true, data: deps.reporting.eventSources() };
          case 'connectors.metadata': {
            if (!deps.connectorMetadata) return { ok: false, error: 'connectors.metadata unavailable' };
            return { ok: true, data: await deps.connectorMetadata(op.id) };
          }
          case 'connectors.push': {
            if (!deps.connectorPush) return { ok: false, error: 'connectors.push unavailable' };
            return { ok: true, data: await deps.connectorPush({ connectorId: op.connectorId, mapping: op.mapping, orgUnitMap: op.orgUnitMap, period: op.period, dryRun: op.dryRun }) };
          }
          case 'connectors.validate': {
            if (!deps.connectorValidate) return { ok: false, error: 'connectors.validate unavailable' };
            return { ok: true, data: await deps.connectorValidate({ connectorId: op.connectorId, mapping: op.mapping }) };
          }
          case 'fhir.facilities': {
            if (!deps.facilities) return { ok: false, error: 'fhir.facilities unavailable' };
            return { ok: true, data: await deps.facilities() };
          }
          case 'schedule.register': {
            if (!deps.schedules) return { ok: false, error: 'schedule unavailable' };
            return { ok: true, data: await deps.schedules.register(pluginId, op.schedule) };
          }
          case 'schedule.list': {
            if (!deps.schedules) return { ok: false, error: 'schedule unavailable' };
            return { ok: true, data: await deps.schedules.list(pluginId) };
          }
          case 'schedule.remove': {
            if (!deps.schedules) return { ok: false, error: 'schedule unavailable' };
            return { ok: true, data: await deps.schedules.remove(pluginId, op.id) };
          }
```

Also change `reports.columns` to use the now-real dep: `case 'reports.columns': return { ok: true, data: await deps.reporting.columns(op.id) };` (remove the old `if (!deps.reporting.columns)` guard).

- [ ] **Step 3: Failing tests** in `plugin-broker.test.ts` for each new op (gated + happy path with fakes): `connectors.metadata` delegates to `connectorMetadata`; `connectors.push` delegates with the full input; `fhir.facilities` returns the facilities; `schedule.*` pass `pluginId` (the trusted arg) to `deps.schedules`. Assert `connectors.push` is denied for a non-lab_admin principal. Run → FAIL → implement Step 2 → PASS.

- [ ] **Step 4: Implement `pushViaConnector` + helpers.** Create `packages/bootstrap/src/dhis2-orchestration.ts` exporting `createDhis2Orchestration(deps)` that provides `connectorMetadata`/`connectorPush`/`connectorValidate` by reusing `createPluginTarget` (from `./connector-target`) + the connector store + `loadSink` + the report runner + `@openldr/dhis2` validate/period helpers. This is the `runMapping` logic from `dhis2-context.ts` (study `packages/bootstrap/src/dhis2-context.ts` `runMapping`/`resolveTarget`/`validate`), generalized to read the mapping from the CALLER (the plugin passes it) rather than a mapping store, and to run the report named in `mapping.source`. Full code mirrors `dhis2-context.runMapping` (resolve connector → getDecryptedConfig → loadSink → createPluginTarget → run report/eventSource for rows → pushAggregate/pushEvents → return `{payload,skipped,result}`); reuse `dispatchReportSource` semantics. (The implementer reads `dhis2-context.ts` as the source of truth and ports the body, swapping `loadMapping(id)`→the passed `mapping` and keeping the connector resolution + push.)

- [ ] **Step 5: Wire into `createAppContext`** (`index.ts`): build the orchestration + facilities + plugin-schedule deps and pass them into `createPluginBroker`:

```typescript
  const dhis2Orch = createDhis2Orchestration({ connectors: connectorStore, loadSink: plugins.loadSink, reporting, key: cfg.SECRETS_ENCRYPTION_KEY, createTarget: createPluginTarget });
  const pluginBroker = createPluginBroker({
    plugins, pluginData,
    reporting: { list: () => reporting.list(), columns: (id) => reporting.run(id, {}).then((r) => (r as { columns: unknown }).columns), run: (id, params) => reporting.run(id, params), eventSources: () => reporting.eventSources() },
    connectors: connectorStore,
    testConnector, // existing
    connectorMetadata: (id) => dhis2Orch.metadata(id),
    connectorPush: (input) => dhis2Orch.push(input),
    connectorValidate: (input) => dhis2Orch.validate(input),
    facilities: async () => (await fhirStore.listByType('Location')).map((l) => ({ id: l.id, name: (l as { name?: string }).name ?? l.id })),
    schedules: createPluginScheduleApi(pluginData), // Task 4
    logger,
    policy: () => policyFromConfig(cfg),
  });
```

(`reports.columns` returns the report's columns by running it with empty params — matches the host's `/api/dhis2/report-columns`. `createPluginScheduleApi` lands in Task 4; for Task 2 either stub `schedules: undefined` and add it in Task 4, or sequence Task 4 before this wiring. To keep TDD clean, wire `schedules` in Task 4's step.)

- [ ] **Step 6: Run full bootstrap tests + typecheck + server typecheck:** `pnpm -C packages/bootstrap test && pnpm -C packages/bootstrap typecheck && pnpm -C apps/server typecheck`

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/plugin-broker.ts packages/bootstrap/src/plugin-broker.test.ts packages/bootstrap/src/dhis2-orchestration.ts packages/bootstrap/src/index.ts
git commit -m "feat(broker): dispatch reports.eventSources/connectors.metadata|push|validate/fhir.facilities + wire orchestration (SP-A2)"
```

---

## Phase 2 — Data migration + plugin-schedule store/runner

### Task 3: Migration 036 — host DHIS2 tables → `plugin_data`

**Files:**
- Create: `packages/db/src/migrations/internal/036_dhis2_to_plugin_data.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `migrations.test.ts`
- Test: `packages/db/src/migrations/036_dhis2_to_plugin_data.test.ts` (create — pg-mem: seed old tables, migrate, assert plugin_data rows)

- [ ] **Step 1: Write the migration** `036_dhis2_to_plugin_data.ts`. `up` copies each old table into `plugin_data(plugin_id='dhis2-sink', collection, key, doc)` with `INSERT ... ON CONFLICT (plugin_id,collection,key) DO NOTHING` (idempotent). Map: `dhis2_orgunit_map` → collection `orgUnitMaps`, key=`facility_id`, doc=`{facilityId,orgUnitId,orgUnitName}`; `dhis2_mappings` → `mappings`, key=`id`, doc=`{id,name,definition}`; `dhis2_schedules` → `schedules`, key=`id`, doc=the row; `dhis2_metadata_cache` → `metadataCache`, key=`latest`, doc=`{metadata,pulledAt}`. Guard each copy with a table-exists check (the old tables may not exist on a fresh install) — use `to_regclass`/try-catch per source table so the migration is safe on fresh DBs. `down` deletes the `plugin_data` rows for `plugin_id='dhis2-sink'` in those collections. Old tables are NOT dropped.

- [ ] **Step 2: Register** in `migrations/internal/index.ts` (import `m036` + `'036_dhis2_to_plugin_data': {...}`) and add the key to `migrations.test.ts`'s ordered list.

- [ ] **Step 3: Test** (pg-mem via `@openldr/db/testing`): in a migrated DB, manually insert old `dhis2_mappings`/`dhis2_orgunit_map`/`dhis2_schedules`/`dhis2_metadata_cache` rows, re-run the 036 up() (or assert the migrator applied it), and assert the corresponding `plugin_data` rows exist with the right collection/key/doc. Assert idempotency (running up twice doesn't duplicate). Assert it no-ops cleanly when the old tables are empty.

- [ ] **Step 4: Run + typecheck:** `pnpm -C packages/db test -- 036_dhis2 && pnpm -C packages/db test -- migrations && pnpm -C packages/db typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/internal/036_dhis2_to_plugin_data.ts packages/db/src/migrations/internal/index.ts packages/db/src/migrations/migrations.test.ts packages/db/src/migrations/036_dhis2_to_plugin_data.test.ts
git commit -m "feat(db): migration 036 — copy host DHIS2 tables into plugin_data (idempotent) (SP-A2)"
```

### Task 4: Plugin-schedule store API + host runner

**Files:**
- Create: `packages/bootstrap/src/plugin-schedule.ts` (`createPluginScheduleApi(pluginData)` + `createPluginScheduleRunner(deps)`)
- Create: `packages/bootstrap/src/plugin-schedule.test.ts`
- Modify: `packages/bootstrap/src/index.ts` (wire the runner; pass `schedules` into the broker)
- Modify: `apps/server/src/index.ts` (register the runner + reconcile on boot)

- [ ] **Step 1: `createPluginScheduleApi(pluginData)`** — `register(pluginId, schedule)` stores a schedule doc in `plugin_data(pluginId,'schedules',schedule.id)` (mint an id if absent) + returns it; `list(pluginId)` → `pluginData.list(pluginId,'schedules')` mapped to docs; `remove(pluginId,id)` → `pluginData.delete`. TDD with the in-memory pluginData fake.

- [ ] **Step 2: `createPluginScheduleRunner(deps)`** — mirrors `report-scheduler.ts`: `registerRunner(eventing)` subscribes to `plugin.schedule.due`, loads the schedule from `plugin_data`, and on fire calls `deps.runScheduled(pluginId, schedule)` (which loads the mapping from `plugin_data`, runs the orchestration push for `currentPeriod(periodType)`, dryRun=false), then re-arms via `eventing.publish({type:'plugin.schedule.due', payload:{pluginId,scheduleId}}, {availableAt: nextDue})`. `reconcile(eventing)` re-arms all enabled schedules across all plugins that declare schedules (iterate `plugin_data` schedules for `plugin_id='dhis2-sink'` — generic over pluginId but v1 only dhis2-sink). Use `@openldr/dhis2` period helpers for `nextDue`. TDD the fire→re-arm + reconcile with fakes (mirror `report-scheduler.test.ts`/`dhis2-sync.test.ts` patterns).

- [ ] **Step 3: Wire** in `index.ts` (build the runner with `pluginData` + the orchestration + `reporting`) and pass `createPluginScheduleApi(pluginData)` as the broker `schedules` dep (completing Task 2 Step 5). In `apps/server/src/index.ts`, after `buildApp`, register + reconcile the runner against `ingest.eventing` (replacing the deleted `dhis2.registerSync`/`reconcileSchedules` — but the DHIS2 host deletion is Phase 4; for Phase 2 ADD the plugin runner alongside, gated so it doesn't double-fire with the still-present host scheduler — guard: only arm plugin schedules that exist in `plugin_data`, which is empty until migration 036 runs at cutover, so no double-fire in practice; document this).

- [ ] **Step 4: Run + typecheck:** `pnpm -C packages/bootstrap test -- plugin-schedule && pnpm -C packages/bootstrap typecheck && pnpm -C apps/server typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/plugin-schedule.ts packages/bootstrap/src/plugin-schedule.test.ts packages/bootstrap/src/index.ts apps/server/src/index.ts
git commit -m "feat(bootstrap): plugin-schedule store + host runner (host:schedule fires the wasm push headless) (SP-A2)"
```

---

## Phase 3 — The DHIS2 webview plugin SPA (Preact, bundled+inlined)

### Task 5: Plugin UI build pipeline (Preact SPA → inlined ui.html)

**Files:**
- Create: `wasm/dhis2-sink/ui/package.json` (preact + esbuild devDeps, isolated from the workspace OR a workspace pkg), `wasm/dhis2-sink/ui/tsconfig.json`, `wasm/dhis2-sink/ui/src/main.tsx` (a hello-panel that awaits `openldr.ready` and shows the connector status — proves the bundle works), `wasm/dhis2-sink/ui/src/sdk.ts` (typed `window.openldr` accessor importing types from `@openldr/plugin-ui-sdk`)
- Modify: `scripts/build-dhis2-sink.mjs` (add an esbuild step that bundles `ui/src/main.tsx` → a single JS string, inlines it + the CSS into a `ui.html`, computes its sha, and adds the `ui` block + new capabilities to the staged manifest)
- Modify: root `package.json` if a separate install step is needed

- [ ] **Step 1: Scaffold the SPA + a trivial first screen.** `main.tsx` renders a Preact app that `await openldr.ready` then shows `Loading…`/the plugin id. `sdk.ts` exports `const openldr = (window as any).openldr as OpenLdrPluginApi`. Keep it minimal — real screens come in Tasks 6–11.

- [ ] **Step 2: esbuild step in the build script.** Extend `scripts/build-dhis2-sink.mjs`: run `esbuild ui/src/main.tsx --bundle --minify --format=iife --jsx=automatic --jsx-import-source=preact` to a JS string (in-memory `esbuild.build({write:false})`), read `ui/src/styles.css`, and write `wasm/dhis2-sink/ui.html` = `<style>${css}</style><div id="app"></div><script>${js}</script>`. Compute `uiSha = sha256(ui.html)`. Add to the staged manifest: `ui: { entry: 'ui.html', sha256: uiSha, nav: { label: 'DHIS2', icon: 'share-2', section: 'apps' }, uiSdkVersion: '1' }` and extend `capabilities` with `host:reports`, `host:connectors`, `host:schedule`, `host:fhir` (keep existing `net-egress`). The staged bundle dir now has `plugin.wasm` + `manifest.json` + `ui.html`.

- [ ] **Step 3: Build + sanity.** `pnpm build:dhis2-sink`; confirm `ui.html` exists, manifest has the ui block + sha matches, capabilities include the 4 host:* + net-egress. Confirm the bundled JS contains no `require`/external imports (self-contained). (No unit test — exercised by the live e2e in Phase 5. The bundle’s logic is tested per-screen via the SPA’s own vitest in Tasks 6–11 where feasible against `createMockOpenldr`.)

- [ ] **Step 4: Commit**

```bash
git add wasm/dhis2-sink/ui scripts/build-dhis2-sink.mjs package.json
git commit -m "feat(dhis2-sink): Preact UI build pipeline — bundle+inline ui.html + ui manifest block (SP-A2)"
```

### Tasks 6–11: The 6 screens (rebuilt against the SDK)

Each screen is a Preact component under `wasm/dhis2-sink/ui/src/screens/`, wired into `main.tsx`'s router (a tiny hash-router or a screen-state enum — the iframe has no React Router). Each task: build the screen + a vitest test rendering it against `createMockOpenldr` (preact + @testing-library/preact, jsdom) asserting the SDK calls + rendering. **Each task's behavior is defined by the existing host screen** (the source of truth) **with the exact api→SDK substitution below** — read the host screen, reproduce its UX with the plugin's own minimal components (no shadcn), swapping data access:

| Host api call | Plugin SDK call |
|---|---|
| `getDhis2Status()` | derive from `connectors.list()` (active connector) + `storage.get('metadataCache','latest')` + `storage.list('pushes')` |
| `pullDhis2Metadata()` | `connectors.metadata(connectorId)` → `storage.put('metadataCache','latest',{metadata,pulledAt})` |
| `getOrgUnitMappings()` | `fhir.facilities()` + `storage.list('orgUnitMaps')` + `storage.get('metadataCache','latest')` (orgUnits) |
| `setOrgUnitMapping(f,{...})` | `storage.put('orgUnitMaps', facilityId, {facilityId,orgUnitId,orgUnitName})` |
| `clearOrgUnitMapping(f)` | `storage.delete('orgUnitMaps', facilityId)` |
| `listDhis2Mappings()` | `storage.list('mappings')` |
| `getDhis2Mapping(id)` / `saveDhis2Mapping(id,...)` / `deleteDhis2Mapping(id)` | `storage.get/put/delete('mappings', id)` |
| `validateDhis2Mapping(def)` | `connectors.validate({connectorId, mapping})` |
| `getDhis2Metadata()` | `storage.get('metadataCache','latest')` (the `.metadata` lists) |
| `getDhis2EventSources()` | `reports.eventSources()` |
| `getReportColumns(reportId)` | `reports.columns(reportId)` |
| `fetchReports()` | `reports.list()` |
| `listConnectors()` | `connectors.list()` |
| `runDhis2Mapping(id,{period,dryRun})` | load mapping via `storage.get('mappings',id)` → `connectors.push({connectorId: mapping.connectorId, mapping, orgUnitMap, period, dryRun})` (orgUnitMap built from `storage.list('orgUnitMaps')`) |
| `listDhis2Pushes()` | `storage.list('pushes')` (push history is written by `connectors.push` results — Task 2's orchestration appends a push doc to `plugin_data('dhis2-sink','pushes',<id>)`; add that write in the orchestration) |
| `listDhis2Schedules()` / `createDhis2Schedule(...)` / `setDhis2ScheduleEnabled(...)` / `deleteDhis2Schedule(...)` | `schedule.list()` / `schedule.register(...)` / `schedule.register({...,enabled})` (re-register to toggle) / `schedule.remove(id)` |

- [ ] **Task 6 — Dashboard** (`screens/Dashboard.tsx`) mirrors `apps/web/src/pages/Dhis2.tsx` (138 LOC): active-connector status, metadata counts, recent pushes, a "Pull metadata" button (`connectors.metadata`→`storage.put`), nav links to the other screens. Test against the mock. Commit.

- [ ] **Task 7 — Org-unit mapping** (`screens/OrgUnits.tsx`) mirrors `Dhis2OrgUnits.tsx` (97 LOC): a table of facilities (`fhir.facilities()`) each with a searchable orgUnit picker (a self-built combobox over `metadataCache.orgUnits`); set/clear via `storage.put/delete('orgUnitMaps',...)`. Test. Commit.

- [ ] **Task 8 — Schedules** (`screens/Schedules.tsx`) mirrors `Dhis2Schedules.tsx` (105 LOC): list (`schedule.list()`), create (mapping picker from `storage.list('mappings')`, periodType select, eventDriven toggle → `schedule.register`), enable/disable (re-register), delete (`schedule.remove`). Test. Commit.

- [ ] **Task 9 — Push history** (`screens/Pushes.tsx`) mirrors `Dhis2Pushes.tsx` (41 LOC): read-only table from `storage.list('pushes')`. Test. Commit.

- [ ] **Task 10 — Mappings list + run** (`screens/Mappings.tsx`) mirrors `Dhis2Mappings.tsx` (120 LOC): list/delete (`storage.list/delete('mappings')`), a run dialog (period input + dry-run/push → `connectors.push`), shows the result (imported/updated/conflicts/skipped). Test. Commit.

- [ ] **Task 11 — Mapping editor** (`screens/MappingEditor.tsx`) mirrors `Dhis2MappingEditor.tsx` (332 LOC — the hard one): create/edit aggregate or tracker mapping with the cascading pickers — report (`reports.list`) → columns (`reports.columns`), metadata pickers (dataElements/COCs/programs/stages from `storage.get('metadataCache','latest')`), event-source (`reports.eventSources`), connector (`connectors.list`); validate (`connectors.validate`); save (`storage.put('mappings',id,{name,definition})`). Build the plugin's own `<Picker>` (searchable select) once and reuse it for all the cascading selects. Test the aggregate + tracker branches + validation against the mock. Commit. (This task is the largest; if it grows unwieldy, split into 11a aggregate / 11b tracker — note in the report.)

### Task 12: Wire the screens into the SPA router + i18n + rebuild

**Files:** `wasm/dhis2-sink/ui/src/main.tsx` (router/nav), `wasm/dhis2-sink/ui/src/i18n.ts` (self-contained en/fr/pt strings ported from the host `dhis2.*` keys — the plugin bundles its own i18n; default en, read `openldr.locale`).

- [ ] Wire a simple top-nav (Dashboard/OrgUnits/Mappings/Schedules/Pushes) + screen routing (state enum or hash). Port the `dhis2.*` i18n strings into `ui/src/i18n.ts` (en/fr/pt) keyed the same; the SPA picks the bundle by `openldr.locale`. Rebuild `pnpm build:dhis2-sink`, confirm the ui.html still bundles. Run the SPA's vitest suite. Commit.

---

## Phase 4 — Cutover: install plugin, delete host DHIS2, repoint workflow node

**This phase removes the host DHIS2 surface. Do it only after Phases 1–3 are green and the plugin is built.**

### Task 13: Publish/install the UI-bearing `dhis2-sink` + verify it loads

- [ ] Rebuild + re-pack `dhis2-sink` into the local registry (extend `scripts/make-marketplace-bundle.ts` `buildDhis2SinkBundle` to include `ui.html` — it uses `packBundle` which already handles the bundle dir; confirm the signed manifest carries the ui block + sha). Install via `pnpm openldr plugin install reference-plugins/.../dhis2-sink` (the CLI ui.html fix from SP-A1b persists it). Confirm `GET /api/plugins/ui` lists `dhis2-sink` with the DHIS2 nav, and `/x/dhis2-sink` serves the asset. (Manual/scripted check; covered by the Phase 5 e2e.) Commit any packaging changes.

### Task 14: Delete the host DHIS2 server surface

**Files (DELETE):** `apps/server/src/dhis2-routes.ts` (+ `.test.ts`), `packages/bootstrap/src/dhis2-context.ts` (+ `dhis2-context.test.ts`, `dhis2-sync.test.ts`), `packages/db/src/dhis2-store.ts` (+ test), `packages/db/src/dhis2-schedule-store.ts` (+ test), `packages/db/src/dhis2-metadata-cache.ts` (+ test), `packages/cli/src/dhis2.ts` (+ wiring in cli entry), `apps/server/src/dhis2-live.acceptance.test.ts`, `scripts/dhis2-live-acceptance.ts`.
**Files (MODIFY):** `packages/bootstrap/src/index.ts` (remove `export * from './dhis2-context'`), `apps/server/src/app.ts` (remove `registerDhis2Routes` + its store deps + the import), `apps/server/src/index.ts` (remove the `createDhis2Context`/`registerSync`/`reconcileSchedules`/`ctx.workflows.services.dhis2Push` block), `packages/db/src/index.ts` (remove the deleted store exports), `packages/db/src/schema/internal.ts` (the old table interfaces may stay — the tables still exist; leave them or remove the unused `*Table` types if nothing references them), `package.json` (remove `dhis2:accept` script if it references the deleted runner), config (`REPORTING_TARGET_ADAPTER`/`DHIS2_SYNC_ENABLED` — keep or repurpose; decide: keep `REPORTING_TARGET_ADAPTER` as a no-op or remove — minimal: leave config vars, remove only the code that consumed them).

- [ ] Delete the files; remove the imports/wiring; fix every resulting typecheck error (the cascade will be large — `createDhis2Context`, the stores, `dhis2Push` service). Run `pnpm turbo run typecheck --filter=@openldr/bootstrap --filter=@openldr/server --filter=@openldr/db --filter=@openldr/cli --force` until clean. Commit in logical chunks (db stores, bootstrap context, server wiring, cli).

### Task 15: Delete the host DHIS2 web screens + routes + nav + i18n

**Files (DELETE):** `apps/web/src/pages/Dhis2.tsx`, `Dhis2OrgUnits.tsx`, `Dhis2Mappings.tsx`, `Dhis2MappingEditor.tsx`, `Dhis2Schedules.tsx`, `Dhis2Pushes.tsx` (+ their `.test.tsx`), `apps/web/src/pages/settings/Dhis2Redirect.tsx` (+ test).
**Files (MODIFY):** `apps/web/src/App.tsx` (remove all `/settings/dhis2/*` routes + the redirect), `apps/web/src/pages/settings/SettingsShell.tsx` (remove the `settings.subNav.dhis2` SUB_NAV entry), `apps/web/src/api.ts` (remove the 16 `dhis2*`/mapping/orgunit/schedule/push functions + their types — keep `listConnectors`/`testConnector`), `apps/web/src/i18n/{en,fr,pt}.ts` (remove the `dhis2` namespace ~90 keys; the plugin owns them now), `apps/web/src/i18n/parity.test.ts` (still passes — all three drop the same keys).

- [ ] Delete + remove. Fix typecheck (anything importing the removed api fns). Run `pnpm -C apps/web typecheck` + `pnpm -C apps/web test` (isolated). Confirm parity test green. Commit.

### Task 16: Repoint the `dhis2-push` workflow node

**Files:** `packages/workflows/src/engine/node-handlers/dhis2-push.ts`, `apps/server/src/index.ts` (the `ctx.workflows.services.dhis2Push` assignment), `apps/web/src/workflows/components/node-forms/dhis2-push-form.tsx`.

- [ ] Repoint `ctx.workflows.services.dhis2Push` to the new orchestration: it now reads the mapping from `plugin_data('dhis2-sink','mappings',mappingId)` and calls `dhis2Orch.push({connectorId: mapping.connectorId, mapping, orgUnitMap, period, dryRun})`. The node handler stays the same shape. The web `dhis2-push-form` mapping picker now reads mappings via... the workflow form runs in the host web app (not the plugin iframe), so it needs a host endpoint to list dhis2 mappings — add a tiny host helper OR have the form call the broker route `POST /api/plugins/dhis2-sink/broker {op:{kind:'storage.list',collection:'mappings'}}` (any-authed) to populate the picker. Decide: simplest is the broker route (already exists). Update the form to fetch mappings via `pluginBrokerCall('dhis2-sink', {kind:'storage.list', collection:'mappings'})`. Test + typecheck. Commit.

---

## Phase 5 — Live verification + gate

### Task 17: Live e2e against Docker DHIS2 + the deferred A1b e2e

- [ ] Bring up the stack (Docker DHIS2 SL demo on :8085 is already running; `SECRETS_ENCRYPTION_KEY` + a connector configured). Build server+web, run migration 036, install the UI-bearing `dhis2-sink`. Drive the plugin UI via Playwright (extend `e2e/`): open `/x/dhis2-sink`, pull metadata, create an aggregate mapping (report→columns→dataElement pickers + connector), map an org unit, run a dry-run then a real push, confirm "imported", view push history. ALSO run the deferred SP-A1b reference-plugin e2e now (full stack up). If the live stack can't run in the environment, capture the blocker + commit the e2e spec (deferred-to-manual, like SP-A1b). Commit.

### Task 18: Full gate + depcruise

- [ ] `pnpm turbo run typecheck lint test build --force --continue` (re-run any web/plugins/marketplace/users flake isolated — trust isolated). `pnpm depcruise` (the new bootstrap→fhir/db edges; the deleted dhis2 modules reduce module count). Confirm green. Commit any residue.

---

## Self-Review (run before handoff)

**Spec coverage (SP-A2):** 5 screens→webview (Tasks 6–11 cover all 6) ✓; mappings/schedules/org-unit/metadata/pushes → plugin datastore (Task 3 migration + the screens write via storage) ✓; runMapping → host-orchestrated op the plugin triggers (`connectors.push`, Task 2) + scheduled (Task 4 runner) ✓; delete host page/routes/context (Tasks 14–15) ✓; uninstallable (the plugin is the only DHIS2 surface after cutover) ✓; live e2e (Task 17) ✓.

**Placeholder scan:** the screen tasks (6–11) reference the exact host screen + the exact api→SDK substitution table — concrete + executable, not placeholders. The orchestration (Task 2 Step 4) ports `dhis2-context.runMapping` verbatim with the documented swap.

**Type consistency:** `BrokerOp` (server) ≡ `PluginBrokerOp` (SDK) ≡ the bootstrap inline ops ≡ the mock — all extended together in Task 1. `connectors.push` input shape is identical across SDK/bootstrap/broker/orchestration. `plugin_data` collections (`orgUnitMaps`/`mappings`/`schedules`/`metadataCache`/`pushes`) are consistent across the migration (Task 3), the orchestration push-history write (Task 2/6–11), and the screen substitution table.

**Sequencing safety:** Phases 1–2 are additive (host DHIS2 untouched). Phase 4 is the atomic cutover. The plugin-schedule runner (Task 4) only arms schedules present in `plugin_data`, which is empty until migration 036 runs at cutover → no double-fire with the still-present host scheduler during Phases 1–3.

**Open risks to confirm during execution:** (a) Preact bundle size inlined into ui.html (should be ~tens of KB — fine; if large, note it). (b) the MappingEditor (Task 11) is the heaviest — split 11a/11b if needed. (c) `reports.columns` running the full report just for columns may be slow for large reports — acceptable for v1 (matches the host's current `/report-columns`). (d) Extism worker-path egress under tsx (the dhis2:accept gotcha) — run live e2e via vitest/built server, not tsx.

---

## Execution Handoff

Plan complete and saved. Recommended: **Subagent-Driven** (fresh subagent per task, two-stage spec+quality review, merge to local `main`, full gate green per task) — same discipline as SP-A1a/A1b. Phases 1–2 first (additive, safe), then 3 (the SPA), then 4 (cutover) only when 1–3 are green, then 5 (live verify).
