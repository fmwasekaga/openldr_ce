# Phase 3 SP-0 — Settings Shell + DHIS2 Relocation (Design)

**Date:** 2026-06-22
**Status:** Approved for planning
**Phase 3 context:** First sub-project of the Phase 3 (Ecosystem & Extensibility) workstream. SP-0 builds the UI groundwork — a corlix-style Settings shell — and rehomes DHIS2 inside it. The shell is the surface the Phase 3 Marketplace UI (SP-4) later occupies. No marketplace backend is in scope here.

## 1. Goal

Introduce a corlix-style `/settings` shell and move every DHIS2 surface under it, removing DHIS2 from the primary sidebar. DHIS2 is a side product (a reporting target), not a main part of the app; corlix already treats it as a Settings sub-section. This change makes OpenLDR CE match that.

**Frontend-only.** No changes to `apps/server`, any package, the database, or the CLI. The DHIS2 pages, their API calls, and their backend are untouched apart from where they mount in the route tree and how they are framed.

## 2. Reference

The design source of truth is corlix's `apps/desktop/src/renderer/pages/SettingsPage.tsx`:

- A Settings shell with a left sub-nav `<aside>` (role-gated items) and a `<Outlet />` for the active sub-page.
- Sub-nav entries: General / DHIS2 / OpenLDR / Marketplace, each optionally role-gated.
- Settings is reached from the **user dropdown** at the bottom of the main sidebar (corlix `AppLayout.tsx`), not from a dedicated top-level nav icon. DHIS2 has **no** top-level nav entry in corlix.

SP-0 reproduces this pattern, seeded with DHIS2 as the only sub-section.

## 3. Current state (what changes)

- `apps/web/src/shell/AppShell.tsx` — `NAV` array includes `{ to: '/dhis2', label: 'DHIS2', icon: Network }`. The user dropdown at the bottom has only "Sign out".
- `apps/web/src/App.tsx` — seven flat DHIS2 routes (`/dhis2`, `/dhis2/orgunits`, `/dhis2/mappings`, `/dhis2/mappings/new`, `/dhis2/mappings/:id`, `/dhis2/schedules`, `/dhis2/pushes`), each wrapped in `<RequireRole role="lab_admin">`.
- Each of the 6 DHIS2 page components wraps its content in `<AppShell title="…">` and links to sibling pages with absolute `/dhis2/*` paths:
  - `Dhis2.tsx` (`title="DHIS2"`) — links to `/dhis2/mappings`, `/dhis2/orgunits`, `/dhis2/schedules`, `/dhis2/pushes`.
  - `Dhis2OrgUnits.tsx` (`title="DHIS2 OrgUnits"`).
  - `Dhis2Mappings.tsx` (`title="DHIS2 mappings"`) — `navigate('/dhis2/mappings/new')`.
  - `Dhis2MappingEditor.tsx` (`title` dynamic; loading/not-found early-returns also wrap `AppShell`) — `navigate('/dhis2/mappings')` on save and cancel.
  - `Dhis2Schedules.tsx` (`title="DHIS2 schedules"`).
  - `Dhis2Pushes.tsx` (`title="DHIS2 push history"`).

## 4. Design

### 4.1 SettingsShell component

New file `apps/web/src/pages/settings/SettingsShell.tsx`:

- Wraps `<AppShell title="Settings">` exactly once.
- Renders a left sub-nav `<aside>` (≈`w-52`, right border) of `NavLink`s built from a `SUB_NAV` array, followed by a scrollable content pane containing `<Outlet />`.
- `SUB_NAV` is role-filtered against the current user's roles (from `useAuth()`); an item with no `roles` is visible to everyone.

```ts
interface SubNavItem { labelKey: string; to: string; roles?: string[] }
const SUB_NAV: SubNavItem[] = [
  { labelKey: 'settings.subNav.dhis2', to: '/settings/dhis2', roles: ['lab_admin'] },
];
```

Active-link styling matches the existing sidebar idiom (active = `bg-accent`/`text-primary`-style classes per current `AppShell` `NavLink`s and corlix). Adding a future section (General, Marketplace) is one `SUB_NAV` entry plus one nested `<Route>` — no other plumbing.

### 4.2 Routing (App.tsx)

Convert the flat DHIS2 routes into nested children of a `/settings` layout route:

```
<Route path="/settings" element={<SettingsShell />}>
  <Route index element={<Navigate to="dhis2" replace />} />
  <Route path="dhis2" element={<RequireRole role="lab_admin"><Dhis2 /></RequireRole>} />
  <Route path="dhis2/orgunits" element={<RequireRole role="lab_admin"><Dhis2OrgUnits /></RequireRole>} />
  <Route path="dhis2/mappings" element={<RequireRole role="lab_admin"><Dhis2Mappings /></RequireRole>} />
  <Route path="dhis2/mappings/new" element={<RequireRole role="lab_admin"><Dhis2MappingEditor /></RequireRole>} />
  <Route path="dhis2/mappings/:id" element={<RequireRole role="lab_admin"><Dhis2MappingEditor /></RequireRole>} />
  <Route path="dhis2/schedules" element={<RequireRole role="lab_admin"><Dhis2Schedules /></RequireRole>} />
  <Route path="dhis2/pushes" element={<RequireRole role="lab_admin"><Dhis2Pushes /></RequireRole>} />
</Route>
```

`RequireRole` stays on each sub-route as defense in depth; `SUB_NAV.roles` only governs link visibility.

**Back-compat redirect.** A tiny `Dhis2Redirect` component preserves old links (e2e specs, docs, bookmarks):

```tsx
function Dhis2Redirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={pathname.replace(/^\/dhis2/, '/settings/dhis2') + search} replace />;
}
// <Route path="/dhis2/*" element={<Dhis2Redirect />} />
```

### 4.3 DHIS2 page changes (the 6 pages)

Each page is converted from a full page to an Outlet child:

- Remove the `<AppShell title="…">…</AppShell>` wrapper; return the inner content directly.
- Add a small in-content section heading at the top of the content (an `<h1 className="…">`) using the page's existing i18n title string where one exists, or a new `dhis2.*` key where the title was a literal (e.g. the current literal `title="DHIS2"` / `"DHIS2 OrgUnits"` / `"DHIS2 mappings"` / `"DHIS2 schedules"` / `"DHIS2 push history"` become headings; `Dhis2MappingEditor` reuses `dhis2.mappings.editor.newTitle`/`editTitle`).
- In `Dhis2MappingEditor.tsx`, the loading and not-found early-returns return a plain `<div className="p-6 …">` instead of an `AppShell`-wrapped one.
- Rewrite all sibling navigation: `to="/dhis2/…"` and `navigate('/dhis2/…')` → `/settings/dhis2/…`.

The outer chrome (sidebar, header bar with title + theme toggle) now comes once from `SettingsShell`'s `AppShell`; the content pane scrolls within the Outlet.

### 4.4 AppShell.tsx changes

- Remove the `{ to: '/dhis2', label: 'DHIS2', end: false, icon: Network }` entry from `NAV`, and remove the now-unused `Network` import.
- Add a **Settings** item to the user `DropdownMenu` (above the Sign out item): a `Settings` (gear) lucide icon + `t('layout.settings')` label, `onClick={() => navigate('/settings')}`. This requires importing `useNavigate` and the `Settings` icon.
- The Settings dropdown item is shown only when the user has the `lab_admin` role (the single sub-section is admin-only; showing it to a user with zero visible sections would land them on an empty shell). A `// TODO` notes the future generalization: show when the user can see ≥1 `SUB_NAV` section.

### 4.5 i18n

Add to the `en` bundle in `apps/web/src/i18n/index.ts` only (fr/pt deferred to the later i18n sweep):

- `settings.title` → "Settings"
- `settings.subNav.dhis2` → "DHIS2"
- `layout.settings` → "Settings"

All existing `dhis2.*` keys are reused unchanged.

## 5. Testing

- **New** `apps/web/src/pages/settings/SettingsShell.test.tsx`: the sub-nav renders the DHIS2 link for a `lab_admin` user; it is hidden for a non-admin; the `<Outlet/>` mounts a child route's content. Follows the existing web test idiom (render within `MemoryRouter`, an auth context/provider stub).
- **Update** the 6 DHIS2 page tests: pages no longer self-wrap `AppShell`, so any assertion that depended on the `AppShell` header/title is replaced by an assertion on the new in-content heading; render harnesses mount the page inside a `MemoryRouter` (and the Settings route where needed). Existing `data-testid`/content assertions are otherwise unchanged. `Dhis2MappingEditor.test.tsx` already drives shadcn/Radix selects and stays green.
- **Update** any `AppShell` test for the new `NAV` (no DHIS2 entry) and the Settings dropdown item.
- **Update** e2e specs that navigate to `/dhis2*` to the canonical `/settings/dhis2*` paths; the redirect keeps the old paths functional, but specs assert the canonical location.

## 6. Verification

- Full gate: `pnpm turbo typecheck lint test build && pnpm depcruise`.
- E2E spot-check of the DHIS2 navigation flow (open Settings from the user dropdown → DHIS2 → mappings → editor), driven via the e2e package's Playwright against the dev server.
- Manual/visual confirmation that DHIS2 no longer appears in the primary sidebar and the Settings sub-nav persists across DHIS2 sub-pages.

## 7. Out of scope

- General and Marketplace settings sub-pages (Marketplace arrives in Phase 3 SP-4).
- Any server, package, database, or CLI change.
- i18n fr/pt translations (deferred to the overall i18n sweep).
- Resolving the Phase 3 PRD open decisions (signing/trust model, federation, monetization, artifact types, capability granularity) — those belong to SP-1.

## 8. Risks / notes

- **Test churn** across 6 page tests is the main cost; it is mechanical (route wrapping + heading assertions).
- **Title duplication:** with `AppShell title="Settings"` plus an in-content heading per sub-page, the page identity moves into the content. This matches corlix and is intentional.
- **Windows long-path** worktree cleanup gotcha applies when finishing the branch (`Remove-Item -LiteralPath "\\?\<path>" -Recurse -Force`).
