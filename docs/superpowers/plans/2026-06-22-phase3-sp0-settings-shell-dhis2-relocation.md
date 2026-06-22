# Phase 3 SP-0 — Settings Shell + DHIS2 Relocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every DHIS2 surface out of the primary sidebar into a new corlix-style `/settings` shell, leaving the shell as the future home for the Phase 3 Marketplace UI.

**Architecture:** A single `SettingsShell` layout route wraps `AppShell` (fullBleed) and renders a left sub-nav `<aside>` + `<Outlet/>`. The six existing DHIS2 pages drop their own `AppShell` wrapper and become nested children at `/settings/dhis2/*`, gaining an in-content `<h1>`. The primary sidebar loses its DHIS2 entry and gains a "Settings" item in the user dropdown. A small redirect keeps old `/dhis2/*` links working. Frontend-only — no server/package/DB/CLI changes.

**Tech Stack:** React 18, react-router-dom v6, react-i18next, shadcn/Radix UI primitives, Vitest + Testing Library, Tailwind. Spec: `docs/superpowers/specs/2026-06-22-phase3-sp0-settings-shell-dhis2-relocation-design.md`.

**Conventions:**
- Web unit tests run from repo root: `pnpm --filter @openldr/web test -- --run <path>`. Re-run a flaky `@openldr/web#test` in isolation; it passes alone.
- Test idiom: render inside `<MemoryRouter>`, mock `@/api` and `@/auth/AuthProvider` as needed, `import '@/i18n'` for real translations.
- Full gate (Task 11 only): `pnpm turbo typecheck lint test build && pnpm depcruise`.
- Commit after every task.

---

### Task 1: Add i18n keys (en bundle)

**Files:**
- Modify: `apps/web/src/i18n/index.ts`

`dhis2` is a top-level key in the `en` object (around line 123); `dhis2.orgunits`, `dhis2.mappings`, `dhis2.mappings.editor`, and `dhis2.ops` are nested objects inside it. `dhis2.title` already equals `'DHIS2'`. There is currently no `settings` or `layout` top-level key.

- [ ] **Step 1: Add the heading keys inside the existing `dhis2` sub-objects**

Inside `dhis2.orgunits` (around line 153) add:
```ts
      heading: 'DHIS2 OrgUnits',
```
Inside `dhis2.mappings` (around line 169, as a sibling of `title`) add:
```ts
      heading: 'DHIS2 mappings',
```
Inside `dhis2.ops` (around line 226) add:
```ts
      schedulesHeading: 'DHIS2 schedules',
      pushesHeading: 'DHIS2 push history',
```

- [ ] **Step 2: Add new top-level `settings` and `layout` keys**

As new top-level keys in the `en` object (e.g. directly after the closing `}` of the `dhis2` object), add:
```ts
  settings: {
    title: 'Settings',
    subNav: {
      dhis2: 'DHIS2',
    },
  },
  layout: {
    settings: 'Settings',
  },
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @openldr/web exec tsc -p tsconfig.json --noEmit`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/i18n/index.ts
git commit -m "feat(settings): i18n keys for the Settings shell + DHIS2 headings"
```

---

### Task 2: SettingsShell component

**Files:**
- Create: `apps/web/src/pages/settings/SettingsShell.tsx`
- Test: `apps/web/src/pages/settings/SettingsShell.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/web/src/pages/settings/SettingsShell.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '@/i18n';

const hasRole = vi.fn();
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: [] }, loading: false, hasRole, signOut: vi.fn() }),
}));

import { SettingsShell } from './SettingsShell';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings" element={<SettingsShell />}>
          <Route path="dhis2" element={<div>dhis2 child</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('SettingsShell', () => {
  it('renders the DHIS2 sub-nav link and the active child for a lab_admin', () => {
    hasRole.mockImplementation((r: string) => r === 'lab_admin');
    renderAt('/settings/dhis2');
    expect(screen.getByRole('link', { name: 'DHIS2' })).toHaveAttribute('href', '/settings/dhis2');
    expect(screen.getByText('dhis2 child')).toBeInTheDocument();
  });

  it('hides the DHIS2 sub-nav link for a user without the role', () => {
    hasRole.mockReturnValue(false);
    renderAt('/settings/dhis2');
    expect(screen.queryByRole('link', { name: 'DHIS2' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/web test -- --run src/pages/settings/SettingsShell.test.tsx`
Expected: FAIL — cannot resolve `./SettingsShell`.

- [ ] **Step 3: Implement `SettingsShell.tsx`**

`apps/web/src/pages/settings/SettingsShell.tsx`:
```tsx
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { useAuth } from '@/auth/AuthProvider';
import { cn } from '@/lib/cn';

interface SubNavItem {
  labelKey: string;
  to: string;
  /** Role gate — missing means visible to everyone. */
  roles?: string[];
}

const SUB_NAV: SubNavItem[] = [
  { labelKey: 'settings.subNav.dhis2', to: '/settings/dhis2', roles: ['lab_admin'] },
];

/**
 * Settings shell with a left-hand section selector, mirroring corlix's
 * SettingsPage. The active sub-page renders in the right pane via <Outlet />.
 * New sections slot in by adding one SUB_NAV entry and one nested <Route> in
 * App.tsx — no further plumbing. The Marketplace UI (Phase 3 SP-4) lands here.
 */
export function SettingsShell() {
  const { t } = useTranslation();
  const { hasRole } = useAuth();
  const visible = SUB_NAV.filter((item) => !item.roles || item.roles.some((r) => hasRole(r)));

  return (
    <AppShell title={t('settings.title')} fullBleed>
      <div className="flex h-full min-h-0">
        <aside className="w-52 shrink-0 border-r border-border">
          <nav className="flex flex-col gap-1 p-3">
            {visible.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-2 text-sm no-underline transition-colors',
                    isActive
                      ? 'bg-accent font-medium text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )
                }
              >
                {t(item.labelKey)}
              </NavLink>
            ))}
          </nav>
        </aside>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @openldr/web test -- --run src/pages/settings/SettingsShell.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/settings/SettingsShell.tsx apps/web/src/pages/settings/SettingsShell.test.tsx
git commit -m "feat(settings): corlix-style Settings shell with role-gated sub-nav"
```

---

### Task 3: Dhis2Redirect (back-compat for old /dhis2 links)

**Files:**
- Create: `apps/web/src/pages/settings/Dhis2Redirect.tsx`
- Test: `apps/web/src/pages/settings/Dhis2Redirect.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/web/src/pages/settings/Dhis2Redirect.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Dhis2Redirect } from './Dhis2Redirect';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dhis2/*" element={<Dhis2Redirect />} />
        <Route path="/settings/dhis2" element={<div>settings dhis2 home</div>} />
        <Route path="/settings/dhis2/mappings" element={<div>settings dhis2 mappings</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Dhis2Redirect', () => {
  it('redirects /dhis2 to /settings/dhis2', () => {
    renderAt('/dhis2');
    expect(screen.getByText('settings dhis2 home')).toBeInTheDocument();
  });

  it('preserves the sub-path: /dhis2/mappings -> /settings/dhis2/mappings', () => {
    renderAt('/dhis2/mappings');
    expect(screen.getByText('settings dhis2 mappings')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openldr/web test -- --run src/pages/settings/Dhis2Redirect.test.tsx`
Expected: FAIL — cannot resolve `./Dhis2Redirect`.

- [ ] **Step 3: Implement `Dhis2Redirect.tsx`**

`apps/web/src/pages/settings/Dhis2Redirect.tsx`:
```tsx
import { Navigate, useLocation } from 'react-router-dom';

/**
 * Back-compat: rewrites any legacy /dhis2/* URL to its /settings/dhis2/*
 * equivalent so old bookmarks and docs links keep working after the
 * relocation into the Settings shell.
 */
export function Dhis2Redirect() {
  const { pathname, search } = useLocation();
  const to = pathname.replace(/^\/dhis2/, '/settings/dhis2') + search;
  return <Navigate to={to} replace />;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @openldr/web test -- --run src/pages/settings/Dhis2Redirect.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/settings/Dhis2Redirect.tsx apps/web/src/pages/settings/Dhis2Redirect.test.tsx
git commit -m "feat(settings): Dhis2Redirect for legacy /dhis2 paths"
```

---

### Task 4: Convert Dhis2.tsx to an Outlet child

**Files:**
- Modify: `apps/web/src/pages/Dhis2.tsx`

The page currently returns `<AppShell title="DHIS2"><div … data-testid="dhis2-page">…</div></AppShell>`. Remove the shell wrapper, make the content `<div>` the root, add an `<h1>` as its first child, and rewrite the four internal links.

- [ ] **Step 1: Remove the AppShell import**

Delete line 5: `import { AppShell } from '@/shell/AppShell';`
(Keep the `Network` import on line 2 — it is used by the Connection card header.)

- [ ] **Step 2: Replace the wrapper and add the heading**

Replace the opening (line 36):
```tsx
    <AppShell title="DHIS2">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4" data-testid="dhis2-page">
```
with:
```tsx
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4" data-testid="dhis2-page">
      <h1 className="text-lg font-semibold">{t('dhis2.title')}</h1>
```
Replace the closing (line 135):
```tsx
      </div>
    </AppShell>
```
with:
```tsx
    </div>
```
(Adjust the surrounding indentation so the file stays consistent; the JSX nesting is otherwise unchanged.)

- [ ] **Step 3: Rewrite the internal links**

Change these four `to=` values:
- `to="/dhis2/mappings"` → `to="/settings/dhis2/mappings"` (line 98)
- `to="/dhis2/orgunits"` → `to="/settings/dhis2/orgunits"` (line 102)
- `to="/dhis2/schedules"` → `to="/settings/dhis2/schedules"` (line 106)
- `to="/dhis2/pushes"` → `to="/settings/dhis2/pushes"` (line 110)

- [ ] **Step 4: Run the page test**

Run: `pnpm --filter @openldr/web test -- --run src/pages/Dhis2.test.tsx`
Expected: PASS. (The test asserts on `data-testid`/content, not the AppShell title, so it stays green. If it fails on a removed-title assertion, update that assertion to query the new `<h1>` text `DHIS2`.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/Dhis2.tsx
git commit -m "refactor(dhis2): Dhis2 page renders as a Settings Outlet child"
```

---

### Task 5: Convert Dhis2OrgUnits.tsx

**Files:**
- Modify: `apps/web/src/pages/Dhis2OrgUnits.tsx`

- [ ] **Step 1: Remove the AppShell import**

Delete line 3: `import { AppShell } from '@/shell/AppShell';`

- [ ] **Step 2: Replace the wrapper and add the heading**

Replace (lines 40–41):
```tsx
    <AppShell title="DHIS2 OrgUnits">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="dhis2-orgunits-page">
```
with:
```tsx
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="dhis2-orgunits-page">
      <h1 className="text-lg font-semibold">{t('dhis2.orgunits.heading')}</h1>
```
Replace the closing (lines 96–97):
```tsx
      </div>
    </AppShell>
```
with:
```tsx
    </div>
```

- [ ] **Step 3: Run the page test**

Run: `pnpm --filter @openldr/web test -- --run src/pages/Dhis2OrgUnits.test.tsx`
Expected: PASS. (If a removed-title assertion fails, repoint it to the `<h1>` text `DHIS2 OrgUnits`.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/Dhis2OrgUnits.tsx
git commit -m "refactor(dhis2): OrgUnits page renders as a Settings Outlet child"
```

---

### Task 6: Convert Dhis2Mappings.tsx

**Files:**
- Modify: `apps/web/src/pages/Dhis2Mappings.tsx`

- [ ] **Step 1: Remove the AppShell import**

Delete line 4: `import { AppShell } from '@/shell/AppShell';`

- [ ] **Step 2: Replace the wrapper and add the heading**

Replace (lines 48–49):
```tsx
    <AppShell title="DHIS2 mappings">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="dhis2-mappings-page">
```
with:
```tsx
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="dhis2-mappings-page">
      <h1 className="text-lg font-semibold">{t('dhis2.mappings.heading')}</h1>
```
Replace the closing (lines 119–120):
```tsx
      </div>
    </AppShell>
```
with:
```tsx
    </div>
```

- [ ] **Step 3: Rewrite internal navigation**

- Line 52: `navigate('/dhis2/mappings/new')` → `navigate('/settings/dhis2/mappings/new')`
- Line 77: `to={`/dhis2/mappings/${m.id}`}` → `to={`/settings/dhis2/mappings/${m.id}`}`

- [ ] **Step 4: Run the page test**

Run: `pnpm --filter @openldr/web test -- --run src/pages/Dhis2Mappings.test.tsx`
Expected: PASS. (If a removed-title assertion fails, repoint it to the `<h1>` text `DHIS2 mappings`. Note the existing muted subtitle uses `dhis2.mappings.title` — unchanged.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/Dhis2Mappings.tsx
git commit -m "refactor(dhis2): Mappings list renders as a Settings Outlet child"
```

---

### Task 7: Convert Dhis2MappingEditor.tsx

**Files:**
- Modify: `apps/web/src/pages/Dhis2MappingEditor.tsx`

This page has two early-return `AppShell` wrappers plus the main return, and two `navigate('/dhis2/mappings')` calls.

- [ ] **Step 1: Remove the AppShell import**

Delete line 4: `import { AppShell } from '@/shell/AppShell';`

- [ ] **Step 2: Convert the loading / not-found early returns**

Replace line 159:
```tsx
  if (loading) return <AppShell title="DHIS2 mapping"><div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div></AppShell>;
```
with:
```tsx
  if (loading) return <div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div>;
```
Replace line 160:
```tsx
  if (notFound) return <AppShell title="DHIS2 mapping"><div className="p-6 text-sm text-muted-foreground">{t('dhis2.mappings.editor.notFound')}</div></AppShell>;
```
with:
```tsx
  if (notFound) return <div className="p-6 text-sm text-muted-foreground">{t('dhis2.mappings.editor.notFound')}</div>;
```

- [ ] **Step 3: Convert the main return wrapper and add the heading**

Replace (lines 163–164):
```tsx
    <AppShell title={isNew ? t('dhis2.mappings.editor.newTitle') : t('dhis2.mappings.editor.editTitle')}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4" data-testid="dhis2-mapping-editor">
```
with:
```tsx
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4" data-testid="dhis2-mapping-editor">
      <h1 className="text-lg font-semibold">{isNew ? t('dhis2.mappings.editor.newTitle') : t('dhis2.mappings.editor.editTitle')}</h1>
```
Replace the closing (lines 315–316):
```tsx
      </div>
    </AppShell>
```
with:
```tsx
    </div>
```

- [ ] **Step 4: Rewrite the save/cancel navigation**

- Line 155 (in `save`): `navigate('/dhis2/mappings')` → `navigate('/settings/dhis2/mappings')`
- Line 313 (cancel button): `navigate('/dhis2/mappings')` → `navigate('/settings/dhis2/mappings')`

- [ ] **Step 5: Run the page test**

Run: `pnpm --filter @openldr/web test -- --run src/pages/Dhis2MappingEditor.test.tsx`
Expected: PASS. (Tests drive shadcn/Radix selects via the `pick()` helper and assert on `data-testid`/content, not the AppShell title.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/Dhis2MappingEditor.tsx
git commit -m "refactor(dhis2): mapping editor renders as a Settings Outlet child"
```

---

### Task 8: Convert Dhis2Schedules.tsx

**Files:**
- Modify: `apps/web/src/pages/Dhis2Schedules.tsx`

- [ ] **Step 1: Remove the AppShell import**

Delete line 3: `import { AppShell } from '@/shell/AppShell';`

- [ ] **Step 2: Replace the wrapper and add the heading**

Replace (lines 44–45):
```tsx
    <AppShell title="DHIS2 schedules">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="dhis2-schedules-page">
```
with:
```tsx
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="dhis2-schedules-page">
      <h1 className="text-lg font-semibold">{t('dhis2.ops.schedulesHeading')}</h1>
```
Replace the closing (lines 104–105):
```tsx
      </div>
    </AppShell>
```
with:
```tsx
    </div>
```

- [ ] **Step 3: Run the page test**

Run: `pnpm --filter @openldr/web test -- --run src/pages/Dhis2Schedules.test.tsx`
Expected: PASS. (If a removed-title assertion fails, repoint it to the `<h1>` text `DHIS2 schedules`.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/Dhis2Schedules.tsx
git commit -m "refactor(dhis2): schedules page renders as a Settings Outlet child"
```

---

### Task 9: Convert Dhis2Pushes.tsx

**Files:**
- Modify: `apps/web/src/pages/Dhis2Pushes.tsx`

- [ ] **Step 1: Remove the AppShell import**

Delete line 3: `import { AppShell } from '@/shell/AppShell';`

- [ ] **Step 2: Replace the wrapper and add the heading**

Replace (lines 14–15):
```tsx
    <AppShell title="DHIS2 push history">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="dhis2-pushes-page">
```
with:
```tsx
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="dhis2-pushes-page">
      <h1 className="text-lg font-semibold">{t('dhis2.ops.pushesHeading')}</h1>
```
Replace the closing (lines 40–41):
```tsx
      </div>
    </AppShell>
```
with:
```tsx
    </div>
```

- [ ] **Step 3: Run the page test**

Run: `pnpm --filter @openldr/web test -- --run src/pages/Dhis2Pushes.test.tsx`
Expected: PASS. (If a removed-title assertion fails, repoint it to the `<h1>` text `DHIS2 push history`.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/Dhis2Pushes.tsx
git commit -m "refactor(dhis2): push history renders as a Settings Outlet child"
```

---

### Task 10: Rewire routes in App.tsx

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Add the new imports**

After the existing DHIS2 page imports (lines 10–15), add:
```tsx
import { SettingsShell } from '@/pages/settings/SettingsShell';
import { Dhis2Redirect } from '@/pages/settings/Dhis2Redirect';
```
Ensure `Navigate` is imported from `react-router-dom` (change line 1 to `import { Routes, Route, Navigate } from 'react-router-dom';`).

- [ ] **Step 2: Replace the seven flat DHIS2 routes with the nested Settings route + redirect**

Delete the existing block (lines 31–37):
```tsx
      <Route path="/dhis2" element={<RequireRole role="lab_admin"><Dhis2 /></RequireRole>} />
      <Route path="/dhis2/orgunits" element={<RequireRole role="lab_admin"><Dhis2OrgUnits /></RequireRole>} />
      <Route path="/dhis2/mappings" element={<RequireRole role="lab_admin"><Dhis2Mappings /></RequireRole>} />
      <Route path="/dhis2/mappings/new" element={<RequireRole role="lab_admin"><Dhis2MappingEditor /></RequireRole>} />
      <Route path="/dhis2/mappings/:id" element={<RequireRole role="lab_admin"><Dhis2MappingEditor /></RequireRole>} />
      <Route path="/dhis2/schedules" element={<RequireRole role="lab_admin"><Dhis2Schedules /></RequireRole>} />
      <Route path="/dhis2/pushes" element={<RequireRole role="lab_admin"><Dhis2Pushes /></RequireRole>} />
```
and replace with:
```tsx
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
      <Route path="/dhis2/*" element={<Dhis2Redirect />} />
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @openldr/web exec tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 3: Run the full web test suite**

Run: `pnpm --filter @openldr/web test -- --run`
Expected: PASS (all files). The DHIS2 page tests render their components directly, independent of routing.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(settings): nest DHIS2 routes under /settings + legacy redirect"
```

---

### Task 11: Update the primary sidebar (AppShell.tsx)

**Files:**
- Modify: `apps/web/src/shell/AppShell.tsx`
- Test: `apps/web/src/shell/AppShell.test.tsx` (add a regression assertion)
- Create: `apps/web/src/shell/AppShell.settings.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/shell/AppShell.test.tsx`, inside the existing `describe('AppShell', …)` block, a regression test that DHIS2 is no longer a primary nav link:
```tsx
  it('does not show DHIS2 as a primary sidebar link', () => {
    renderShell();
    expect(screen.queryByRole('link', { name: 'DHIS2' })).not.toBeInTheDocument();
  });
```

Create `apps/web/src/shell/AppShell.settings.test.tsx` (its own file so it can mock `useAuth` without affecting the no-user tests in `AppShell.test.tsx`):
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'me', username: 'admin', displayName: null, roles: ['lab_admin'] },
    loading: false,
    hasRole: (r: string) => r === 'lab_admin',
    signOut: vi.fn(),
  }),
}));

import { AppShell } from './AppShell';

describe('AppShell settings entry', () => {
  it('navigates to /settings from the user dropdown for an admin', () => {
    render(
      <MemoryRouter>
        <AppShell title="Dashboard"><div>content</div></AppShell>
      </MemoryRouter>,
    );
    // Open the user dropdown (the avatar/user button), then click Settings.
    fireEvent.click(screen.getByText('admin'));
    fireEvent.click(screen.getByText('Settings'));
    expect(navigate).toHaveBeenCalledWith('/settings');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @openldr/web test -- --run src/shell/AppShell.test.tsx src/shell/AppShell.settings.test.tsx`
Expected: the regression test FAILS (DHIS2 link still present) and the settings test FAILS (no Settings item).

- [ ] **Step 3: Edit `AppShell.tsx` — imports**

In the `lucide-react` import (lines 4–6), remove `Network` and add `Settings`:
```tsx
import {
  LayoutDashboard, FileText, BookOpen, Library, FileInput, Users, ShieldCheck, Settings,
  ChevronLeft, ChevronRight, Sun, Moon, LogOut, type LucideIcon,
} from 'lucide-react';
```
Change the react-router import (line 2) to add `useNavigate`:
```tsx
import { NavLink, useNavigate } from 'react-router-dom';
```

- [ ] **Step 4: Edit `AppShell.tsx` — remove the DHIS2 nav entry**

In the `NAV` array, delete the line:
```tsx
  { to: '/dhis2', label: 'DHIS2', end: false, icon: Network },
```

- [ ] **Step 5: Edit `AppShell.tsx` — add navigate + the Settings dropdown item**

In the component body, after `const { user, signOut } = useAuth();` (line 39), add:
```tsx
  const { user, signOut, hasRole } = useAuth();
  const navigate = useNavigate();
```
(i.e. extend the existing destructure to include `hasRole`, and add the `navigate` line.)

In the user `DropdownMenuContent` (around lines 104–116), add a Settings item above the existing Sign out item, gated by role. Replace:
```tsx
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="mr-2 h-4 w-4" />
                {t('common.signOut')}
              </DropdownMenuItem>
```
with:
```tsx
              <DropdownMenuSeparator />
              {/* TODO(phase3): generalize to "user can see >=1 Settings sub-nav section" once
                  General/Marketplace (broader-role) sections land; for SP-0 DHIS2 is admin-only. */}
              {hasRole('lab_admin') && (
                <DropdownMenuItem onClick={() => navigate('/settings')}>
                  <Settings className="mr-2 h-4 w-4" />
                  {t('layout.settings')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="mr-2 h-4 w-4" />
                {t('common.signOut')}
              </DropdownMenuItem>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @openldr/web test -- --run src/shell/AppShell.test.tsx src/shell/AppShell.settings.test.tsx`
Expected: PASS (all tests in both files).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/shell/AppShell.tsx apps/web/src/shell/AppShell.test.tsx apps/web/src/shell/AppShell.settings.test.tsx
git commit -m "feat(settings): drop DHIS2 from sidebar, add Settings to user menu"
```

---

### Task 12: Full gate + verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate**

Run: `pnpm turbo typecheck lint test build && pnpm depcruise`
Expected: all green. If `@openldr/web#test` flakes under parallelism, re-run in isolation: `pnpm --filter @openldr/web test -- --run`.

- [ ] **Step 2: Manual / e2e spot-check (dev server)**

Start the app and confirm, via the e2e package's Playwright (a throwaway `e2e/*.mjs` driving the running dev server) or manual check:
- DHIS2 no longer appears in the primary sidebar.
- The user dropdown (bottom-left) shows "Settings" for a `lab_admin`; clicking it lands on `/settings/dhis2`.
- The Settings left sub-nav shows "DHIS2" and persists while navigating DHIS2 → Mappings → editor → Schedules → Pushes.
- Visiting a legacy `/dhis2/mappings` URL redirects to `/settings/dhis2/mappings`.

- [ ] **Step 3: Commit any fixes**

If the gate or spot-check surfaced fixes, commit them with a clear message. Otherwise, nothing to commit.

---

## Self-Review

**Spec coverage:**
- §4.1 SettingsShell (shell + role-filtered sub-nav + Outlet) → Task 2. ✓
- §4.2 nested routes + Dhis2Redirect → Tasks 3 (redirect) + 10 (routes). ✓
- §4.3 six DHIS2 pages drop AppShell, add heading, rewrite links → Tasks 4–9. ✓
- §4.4 AppShell: remove DHIS2 nav + Network import, add gated Settings dropdown item (useNavigate, Settings icon) → Task 11. ✓
- §4.5 i18n keys (settings.title, settings.subNav.dhis2, layout.settings) + page heading keys → Task 1. ✓
- §5 testing: SettingsShell test (Task 2), redirect test (Task 3), page tests (Tasks 4–9), AppShell nav/dropdown tests (Task 11). ✓
- §6 verification: full gate + e2e spot-check → Task 12. ✓
- §7 out-of-scope (General/Marketplace, backend, fr/pt) → none added. ✓

**Placeholder scan:** No TBD/TODO requirements; the single `// TODO(phase3)` is an intentional in-code forward-reference, not a plan gap. All code steps show complete code.

**Type/name consistency:** `SettingsShell`, `Dhis2Redirect`, `SUB_NAV`, `hasRole`, `useNavigate`, `Settings` icon, i18n keys (`settings.title`, `settings.subNav.dhis2`, `layout.settings`, `dhis2.title`, `dhis2.orgunits.heading`, `dhis2.mappings.heading`, `dhis2.ops.schedulesHeading`, `dhis2.ops.pushesHeading`) are used identically across the tasks that define and consume them. Route paths (`/settings/dhis2*`) match between App.tsx (Task 10), the page links (Tasks 4–9), and the redirect (Task 3).
