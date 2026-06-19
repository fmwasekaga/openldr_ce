# SP3 — Users Corlix-Parity UI + Data-Table Port (Design)

**Date:** 2026-06-19
**Status:** Approved (brainstorming) — ready for implementation planning
**Branch:** `feat/p2-users-ui`
**Depends on:** SP1 (auth — `useAuth()`/`req.user`, admin route guard) and SP2 (Users routes already emit audit). See prior specs in `docs/superpowers/specs/`.

## Background

The corlix Users page (`corlix/apps/desktop/src/renderer/pages/UsersPage.tsx`) is the design
source of truth. It is driven by a shared, reusable **data-table** module
(`corlix/apps/desktop/src/renderer/components/data-table/` — ~10 files: per-column filter,
multi-sort, column show/hide, active-filter chips, plus `useTableState` + `applyTableState`).

OpenLDR's current `apps/web/src/pages/Users.tsx` is a simple search + plain table with an
Edit/Disable dropdown. It has no rich table machinery, no friendly role labels, no
`createdAt`, no confirm dialog on disable, no toast feedback, and no self-action guard.

Decisions taken during brainstorming:

- **Full DataTableToolbar port** (not a lighter parity) — bring corlix's data-table module
  into OpenLDR web and drive the Users page with it.
- **Approach B (react-i18next):** the corlix data-table is coupled to `react-i18next`
  (`useTranslation()` + `labelKey`). OpenLDR web currently has NO UI-string i18n framework
  (only a docs-content locale hook, `apps/web/src/docs/useDocLocale.ts`, which is orthogonal).
  SP3 introduces `react-i18next` and ports the module verbatim with `labelKey`s, adding an
  `en` resource bundle. This advances the PRD's en/fr/pt goal.

## Goal

Match corlix's Users experience: a reusable data-table (filter/sort/column-visibility/chips)
driving the Users page, friendly role labels, a `createdAt` column, a confirm-guarded
enable/disable with a self-action guard, inline toast feedback, and a polished UserDialog —
with `react-i18next` introduced as the UI i18n foundation (en only for now).

## Scope

In scope:

1. **i18n foundation** — add `react-i18next` + `i18next`; an init module
   (`apps/web/src/i18n/index.ts`) with an `en` resource bundle; initialize in `main.tsx`.
2. **Data-table module** — port corlix's `data-table/` into `apps/web/src/components/data-table/`
   (types, `useTableState`, `applyTableState` + test, `FilterPopover`, `SortPopover`,
   `ColumnPickerPopover`, `ActiveFilterChips`, `DataTableToolbar`, `index.ts`), keeping the
   `labelKey` + `useTranslation()` design, adapted to OpenLDR's `components/ui` primitives.
3. **Users page rewrite** — `pages/Users.tsx` driven by the toolbar + `useTableState` +
   `applyTableState`. Columns: username, full name (displayName), email, roles (friendly
   labels), status, `createdAt` (default-hidden), last login. Row actions: Edit,
   Disable/Enable (ConfirmDialog + self-guard). Toolbar actions: New user, Refresh. Default
   filter: status active. Inline toast banner (corlix-style state, no library).
4. **Role labels** — `users.roleNames.<role>` i18n keys (e.g. `lab_admin → "Lab Admin"`),
   with `defaultValue` fallback to the raw role.
5. **Self-action guard** — disabling/enabling your own account is blocked (resolved via
   `useAuth().user.id` from SP1).
6. **UserDialog polish** — align the existing Sheet to corlix's edge-to-edge sections +
   separators; strings via `t()`. Fixed fields retained (username/displayName/email/roles/status).
7. **Surface `createdAt`** — small `packages/users` store change to map `created_at` onto the
   `User` type and expose via `/api/users`; mirror on the web `User` type.

Out of scope (deferred):

- Auth-owned actions: reset password, send reset email, force sign-out → **SP4** (Keycloak Admin).
- Bulk import / import template — needs a server endpoint; defer.
- Facility columns (`facilityName`/`facilityMflId`) — OpenLDR's user model has no facility fields.
- Schema-driven user form (corlix renders the user profile via a Form template) — defer.
- **fr/pt translations and migrating other pages' strings to i18n** — SP3 ships `en` only and
  i18n's just the data-table + Users surface; other pages keep their current English. The docs
  locale hook is untouched (a future effort may unify them).

## Components

### a) i18n foundation — `apps/web/src/i18n/index.ts`

- Add deps `i18next` and `react-i18next`.
- Init the default i18next instance: `i18n.use(initReactI18next).init({ resources: { en: { translation: <bundle> } }, lng: 'en', fallbackLng: 'en', interpolation: { escapeValue: false } })`.
- The `en` bundle holds `table.*` keys (operator labels, `and`/`or`, `reset`, `filter`,
  `sort`, `columns`, placeholders) and `users.*` keys (column headers, `roleNames.*`, action
  labels, toast messages, confirm-dialog titles/descriptions, dialog labels).
- Import `./i18n` once in `apps/web/src/main.tsx` (side-effect init) before rendering.
  `useTranslation()` then works app-wide via the default instance.

### b) Data-table module — `apps/web/src/components/data-table/`

Ported from corlix, verbatim where possible, with imports repointed to OpenLDR's
`@/components/ui/*` primitives (popover, select, checkbox, button, input, separator):

- `types.ts` — `ColumnDef<T>` (`labelKey`, `accessor`, `type`, `enumOptions`, `defaultVisible`,
  `sortable`, `filterable`, class names), `FilterRule`, `SortRule`, `FilterOperator`,
  `validOperators`, `FILTER_OPERATORS`, `COMBINE_OPTIONS`, `newId`.
- `useTableState.ts` — state hook (visibleIds/filters/sorts/page/pageSize + reset).
- `applyTableState.ts` (+ `applyTableState.test.ts`) — pure client-side filter/sort/paginate.
- `FilterPopover.tsx`, `SortPopover.tsx`, `ColumnPickerPopover.tsx`, `ActiveFilterChips.tsx`,
  `DataTableToolbar.tsx` — UI, using `useTranslation()`.
- `index.ts` — barrel re-exporting the public surface.

This is a generic, reusable module with no Users coupling — a second list page could adopt it.

### c) Users page — `apps/web/src/pages/Users.tsx`

Rewritten to compose the data-table:

- `columns: ColumnDef<User>[]` — username, fullName (displayName), email, roles (badges with
  `t('users.roleNames.'+r, { defaultValue: r })`), status (badge), createdAt (defaultVisible
  false), lastLogin. Plus a `__actions` column (always visible) with the row dropdown.
- `useTableState({ columns, defaultPageSize: 25, defaultFilters: [status active] })`.
- `applyTableState(rows, { filters, sorts, page, pageSize }, columns, valueGetters)` for the view.
- Debounced search over username/displayName.
- Row dropdown: Edit (opens UserDialog), Disable/Enable (opens ConfirmDialog; disabled for the
  current user via `useAuth().user?.id === row.id`).
- Toolbar `actions`: dropdown with New user + Refresh.
- Inline toast banner driven by a `toast` state `{ kind: 'ok' | 'err'; text }`, auto-dismissed.

### d) Role labels

`users/roleLabels` keys live in the i18n bundle under `users.roleNames`; the page resolves via
`t()`. No separate map module — the bundle is the source.

### e) UserDialog polish — `apps/web/src/users/UserDialog.tsx`

Keep the existing Sheet + fixed fields; adjust to corlix's edge-to-edge section layout and
route its labels through `t()`. No schema-driven form.

### f) Surface `createdAt`

- `packages/users/src/store.ts`: add `createdAt: string | null` to `User`, select `created_at`,
  map it in `toUser`.
- `apps/web/src/api.ts`: add `createdAt` to the web `User` type. `/api/users` already returns the
  store shape, so no route change is needed beyond the store surfacing the field.

## Data flow

```
/api/users (now includes createdAt)
  → web Users page loads rows
  → useTableState holds filter/sort/column/page state
  → applyTableState(rows, state, columns, valueGetters) → view rows
  → DataTableToolbar drives the state; row/toolbar actions call the api + toast
  → disable/enable → ConfirmDialog → setUserStatus → audit recorded server-side (SP2)
```

## Error handling

- API failures surface in the inline toast (`kind: 'err'`) and leave the table unchanged.
- Self-disable is blocked in the UI (the menu item is disabled with a hint); the server still
  enforces RBAC (SP1) regardless.
- `react-i18next` missing-key behaviour: `defaultValue` is supplied for dynamic keys (role
  names); static keys exist in the bundle.

## Testing

- **applyTableState** — port corlix's unit tests (filter operators, sort, pagination).
- **data-table UI** — render `DataTableToolbar`; open FilterPopover and add a rule; open
  SortPopover; toggle a column in ColumnPickerPopover; assert `ActiveFilterChips` reflects state.
- **Users page** — render with a mocked api (`vi.spyOn`): default active-only filter applied;
  search narrows rows; a column toggle hides/shows; Disable opens the confirm dialog and calls
  `setUserStatus` on confirm; the self-row's Disable item is disabled; an api error shows the
  error toast; New/Edit opens the dialog.
- Tests wrap components in the i18n instance (import `../i18n` or an `I18nextProvider` test
  helper) so `t()` resolves; assert on resolved English text.
- Vitest + RTL, `vi.spyOn` on the api module per the existing web convention.

## Boundaries

- `components/data-table/` is generic and reusable (no Users imports).
- i18n init is a single side-effect module; `useTranslation()` is the only access pattern.
- Users-specific logic (columns, role-label keys, self-guard, toast) lives in the Users page /
  `users/` dir.
- Auth context (`useAuth`) and audit (SP2) are reused, not modified.

## Acceptance

- `pnpm turbo typecheck lint test build` and `pnpm depcruise` green.
- The Users page renders via the ported data-table with working per-column filter, multi-sort,
  column show/hide, and active-filter chips; default filter shows active users.
- Roles display friendly labels; `createdAt` is an available (default-hidden) column.
- Disable/Enable is confirm-guarded and blocked for the current user; actions surface toasts.
- `react-i18next` is initialized; the data-table and Users strings resolve from the `en` bundle.
- Users mutations continue to emit audit events (SP2) with the real actor.
