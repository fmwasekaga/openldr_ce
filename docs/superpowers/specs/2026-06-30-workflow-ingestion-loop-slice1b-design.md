# Workflow Ingestion Loop — Slice 1b (Builder UI for Form Validate + Persist Store) — Design

**Date:** 2026-06-30
**Status:** Approved (brainstorm) — ready for implementation planning
**Depends on:** Slice 1 (backend) — merged to local `main` at `8950e5a`.
**Topic:** Make the two new host nodes (Form Validate, Persist Store) drivable from the Workflow Builder UI.

---

## 1. Problem

Slice 1 added two host workflow nodes — **Form Validate** and **Persist Store** — with declarative `config[]` arrays in their `HOST_NODE_DESCRIPTORS` entries (`formId` select with `optionsSource: 'forms'`; `source` text). The backend, registry, and `forms` options resolver are all in place. But the builder does not yet render config UI for them, and they are not in the palette, so a user cannot drag, configure, or run them from the UI.

### How the builder renders node config today (established by exploration)

- The right-hand config panel (`apps/web/src/workflows/components/panels/node-config-panel.tsx`) dispatches via `pickForm(node)` in `node-forms/index.tsx`, keyed on `node.data.templateId`.
- **Host nodes** use **bespoke hardcoded forms** (`sql-form.tsx`, `materialize-form.tsx`, `set-form.tsx`, …). None read the descriptor's `config[]`. Unregistered nodes fall through to a minimal `DefaultForm`.
- **Plugin nodes** use a generic `PluginNodeForm` (`node-forms/plugin-node-form.tsx`) that renders a descriptor's declarative `config[]` (text/number/boolean/select/multiselect/json/file) and resolves `optionsSource` via `GET /api/workflows/node-options/:source`. It is already node-type-agnostic except that it uses `node.data.pluginId` only to scope the options fetch.
- The **palette** is a hardcoded template list in `apps/web/src/workflows/components/sidebar/constants.ts`; dropping a node seeds `data` from `template.defaultData` (with `config: {}`) plus `templateId`.
- The **Output tab** already renders each node's run `meta` (`nodeRunMeta[nodeId]`) in a generic "Result" JSON view. So `form-validate`'s `meta.invalid` and `persist-store`'s `meta.persisted` display with no extra work.

---

## 2. Approved decision

**Path B — generalize the declarative renderer.** Turn `PluginNodeForm` into a node-type-agnostic `DeclarativeNodeForm` that renders any node's descriptor `config[]` (plugin or host). Route the two host nodes to it, add palette entries, and include an **auto-fallback** so any host node with a non-empty `config[]` and no bespoke form renders declaratively. (Rejected: Path A — two bespoke per-node forms — because it re-implements the select/`optionsSource` logic the generic form already has and doesn't future-proof.)

---

## 3. Components & changes

### 3.1 `DeclarativeNodeForm` (generalize `plugin-node-form.tsx`)
- Make `pluginId` optional. Descriptor lookup from `/api/workflows/nodes`:
  - **Plugin nodes:** match by `pluginId + nodeId` (unchanged behavior).
  - **Host nodes:** match by descriptor `id` === the node's `action` (equivalently its `templateId`, e.g. `form-validate`).
- `optionsSource` fetch already works without a `pluginId` (the `forms` resolver ignores `pluginId`). Pass `pluginId` only when present.
- Reads/writes `node.data.config` exactly as today.
- **Plugin-node behavior must remain identical** — this is a generalization, not a redesign. Keep the existing `plugin-node` → form mapping working.

### 3.2 Form router (`node-forms/index.tsx`)
- Register `form-validate` and `persist-store` → `DeclarativeNodeForm`.
- **Auto-fallback:** when `pickForm` finds no bespoke form for a node, and that node's descriptor (from the fetched `/api/workflows/nodes` list) has a non-empty `config[]`, route to `DeclarativeNodeForm` instead of `DefaultForm`. Existing host nodes (whose descriptors have `config: []`) are unaffected and keep their bespoke forms.

### 3.3 Palette (`sidebar/constants.ts`)
- Add two templates:
  - **Form Validate** — `type: 'action'`, `data: { action: 'form-validate', config: {} }`, `templateId: 'form-validate'`, in the Transforms group.
  - **Persist Store** — `type: 'action'`, `data: { action: 'persist-store', config: {} }`, `templateId: 'persist-store'`, in the Sinks group.

### 3.4 Meta display
No change. The Output tab's generic "Result" view already renders the nodes' run meta.

---

## 4. Data flow

Drag node from palette → `data.config = {}` → select node → `DeclarativeNodeForm` fetches the descriptor, renders the `formId` select (options from `/api/workflows/node-options/forms`) and the `source` text field → edits write `data.config` → save/run → handler emits meta → Output tab shows `meta` + items.

---

## 5. Error handling

- **Required `formId`:** the select makes it visible/selectable; if left unset, the Form Validate handler already throws `Form Validate node: formId is required` at run, surfaced in the Output tab's error badge.
- **`optionsSource` fetch failure:** the resolver never throws (returns `[]`), so the dropdown is empty rather than broken.
- **No published forms:** the `forms` dropdown is empty; the user must publish a form first (data setup, not a code path).

---

## 6. Testing

- **Web component tests** (vitest + testing-library), run **isolated** (`pnpm -C apps/web test`) per the known `web#test` parallel flake:
  - `DeclarativeNodeForm` renders a host node's `formId` select populated from mocked `forms` options, and its `source` text field; editing updates `data.config`.
  - Existing plugin-node rendering tests still pass unchanged (regression guard for the generalization).
  - The auto-fallback routes a host node with `config[]` (no bespoke form) to `DeclarativeNodeForm`, and a host node with `config: []` still uses its bespoke/default form.
  - The palette includes Form Validate and Persist Store.
- **Manual browser pass** for the end-to-end demo: drag trigger → convert → Form Validate (pick a published form) → Persist Store → run → confirm rows persist and `meta` (validated/invalid, persisted) shows in the Output tab.

---

## 7. Out of scope (YAGNI / later slices)

- Richer invalid-row visualization (generic JSON "Result" view is sufficient for now).
- Seeding `data.config` from descriptor `default` values (the form populates config on edit).
- Any change to plugin-node runtime/behavior.
- The Slice-1 follow-ups already tracked (visibility rules in `validateAnswers`; `meta.invalid` label omission; `reportingDb`/`externalDb` consolidation; stronger extraction test) — addressed separately.
