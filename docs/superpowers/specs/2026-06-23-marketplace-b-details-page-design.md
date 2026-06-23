# Marketplace Sub-project B — Details Page — Design

**Date:** 2026-06-23
**Status:** Approved
**Parent roadmap:** `docs/superpowers/specs/2026-06-23-marketplace-roadmap-design.md`
**Topic:** Replace the flat Available/Installed tables with a corlix-style tabbed card grid +
full-view detail page, against the existing local registry. Plugins only; kind-aware so the
remote registry (A) and non-plugin kinds (C) slot in without a rewrite.

---

## 1. Motivation

The current Settings ▸ Marketplace UI (`apps/web/src/pages/settings/Marketplace.tsx`) is two flat
tables. There is **no way to see what an artifact does** — the user's literal complaint: "I see
whonet-sqlite but have no idea what it does." corlix solves this with a card grid + a rich detail
view (`PackageCard`, `PackageDetail`, `PayloadPreview`, `RequirementsChecklist`). This sub-project
ports that UX, adapted to our **signed, capability-scoped** artifact model.

This is the **first** sub-project of the marketplace roadmap (smallest, immediate value, no backend
distribution changes). It works entirely against the **current local registry**
(`MARKETPLACE_REGISTRY_DIR` + `GET /api/marketplace/available|installed`).

---

## 2. Decisions locked during brainstorming

- **Detail pattern: full-view in-pane** (corlix-style ← Back page that replaces the grid), NOT a
  slide-over drawer. Matches `corlix .../components/marketplace/PackageDetail.tsx`.
- **Grid organization: `Browse` / `Installed (n)` tabs.** corlix's third tab "Updates" is out of
  scope (needs the remote registry — sub-project A).
- **Consent unchanged:** the existing capability-consent dialog is retained; the detail's Install
  button is just a new trigger. The `acknowledgedCapabilities` install contract is unchanged.
- **Permissions box is our addition over corlix** — capabilities rendered as human-readable lines,
  because our artifacts are capability-scoped and corlix's are not.

---

## 3. Scope

**In scope**
- Tabbed card grid (Browse / Installed) replacing the two tables.
- Full-view, kind-aware detail page with description, payload preview, and a Details / Permissions /
  Requirements / Tags sidebar.
- Small API additions to feed the detail view (description, license, full-manifest-by-ref).
- Component + route tests.

**Out of scope (deferred)**
- Remote fetch / `index.json` / GitHub publish → **A**.
- Update scanning, drift detection → **A**.
- Form / report / test-definition install lifecycles → **C**. Non-plugin kinds render in the grid
  and detail but their primary action is a disabled "Install (coming soon)".

---

## 4. Architecture

### 4.1 New components — `apps/web/src/pages/settings/marketplace/`

`Marketplace.tsx` becomes a thin container that loads data and renders `MarketplaceTabs`. The
existing file's data-loading hooks (`load`, install/enable/disable/rollback/remove, toasts) are
reused; only the presentation changes.

- **`MarketplaceTabs.tsx`** — shadcn `Tabs` with `Browse` and `Installed (n)`. Browse carries the
  search `Input` + type-filter `Select`. Holds the `selected` ref state and swaps grid ↔ detail.
- **`PackageCard.tsx`** — a `<button>` card: id, type `Badge`, `publisher · v{version}`, category,
  and a state/signature badge. Signature badge reuses the existing `signatureBadge` logic
  (Verified / First-use / Invalid). State badge: Install / Installed / Active.
- **`PackageDetail.tsx`** — full-view, kind-aware:
  - **Header:** `← Back`, title, `publisher · v{version} · category · <signature>`, a **primary
    action** button, and (when installed) a `⋯` `DropdownMenu`.
  - **Left column:** manifest `description` (fallback to a muted "No description provided"), then
    **`PayloadPreview`**.
  - **Right sidebar (244px):** **Details** (`<dl>` publisher/version/category), **Permissions**
    (capabilities via a `capabilityLine()` helper — promoted from the current file), **Requirements**
    (compatibility checklist), **Tags**.
- **`PayloadPreview.tsx`** — kind-dispatched. Plugin: entrypoint, wasm sha256 (truncated, mono),
  `wasi`, limits (memoryMb / timeoutMs), license. Non-plugin kinds: a placeholder until C.
- **`RequirementsChecklist.tsx`** — renders compatibility check rows (✔/✗). For B the only check is
  `ceVersion` semver compatibility (reuse `isCompatible` from `@openldr/marketplace`).

### 4.2 Primary action (kind-aware)

| Artifact state | Primary button | ⋯ menu |
| --- | --- | --- |
| plugin, not installed, valid | **Install** → opens consent dialog | — |
| plugin, not installed, invalid | disabled (tooltip: invalid signature) | — |
| non-plugin, not installed | disabled **Install (coming soon)** | — |
| installed (active) | — (or "Installed") | Disable, Remove |
| installed (inactive version) | — | Enable, **Rollback**, Remove |

Lifecycle actions reuse the existing `setArtifactEnabled` / `rollbackArtifact` / `removeArtifact`
API helpers and their toasts. Rollback stays available only on inactive version rows (current
behavior, preserved). Remove keeps the `ConfirmDialog`.

### 4.3 API changes — `apps/server/src/marketplace-routes.ts`

1. **Enrich `GET /api/marketplace/available`**: add `description` and `license` to each bundle entry
   (both already on the bundle manifest; just map them through).
2. **New `GET /api/marketplace/available/:ref`** (`requireRole('lab_admin')`, `safeRef` guard):
   returns the full manifest for one bundle — `id, version, type, description, license, publisher,
   capabilities, compatibility, payload metadata, valid`. The detail view calls this on open
   (mirrors corlix `checkRequirements` fetching the full package). Payload metadata is the
   manifest's `payload` object (entrypoint/wasmSha256/wasi/limits for plugins) — **no payload bytes
   are sent**.

   *Rationale (resolves the brainstorm open question):* a dedicated `:ref` endpoint keeps the grid
   payload small and gives the detail view a single source for full data, instead of fattening every
   `available` row with payload metadata most cards never show.

3. **`installed`** detail reuses the existing `GET /api/marketplace/installed` row (already includes
   capabilities); no new endpoint needed for installed items.

### 4.4 Client — `apps/web/src/api.ts`

- Extend `AvailableArtifact` with `description?: string` and `license?: string`.
- Add `getAvailableArtifact(ref): Promise<AvailableArtifactDetail>` using the existing `apiGet`.
- New `AvailableArtifactDetail` type (full manifest shape).

### 4.5 i18n

New keys under `settings.marketplace.*` for tab labels, sidebar section headings (Details /
Permissions / Requirements / Tags), payload-preview field labels, "Install (coming soon)",
"No description provided", and "Compatible with CE {version}" — added to en/fr/pt
(`apps/web/src/i18n/{en,fr,pt}.ts`), preserving the compile-time key-parity convention.

---

## 5. Data flow

1. Tabs container calls `listAvailableArtifacts()` + `listInstalledArtifacts()` on mount (as today).
2. Browse renders `PackageCard`s from the filtered available list; Installed renders cards from the
   installed list.
3. Clicking a card sets `selected` and (for available) calls `getAvailableArtifact(ref)` to hydrate
   the detail; installed items hydrate from the already-loaded installed row.
4. Detail actions call the existing mutation helpers, then re-load and return to the grid (corlix's
   `onChanged()` + `onBack()` pattern).

---

## 6. Testing

- **Web component tests** (extend `Marketplace.test.tsx`, or new sibling test files):
  - `PackageCard` renders the correct state + signature badge per input.
  - `PackageDetail` renders description, capabilities lines, requirements rows; Install opens the
    consent dialog and sends acknowledged capabilities; installed item shows enable/disable/rollback/
    remove appropriately; non-plugin shows disabled Install.
  - Tab switch shows the right collection; Installed count badge correct.
- **Server test** (extend the marketplace-routes test): `GET /available/:ref` returns the enriched
  manifest and rejects traversal refs; `available` rows now include `description`/`license`.

---

## 7. Risks / notes

- The `:ref` endpoint reads + verifies a bundle on each detail open. Bundles are small and local;
  acceptable. (Caching belongs to A's remote source, not here.)
- Keep `PackageDetail` kind-aware from day one so A/C don't force a rewrite — the kind switch in
  `PayloadPreview` and the primary-action table are the seams.
- No change to trust/signing/capability enforcement; this is presentation + two read endpoints.
