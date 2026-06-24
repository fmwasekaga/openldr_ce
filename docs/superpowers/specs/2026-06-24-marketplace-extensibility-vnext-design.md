# Marketplace / Extensibility v-next — Design

Date: 2026-06-24
Status: **Approved (brainstorm complete). Implementation deferred to per-sub-project plans.**
Author: brainstormed with Fredrick

## Goal

Make OpenLDR features **removable units, not code dependencies**. The driving principle:
if a feature (e.g. DHIS2) breaks or stops being free tomorrow, you **uninstall the plugin**
— you do not refactor the app. That forces a real extensibility surface: plugins must be
able to contribute their **own UI** and own their **own data**, fully isolated and
capability-gated, so the host stays generic.

This umbrella also fixes three nearer-term gaps surfaced in review: the marketplace shows
duplicate cards per version, registries are single + boot-time-only, and the Workflow
Builder has no list/index page.

## Decomposition (five sub-projects)

Each sub-project gets its own spec-confirmed plan → implementation → green gate.

- **SP-A1 — Plugin-UI extensibility surface** (foundation): manifest `ui` contribution,
  sandboxed-iframe host + host-injected versioned SDK over a transferred `MessagePort`,
  the host-services **broker** (capability + global-policy enforcement), the per-plugin
  **datastore**, **nav contribution**, the **declarative-schema** tier, and a small
  **reference UI plugin** proving it end-to-end.
- **SP-A2 — Migrate DHIS2 into a UI-plugin** (depends on SP-A1): port the DHIS2 screens
  into a webview plugin, migrate its host tables into the plugin datastore, wire scheduling
  through the host scheduler invoking the wasm, and **delete the host-side DHIS2
  page/routes/context**. The payoff: DHIS2 becomes uninstallable.
- **SP-B — Marketplace version model**: collapse Browse cards by plugin id (latest);
  version-switch on the detail page.
- **SP-C — User-managed registries**: DB-backed, multiple registries, configured in-app,
  no restart (modeled on Connectors).
- **SP-D — Workflow list/index page**: n8n-style list at `/workflows`, builder at
  `/workflows/:id`.

**Build order: SP-D → SP-B → SP-C → SP-A1 → SP-A2.** (Quick, independent wins first;
the plugin-UI arc last because it is the largest. Design order below is A-first because
it is the architectural keystone the rest is shaped around.)

---

## SP-A — Plugin-contributed UI (architecture)

### Two tiers

A plugin may contribute UI at either tier (or none):

1. **Declarative-schema config** — the manifest carries a JSON-Schema; the **host** renders
   standard form controls and persists answers to the plugin datastore. No plugin frontend
   code, no iframe. For plugins that only need configuration.
2. **Embedded webview** — the plugin ships a real frontend (HTML/JS/CSS) in its bundle,
   rendered in a sandboxed iframe. For rich apps like DHIS2.

### Isolation / trust posture

The embedded webview is treated as **untrusted** (defense-in-depth, even though plugins are
signed + admin-installed + capability-consented):

- Rendered in an `iframe` with `sandbox="allow-scripts"` (**no** `allow-same-origin` → an
  opaque unique origin), a strict CSP, **no** ambient network, and **no** host auth token.
- The host builds the iframe document (`srcdoc`/blob) from the plugin's bundled assets, so
  the host controls the document shell.
- The **only** communication channel is a private `MessagePort` (see SDK delivery). The
  plugin cannot reach the parent DOM, cookies, token, or other frames.

### SDK delivery (the part to get right this time)

Goal: no race, no global `window.postMessage` bus, no plugin-controlled/forged SDK.

- The host **inlines a tiny SDK bootstrap before any plugin code runs** in the iframe
  document it constructs — so plugin code can never run before the SDK exists.
- On load the host posts a single `init` message that **transfers a dedicated
  `MessagePort`**, carrying the init context: `pluginId`, granted capabilities, theme,
  locale, and a per-instance **session id the host minted**. All subsequent traffic flows
  over that private port.
- The bootstrap wires the port into a typed, **promise-based RPC** (`await
  openldr.storage.get(k)`, `await openldr.invoke('push_aggregate', input)`, `await
  openldr.reports.run(id, params)`) and resolves `openldr.ready`, which plugin code awaits.
- Plugins develop against a published **`@openldr/plugin-ui-sdk`** (types + a dev mock), but
  at **runtime the host injects the SDK version matching `manifest.uiSdkVersion`** — a plugin
  cannot ship a forged or stale SDK, and the parent-side broker is the single enforcement
  point.

### The broker + capability + global-policy model

The host (parent) is the **broker** and the single enforcement funnel. The unifying rule:
**a plugin never holds a raw handle to anything** — no DB connection, no socket, no token,
no FHIR store. Every capability is a *request the host fulfills* under both:

1. the plugin's **capability grant** (the ceiling, consented at install), **and**
2. the current **global policy / kill-switch** (a runtime restriction the broker checks on
   *every* call — e.g. "egress disabled" refuses all `net-egress` regardless of grant).

Because all access funnels through the one broker, there is no bypass. Grants are the max;
policy can only further restrict.

### Per-plugin datastore (server-scoped isolation)

- Each plugin gets `openldr.storage` — a KV + simple JSON-document store (collections + keys
  + a `doc jsonb`), with a small query surface (by collection, key, and equality/range on
  indexed fields). No raw SQL.
- The broker **stamps every storage call with the authenticated plugin-instance id the host
  minted** (never anything the plugin sends) and scopes it to that plugin's namespace. There
  is no API to *name* another namespace, so a plugin cannot read another plugin's — or the
  host's — data.
- Backing: a host table `plugin_data(plugin_id, collection, key, doc jsonb, updated_at)`
  (internal DB), unique on `(plugin_id, collection, key)`. DHIS2's mappings, schedules,
  org-unit maps, metadata cache, and push history become rows in **its** namespace.

### Host-services catalog (v1 = what DHIS2 needs)

Each gated by a capability, except the always-private ones. Shared resources are exposed as
**operations, not access** (the host performs them with its own creds + policy):

| Service | Capability | Notes |
|---|---|---|
| `storage.*` | none (private) | per-plugin datastore, server-scoped |
| `invoke(entrypoint, input)` | none (own wasm) | call the plugin's own wasm entrypoints |
| `reports.run` / `reports.list` / `reports.columns` | `host:reports` | host runs the query with its creds, returns rows |
| `connectors.list` / `connectors.test` | `host:connectors` | DHIS2 push-target selection + live test |
| `schedule.register` / `schedule.list` / `schedule.remove` | `host:schedule` | host scheduler invokes the plugin **wasm** on fire (headless) |
| `emit-fhir`, `net-egress` | existing caps | same broker enforcement |

The catalog is intentionally small and grows only by adding gated **operations**, never raw
handles. Exact wire shapes are pinned in the SP-A1 plan.

### Nav contribution

Installed UI-plugins render as entries (icon + label) in the main sidebar (VSCode-style),
routed to `/x/:pluginId`, role- **and** capability-gated. The manifest `ui.nav`
(`{ label, icon, section }`) drives it. DHIS2 (as a plugin) appears here instead of
Settings ▸ DHIS2.

### Manifest additions

```jsonc
"ui": {
  "entry": "ui/index.html",            // bundled frontend entry (embedded tier)
  "nav": { "label": "DHIS2", "icon": "share-2", "section": "apps" },
  "uiSdkVersion": "1",                 // host injects this SDK runtime
  "capabilities": ["host:reports", "host:connectors", "host:schedule", "net-egress"],
  "declarative": { /* optional JSON-Schema for the no-webview tier */ }
}
```

`ui` assets ship inside the signed bundle (covered by the existing signature over the
manifest + payload; UI asset integrity handled the same way as the wasm payload — pinned in
the SP-A1 plan).

### Scheduling = wasm headless

A sandboxed iframe only exists while its panel is open, so scheduled/event-driven work
cannot run in the UI. The plugin stays split: the **wasm** is the headless worker the host
invokes on a schedule/event (the existing `dhis2-sink` entrypoints), and the **UI** is for
configuration. `schedule.register` records a schedule in the plugin datastore + the host
scheduler (reusing the existing trigger-runner / report-scheduler) invokes the wasm on fire.

### End-to-end data flow (DHIS2 push, as a plugin)

1. Operator opens the DHIS2 plugin panel (`/x/dhis2`) → host renders the iframe + injects SDK.
2. UI reads/writes mappings via `openldr.storage` (its namespace); lists connectors via
   `openldr.connectors.list` (gated); previews report columns via `openldr.reports.columns`.
3. To push now: UI calls a host operation (e.g. `openldr.invoke` for a dry-run mapping, or a
   `runMapping` host-op that does report→rows→wasm push→connector egress under policy).
4. To schedule: UI calls `openldr.schedule.register`; the host scheduler later invokes the
   plugin wasm headlessly with rows the host produced.
5. Uninstall the plugin → nav entry, UI, wasm, schedules, and the plugin's datastore
   namespace all go away. No host code changes.

### Uninstall / data retention

On uninstall the plugin's datastore namespace is **purged**, with an **export** option
offered first (download the plugin's data as JSON) so an operator can keep DHIS2 mappings
before removing. Exact UX pinned in the SP-A2 plan.

### SP-A1 deliverable vs SP-A2

- **SP-A1** ships the whole surface above + a **small reference UI plugin** (stores config in
  its datastore, renders a panel, calls one gated host service) proving the handshake,
  isolation, broker, datastore, nav, and declarative tier — *without* porting DHIS2.
- **SP-A2** ports DHIS2 onto the surface: the 5 screens → webview; mappings/schedules/
  org-unit maps/metadata cache/push history → plugin datastore (one-time data migration);
  `runMapping` → host-orchestrated operation the plugin triggers/schedules; **delete** the
  host DHIS2 page/routes/`dhis2-context`. DHIS2 becomes a removable plugin.

---

## SP-B — Marketplace version model

**Problem:** `LocalRegistrySource.list()` lists every bundle directory as its own card, so
two versions of one plugin (`whonet-narrow` = v1.0.0, `whonet-wide` = v1.1.0, both id
`whonet-sqlite`) show as two cards. With 100 versions you get 100 cards. (The HTTP source
already collapses by id via `latestVersion`.)

**Design:**
- Browse shows **one card per plugin `id`** (highest semver). `LocalRegistrySource.list()`
  groups bundles by `manifest.id`, returns one listing per id carrying the available versions
  (refs + versions), consistent with the HTTP source.
- The **detail page gets a version selector** (dropdown of available versions). Selecting a
  version fetches *that* version's detail (readme/payload/capabilities may differ) and targets
  install/rollback at that version's ref. `market install`/`rollback` are already
  version-aware — only the UI needs to pick the ref.

---

## SP-C — User-managed registries

**Problem:** the registry is a single source from one env var (`MARKETPLACE_REGISTRY_URL`
wins over `_DIR`), resolved **once at server boot** — changing it requires a restart, and you
cannot have more than one (a ministry running its own private registry alongside the public
one has no path).

**Design:**
- DB-backed `registries` table (modeled on Connectors): `{ id, name, kind: 'http'|'local',
  location, enabled, created_at, updated_at }`. CRUD at `/api/marketplace/registries`
  (`lab_admin`), managed in a Settings ▸ Marketplace "Registries" section.
- Marketplace routes **resolve sources from the DB per request** (no restart). Browse
  **aggregates across enabled registries**, each card tagged with its source registry.
- The existing env `MARKETPLACE_REGISTRY_URL`/`_DIR` **migrate into a seed registry row** on
  first boot so nothing breaks; env becomes an optional bootstrap default.
- **Security unchanged:** a registry is only a *source of signed bundles*. Trust still flows
  through signature verification + TOFU publisher pinning + capability consent at install.
  Adding a registry grants no trust by itself; installing from it still requires a valid
  signature and explicit consent. So multi-registry does not weaken the model.

---

## SP-D — Workflow list/index page (n8n-style)

**Problem:** `/workflows` (`apps/web/src/workflows/page.tsx`) drops straight into the builder
for a single `workflowId` — there is no way to list or switch designs.

**Design:**
- `/workflows` becomes a **list page**: saved workflows as a table/cards (name, updated-at,
  trigger/enabled status, last-run), with **open / new / rename / duplicate / delete**.
- The **builder moves to `/workflows/:id`** (and `/workflows/new`). "New" creates a design
  and routes into the builder.
- Reuses the existing workflows CRUD + SSE API (`packages/workflows` + workflows-routes) and
  the existing run-history — no new backend. Role-gated as today (`lab_admin`/`lab_manager`).
- Web-only, small.

---

## Security summary

- Untrusted sandboxed iframe (`allow-scripts`, no same-origin), strict CSP, no token, no
  ambient network. Communication only over a host-minted private `MessagePort`.
- One broker = one enforcement funnel: capability grant (ceiling) AND global policy
  (runtime restriction) checked on every call. No raw resource handles ever cross to a plugin.
- Per-plugin datastore is server-scoped by the authenticated plugin-instance id; no API to
  name another namespace.
- Shared resources exposed as gated operations, not access; the host performs them under its
  own creds + policy.
- Marketplace trust (signatures, TOFU publisher pinning, capability consent) is unchanged and
  applies regardless of which registry a bundle came from.

## Testing strategy

- **SP-A1:** unit tests for the broker (capability + policy enforcement; cross-namespace
  datastore access denied), the MessagePort handshake (init → ready → RPC correlation;
  capability-denied returns structured error), the declarative-form renderer, and the
  reference UI plugin loading + calling one gated service in a jsdom iframe harness.
- **SP-A2:** data-migration tests (host tables → plugin datastore round-trip), the DHIS2
  plugin's screens against a mocked SDK, and a live e2e (reuse the Docker DHIS2 harness:
  configure + push from the plugin UI).
- **SP-B:** registry-source grouping (N version dirs → one listing per id, latest); detail
  version-switch fetches the right ref.
- **SP-C:** registries store (pg-mem), per-request multi-source aggregation, env→seed
  migration; security: install from a new registry still requires signature + consent.
- **SP-D:** list page (list/create/open/delete) + routing split tests.

## Out of scope / deferred

- A general plugin **inter-plugin** call surface (plugins calling other plugins) — only host
  services in v1.
- Plugin UI **theming beyond** passing theme/locale in the init context.
- Marketplace **federation / remote publish UX** changes beyond SP-C.
- Non-DHIS2 plugin migrations (the surface is generic, but only DHIS2 is migrated).

## Open items to confirm at implementation start

- UI-asset integrity inside the signed bundle (hash list in the manifest vs. a single
  assets archive hash) — decide in the SP-A1 plan.
- The exact `plugin_data` query surface (indexed fields / secondary indexes) the DHIS2
  screens need — derive from the DHIS2 migration in SP-A2.
- Global-policy source of truth (config var vs. a DB-backed policy table) — decide in SP-A1.
- SP-D term: "sessions" interpreted as the **workflow designs list** (n8n "Workflows" home),
  not the executions list (run-history already exists). Confirm in the SP-D plan.
