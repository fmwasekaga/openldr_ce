# SP3 — Users UI Parity + Data-Table Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring corlix's Users experience to OpenLDR — port corlix's reusable data-table (filter/sort/column-visibility/chips) into `apps/web`, rewrite the Users page on top of it (role labels, createdAt, confirm-guarded enable/disable with self-guard, inline toast), and introduce react-i18next (en) as the UI i18n foundation.

**Architecture:** A new `apps/web/src/components/data-table/` module is copied verbatim from corlix (its `../ui/*` imports resolve identically in OpenLDR; `DatePicker`/`DateRangePicker`/`Select`/`Button`/`Checkbox` prop shapes already match). `react-i18next` is initialized once with an `en` bundle. The Users page composes the toolbar + `useTableState` + `applyTableState`. `createdAt` is surfaced from the users store (the column already exists in migration 006).

**Tech Stack:** React, react-router, react-i18next, Vitest + Testing Library, Fastify (store only).

**Spec:** `docs/superpowers/specs/2026-06-19-sp3-users-ui-parity-design.md`

**Conventions:** pnpm + turbo. Web tests: `pnpm --filter @openldr/web test` (target with `-- <name>`). Users store test: `pnpm --filter @openldr/users test`. Full gate: `pnpm turbo typecheck lint test build` then `pnpm depcruise`. Commit after each task. Web tests mock the api with `vi.spyOn` and must be wrapped so `useTranslation()` resolves (import `@/i18n` for side-effect init — the default instance is global, no provider needed).

**Verified facts (use these):**
- `apps/web/src/components/ui/` already exports: `popover` (Popover/PopoverTrigger/PopoverContent), `select` (Select/SelectContent/SelectItem/SelectTrigger/SelectValue), `checkbox` (Checkbox), `button` (Button; variants outline/ghost, sizes sm/icon), `input` (Input), `date-picker` (DatePicker: `{value:string|null,onChange:(string|null)=>void,placeholder?}`), `date-range-picker` (DateRangePicker: `{value:{from,to}|null,onChange,placeholder?}`), `confirm-dialog` (ConfirmDialog: `{open,onOpenChange,title,description?,confirmLabel,destructive?,onConfirm}`), `badge`, `table`, `table-pagination`, `dropdown-menu`, `tooltip`, `separator`, `sheet`.
- corlix data-table dir layout (`components/data-table/` importing `../ui/*`) is identical to OpenLDR's, so copied files need **no import edits**.
- users table already has `created_at` (migration `006_users.ts`).
- `useAuth()` from `@/auth/AuthProvider` (SP1) exposes `{ user: { id, ... } | null }` for the self-guard.

---

## File Structure

- `apps/web/package.json` — add `i18next`, `react-i18next` (modify)
- `apps/web/src/i18n/index.ts` — i18n init + en bundle (create)
- `apps/web/src/i18n/i18n.test.ts` — bundle smoke test (create)
- `apps/web/src/main.tsx` — import `./i18n` (modify)
- `apps/web/src/components/data-table/{types,useTableState,applyTableState,FilterPopover,SortPopover,ColumnPickerPopover,ActiveFilterChips,DataTableToolbar,index}.ts(x)` — copied verbatim from corlix (create)
- `apps/web/src/components/data-table/applyTableState.test.ts` — copied verbatim from corlix (create)
- `apps/web/src/components/data-table/DataTableToolbar.test.tsx` — new smoke test (create)
- `packages/users/src/store.ts` — surface `createdAt` (modify)
- `packages/users/src/store.test.ts` — assert createdAt (modify/create — see Task 4)
- `apps/web/src/api.ts` — add `createdAt` to web `User` (modify)
- `apps/web/src/pages/Users.tsx` — rewrite on the data-table (modify)
- `apps/web/src/pages/Users.test.tsx` — new page tests (create)
- `apps/web/src/users/UserDialog.tsx` — corlix edge-to-edge polish + i18n strings (modify)

---

## Task 1: i18n foundation (react-i18next + en bundle)

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/i18n/index.ts`
- Create: `apps/web/src/i18n/i18n.test.ts`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: Add deps**

Edit `apps/web/package.json` `dependencies` to add:
```json
    "i18next": "^23.16.8",
    "react-i18next": "^15.1.3",
```
Run: `pnpm install`
Expected: both resolve.

- [ ] **Step 2: Write the failing bundle test** — create `apps/web/src/i18n/i18n.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import i18n from './index';

describe('i18n', () => {
  it('initializes with en and resolves table + users keys', () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.t('table.filter')).toBe('Filter');
    expect(i18n.t('table.operators.like')).toBe('Contains');
    expect(i18n.t('users.roleNames.lab_admin')).toBe('Lab Admin');
    expect(i18n.t('users.count', { count: 3 })).toBe('3 users');
  });
  it('falls back to the raw role for an unknown role key', () => {
    expect(i18n.t('users.roleNames.custom_role', { defaultValue: 'custom_role' })).toBe('custom_role');
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** (module missing)

Run: `pnpm --filter @openldr/web test -- i18n`
Expected: FAIL.

- [ ] **Step 4: Implement** — create `apps/web/src/i18n/index.ts`:

```ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const en = {
  common: {
    delete: 'Delete',
    save: 'Save',
    cancel: 'Cancel',
    create: 'Create',
    loading: 'Loading…',
  },
  table: {
    filter: 'Filter',
    sort: 'Sort',
    columns: 'Columns',
    reset: 'Reset',
    resetToDefaults: 'Reset to defaults',
    where: 'Where',
    and: 'AND',
    or: 'OR',
    apply: 'Apply',
    clear: 'Clear',
    clearAll: 'Clear all',
    addFilter: 'Add filter',
    addSort: 'Add sort',
    noFilters: 'No filters applied.',
    noSorts: 'No sorts applied.',
    allColumnsSorted: 'All columns sorted.',
    ascending: 'Ascending',
    descending: 'Descending',
    asc: 'Asc',
    desc: 'Desc',
    pickRange: 'Pick range',
    pickDate: 'Pick date',
    pickValue: 'Pick value',
    from: 'From',
    to: 'To',
    commaSeparated: 'Comma-separated',
    enterValue: 'Enter value',
    operators: {
      eq: 'Equals',
      ne: 'Not equals',
      like: 'Contains',
      gt: 'Greater than',
      gte: 'At least',
      lt: 'Less than',
      lte: 'At most',
      between: 'Between',
      in: 'In list',
      is_null: 'Is empty',
      is_not_null: 'Is not empty',
    },
  },
  users: {
    searchPlaceholder: 'Search username or full name',
    username: 'Username',
    fullName: 'Full name',
    email: 'Email',
    roles: 'Roles',
    status: 'Status',
    created: 'Created',
    lastLogin: 'Last login',
    statusActive: 'Active',
    statusDisabled: 'Disabled',
    count: '{{count}} users',
    newUser: 'New user',
    refresh: 'Refresh',
    edit: 'Edit',
    disable: 'Disable',
    enable: 'Enable',
    selfSuffix: 'you',
    noUsers: 'No users yet.',
    noMatch: 'No users match.',
    savedToast: 'Saved {{username}}',
    enabledToast: 'Enabled {{username}}',
    disabledToast: 'Disabled {{username}}',
    errorToast: 'Action failed: {{error}}',
    disableTitle: 'Disable {{username}}?',
    disableDescription: 'They will no longer be able to sign in.',
    enableTitle: 'Enable {{username}}?',
    enableDescription: 'They will be able to sign in again.',
    editUserTitle: 'Edit user',
    newUserTitle: 'New user',
    editUserDesc: 'Update profile, roles, and status.',
    newUserDesc: 'Create a local operator account.',
    roleNames: {
      lab_admin: 'Lab Admin',
      lab_manager: 'Lab Manager',
      lab_technician: 'Lab Technician',
      data_analyst: 'Data Analyst',
      system_auditor: 'System Auditor',
    },
  },
};

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
```

- [ ] **Step 5: Run it — expect PASS**

Run: `pnpm --filter @openldr/web test -- i18n`
Expected: PASS (2 tests).

- [ ] **Step 6: Init in main.tsx**

In `apps/web/src/main.tsx`, add `import './i18n';` after the other imports (side-effect init, before render). No other change.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter @openldr/web typecheck` → EXIT 0
```bash
git add apps/web/package.json apps/web/src/i18n/ apps/web/src/main.tsx pnpm-lock.yaml
git commit -m "feat(web): introduce react-i18next with en bundle (table + users keys)"
```

---

## Task 2: Port data-table logic (types, state, applyTableState + test)

**Files (all created by copying verbatim from corlix; source root = `D:/Projects/Repositories/corlix/apps/desktop/src/renderer/components/data-table/`):**
- Create: `apps/web/src/components/data-table/types.ts`
- Create: `apps/web/src/components/data-table/useTableState.ts`
- Create: `apps/web/src/components/data-table/applyTableState.ts`
- Create: `apps/web/src/components/data-table/applyTableState.test.ts`

- [ ] **Step 1: Copy the four files verbatim**

Copy byte-for-byte from the corlix source to the OpenLDR dest (same filename). These files have NO `../ui/*` or i18n imports (pure TS), so they copy unchanged:
- `types.ts` → `apps/web/src/components/data-table/types.ts`
- `useTableState.ts` → `apps/web/src/components/data-table/useTableState.ts`
- `applyTableState.ts` → `apps/web/src/components/data-table/applyTableState.ts`
- `applyTableState.test.ts` → `apps/web/src/components/data-table/applyTableState.test.ts`

Read each corlix file and write its exact contents to the dest. Do not modify anything.

- [ ] **Step 2: Run the ported logic test**

Run: `pnpm --filter @openldr/web test -- applyTableState`
Expected: PASS (all ported cases). If any import path fails, STOP and report — these files should have no external imports beyond `./types`.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter @openldr/web typecheck` → EXIT 0
```bash
git add apps/web/src/components/data-table/types.ts apps/web/src/components/data-table/useTableState.ts apps/web/src/components/data-table/applyTableState.ts apps/web/src/components/data-table/applyTableState.test.ts
git commit -m "feat(web): port data-table logic (types, useTableState, applyTableState)"
```

---

## Task 3: Port data-table UI components + barrel + smoke test

**Files (copied verbatim from the same corlix source root):**
- Create: `apps/web/src/components/data-table/FilterPopover.tsx`
- Create: `apps/web/src/components/data-table/SortPopover.tsx`
- Create: `apps/web/src/components/data-table/ColumnPickerPopover.tsx`
- Create: `apps/web/src/components/data-table/ActiveFilterChips.tsx`
- Create: `apps/web/src/components/data-table/DataTableToolbar.tsx`
- Create: `apps/web/src/components/data-table/index.ts`
- Create: `apps/web/src/components/data-table/DataTableToolbar.test.tsx`

- [ ] **Step 1: Copy the six UI files verbatim**

Copy byte-for-byte from corlix to dest (same filenames): `FilterPopover.tsx`, `SortPopover.tsx`, `ColumnPickerPopover.tsx`, `ActiveFilterChips.tsx`, `DataTableToolbar.tsx`, `index.ts`. Their imports (`../ui/button`, `../ui/popover`, `../ui/select`, `../ui/checkbox`, `../ui/input`, `../ui/date-picker`, `../ui/date-range-picker`, `react-i18next`, `lucide-react`, `./types`) ALL resolve unchanged in OpenLDR. Do not modify. Every `t('...')` key these files use is already in the Task 1 en bundle.

- [ ] **Step 2: Write a toolbar smoke test** — create `apps/web/src/components/data-table/DataTableToolbar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { DataTableToolbar } from './DataTableToolbar';
import type { ColumnDef } from './types';

interface Row { name: string }
const columns: ColumnDef<Row>[] = [
  { id: 'name', labelKey: 'users.username', accessor: (r) => r.name, type: 'text', defaultVisible: true, sortable: true, filterable: true },
];

describe('DataTableToolbar', () => {
  it('renders Filter/Sort/Columns controls and a search box', () => {
    render(
      <DataTableToolbar
        columns={columns}
        filters={[]}
        onFiltersChange={() => {}}
        sorts={[]}
        onSortsChange={() => {}}
        visibleIds={['name']}
        onVisibleIdsChange={() => {}}
        onResetColumns={() => {}}
        onResetAll={() => {}}
        searchValue=""
        onSearchChange={() => {}}
        searchPlaceholder="Search"
      />,
    );
    expect(screen.getByText('Filter')).toBeTruthy();
    expect(screen.getByText('Sort')).toBeTruthy();
    expect(screen.getByText('Columns')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search')).toBeTruthy();
  });

  it('fires search changes', () => {
    const onSearchChange = vi.fn();
    render(
      <DataTableToolbar columns={columns} filters={[]} onFiltersChange={() => {}} sorts={[]} onSortsChange={() => {}} visibleIds={['name']} onVisibleIdsChange={() => {}} onResetColumns={() => {}} onResetAll={() => {}} searchValue="" onSearchChange={onSearchChange} searchPlaceholder="Search" />,
    );
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'ab' } });
    expect(onSearchChange).toHaveBeenCalledWith('ab');
  });
});
```

- [ ] **Step 3: Run it — expect PASS**

Run: `pnpm --filter @openldr/web test -- DataTableToolbar`
Expected: PASS (2 tests). If a `../ui/*` import fails to resolve, STOP and report which primitive is missing (per the verified-facts list, all should exist).

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm --filter @openldr/web typecheck` → EXIT 0
```bash
git add apps/web/src/components/data-table/
git commit -m "feat(web): port data-table UI (filter/sort/columns/chips/toolbar)"
```

---

## Task 4: Surface `createdAt` from the users store

**Files:**
- Modify: `packages/users/src/store.ts`
- Modify: `packages/users/src/store.test.ts` (or create if absent)
- Modify: `apps/web/src/api.ts`

- [ ] **Step 1: Write/extend the failing store test**

In `packages/users/src/store.test.ts` (read it first; if it does not exist, create it following the package's existing pg-mem/test pattern — check a sibling package test for the harness), add an assertion that a created user exposes a non-null `createdAt` ISO string. Minimal addition to an existing create test:
```ts
    expect(typeof created.createdAt).toBe('string');
    expect(Number.isNaN(Date.parse(created.createdAt!))).toBe(false);
```
If no store test exists, add one that creates a user via the store and asserts `createdAt` is a parseable ISO string. (Use the package's existing DB test setup; do not invent a new harness.)

- [ ] **Step 2: Run it — expect FAIL** (createdAt undefined)

Run: `pnpm --filter @openldr/users test`
Expected: FAIL on the createdAt assertion.

- [ ] **Step 3: Surface the column** in `packages/users/src/store.ts`:

1. Add to the `User` interface (after `status` / near `lastLoginAt`):
```ts
  createdAt: string | null;
```
2. Add `'created_at'` to the `COLS` array.
3. Add to the `Row` interface:
```ts
  created_at: Date | null;
```
4. In `toUser(r)`, add:
```ts
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : (r.created_at as string | null),
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @openldr/users test`
Expected: PASS.

- [ ] **Step 5: Mirror on the web type**

In `apps/web/src/api.ts`, add `createdAt: string | null;` to the web `User` interface (near `lastLoginAt`). `/api/users` returns the store shape, so no route change is needed.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @openldr/users typecheck` and `pnpm --filter @openldr/web typecheck` → EXIT 0
```bash
git add packages/users/src/store.ts packages/users/src/store.test.ts apps/web/src/api.ts
git commit -m "feat(users): surface createdAt on the User store + web type"
```

---

## Task 5: Rewrite the Users page on the data-table

**Files:**
- Modify: `apps/web/src/pages/Users.tsx`
- Create: `apps/web/src/pages/Users.test.tsx`

- [ ] **Step 1: Write the failing page tests** — create `apps/web/src/pages/Users.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listUsers: vi.fn(), setUserStatus: vi.fn() };
});
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasRole: () => true }) }));
import { listUsers, setUserStatus, type User } from '@/api';
import { Users } from './Users';

const rows: User[] = [
  { id: 'me', subject: null, username: 'me', displayName: 'Me', email: 'me@x', roles: ['lab_admin'], status: 'active', lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'u2', subject: null, username: 'bob', displayName: 'Bob', email: 'bob@x', roles: ['lab_technician'], status: 'active', lastLoginAt: null, createdAt: '2026-01-02T00:00:00Z' },
  { id: 'u3', subject: null, username: 'old', displayName: 'Old', email: 'old@x', roles: [], status: 'disabled', lastLoginAt: null, createdAt: '2026-01-03T00:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  (listUsers as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
});

describe('Users page', () => {
  it('lists active users by default (disabled hidden) with friendly role labels', async () => {
    render(<Users />);
    await waitFor(() => expect(screen.getByText('me')).toBeTruthy());
    expect(screen.getByText('bob')).toBeTruthy();
    expect(screen.queryByText('old')).toBeNull(); // default active-only filter
    expect(screen.getByText('Lab Admin')).toBeTruthy(); // role label, not raw lab_admin
  });

  it('disables another user behind a confirm dialog', async () => {
    (setUserStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ...rows[1], status: 'disabled' });
    render(<Users />);
    await waitFor(() => expect(screen.getByText('bob')).toBeTruthy());
    const bobRow = screen.getByText('bob').closest('tr')!;
    fireEvent.click(within(bobRow).getByLabelText(/actions/i));
    fireEvent.click(screen.getByText('Disable'));
    fireEvent.click(screen.getByRole('button', { name: 'Disable' })); // confirm
    await waitFor(() => expect(setUserStatus).toHaveBeenCalledWith('u2', 'disabled'));
  });

  it('blocks disabling your own account', async () => {
    render(<Users />);
    await waitFor(() => expect(screen.getByText('me')).toBeTruthy());
    const meRow = screen.getByText('me').closest('tr')!;
    fireEvent.click(within(meRow).getByLabelText(/actions/i));
    const item = screen.getByText('Disable').closest('[role="menuitem"]') as HTMLElement;
    expect(item.getAttribute('aria-disabled')).toBe('true');
  });
});
```

> The exact role/aria queries may need adjusting to OpenLDR's `dropdown-menu` primitive — read `apps/web/src/components/ui/dropdown-menu.tsx` and adapt the selectors so the tests assert the real behaviour (default-active filter, confirm-then-call, self-item disabled). Keep the three behaviours.

- [ ] **Step 2: Run it — expect FAIL** (page not rewritten)

Run: `pnpm --filter @openldr/web test -- Users`
Expected: FAIL.

- [ ] **Step 3: Rewrite the page** — replace `apps/web/src/pages/Users.tsx` with:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  ActiveFilterChips, DataTableToolbar, applyTableState, useTableState, type ColumnDef,
} from '@/components/data-table';
import { useAuth } from '@/auth/AuthProvider';
import { listUsers, setUserStatus, type User } from '@/api';
import { UserDialog } from '@/users/UserDialog';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function Users() {
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const [rows, setRows] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [pendingToggle, setPendingToggle] = useState<User | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await listUsers()); }
    catch (e) { setToast({ kind: 'err', text: t('users.errorToast', { error: e instanceof Error ? e.message : String(e) }) }); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 6000); return () => clearTimeout(id); }, [toast]);

  const upsert = (u: User) => setRows((prev) => { const i = prev.findIndex((r) => r.id === u.id); if (i === -1) return [...prev, u]; const c = [...prev]; c[i] = u; return c; });

  const onSaved = (u: User) => { upsert(u); setToast({ kind: 'ok', text: t('users.savedToast', { username: u.username }) }); };

  const doToggle = async () => {
    if (!pendingToggle) return;
    const u = pendingToggle;
    setPendingToggle(null);
    try {
      const updated = await setUserStatus(u.id, u.status === 'active' ? 'disabled' : 'active');
      upsert(updated);
      setToast({ kind: 'ok', text: t(updated.status === 'active' ? 'users.enabledToast' : 'users.disabledToast', { username: u.username }) });
    } catch (e) {
      setToast({ kind: 'err', text: t('users.errorToast', { error: e instanceof Error ? e.message : String(e) }) });
    }
  };

  const columns = useMemo<ColumnDef<User>[]>(() => [
    { id: 'username', labelKey: 'users.username', accessor: (u) => <span className="font-medium">{u.username}</span>, type: 'text', defaultVisible: true, sortable: true, filterable: true },
    { id: 'fullName', labelKey: 'users.fullName', accessor: (u) => u.displayName || <span className="text-muted-foreground">-</span>, type: 'text', defaultVisible: true, sortable: true, filterable: true },
    { id: 'email', labelKey: 'users.email', accessor: (u) => u.email || <span className="text-muted-foreground">-</span>, type: 'text', defaultVisible: true, sortable: true, filterable: true },
    { id: 'roles', labelKey: 'users.roles', accessor: (u) => (
        <div className="flex flex-wrap gap-1">{u.roles.length === 0 ? <span className="text-muted-foreground">-</span> : u.roles.map((r) => <Badge key={r} variant="outline" className="whitespace-nowrap text-[10px]">{t(`users.roleNames.${r}`, { defaultValue: r })}</Badge>)}</div>
      ), type: 'text', defaultVisible: true, sortable: true, filterable: true },
    { id: 'status', labelKey: 'users.status', accessor: (u) => u.status === 'active'
        ? <Badge className="border-transparent bg-emerald-500/15 text-emerald-700">{t('users.statusActive')}</Badge>
        : <Badge variant="outline" className="text-muted-foreground">{t('users.statusDisabled')}</Badge>,
      type: 'enum', enumOptions: [{ value: 'active', label: 'Active' }, { value: 'disabled', label: 'Disabled' }], defaultVisible: true, sortable: true, filterable: true, headClassName: 'w-24' },
    { id: 'createdAt', labelKey: 'users.created', accessor: (u) => <span className="text-xs text-muted-foreground">{formatDate(u.createdAt)}</span>, type: 'text', defaultVisible: false, sortable: true, filterable: false, headClassName: 'w-40' },
    { id: 'lastLogin', labelKey: 'users.lastLogin', accessor: (u) => <span className="text-xs text-muted-foreground">{formatDate(u.lastLoginAt)}</span>, type: 'text', defaultVisible: true, sortable: true, filterable: false, headClassName: 'w-40' },
    { id: '__actions', labelKey: 'common.actions', accessor: (u) => {
        const isSelf = me?.id === u.id;
        return (
          <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Actions for ${u.username}`}><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditing(u)}>{t('users.edit')}</DropdownMenuItem>
                <DropdownMenuItem disabled={isSelf} onClick={() => { if (!isSelf) setPendingToggle(u); }} className={u.status === 'active' ? 'text-destructive focus:text-destructive' : ''}>
                  {u.status === 'active' ? t('users.disable') : t('users.enable')}{isSelf ? ` (${t('users.selfSuffix')})` : ''}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      }, type: 'text', defaultVisible: true, sortable: false, filterable: false, headClassName: 'w-16' },
  ], [me?.id, t]);

  const table = useTableState({ columns, defaultPageSize: 25, defaultFilters: [{ id: '__active__', column: 'status', operator: 'eq', value: 'active', combine: 'and' }] });

  const effectiveFilters = useMemo(() => {
    if (!search.trim()) return table.filters;
    return [...table.filters, { id: '__search__', column: 'username', operator: 'like' as const, value: search.trim(), combine: 'and' as const }];
  }, [table.filters, search]);

  const valueGetters = useMemo(() => ({
    username: (u: User) => u.username,
    fullName: (u: User) => u.displayName ?? '',
    email: (u: User) => u.email ?? '',
    roles: (u: User) => u.roles.join(', '),
    status: (u: User) => u.status,
    createdAt: (u: User) => u.createdAt ?? '',
    lastLogin: (u: User) => u.lastLoginAt ?? '',
  }), []);

  const view = useMemo(() => applyTableState(rows, { filters: effectiveFilters, sorts: table.sorts, page: table.page, pageSize: table.pageSize }, columns, valueGetters), [rows, effectiveFilters, table.sorts, table.page, table.pageSize, columns, valueGetters]);

  return (
    <AppShell title="Users" fullBleed>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
          <DataTableToolbar
            columns={columns}
            filters={table.filters}
            onFiltersChange={table.setFilters}
            sorts={table.sorts}
            onSortsChange={table.setSorts}
            visibleIds={table.visibleIds}
            onVisibleIdsChange={table.setVisibleIds}
            onResetColumns={table.resetColumns}
            onResetAll={() => { table.resetAll(); setSearch(''); }}
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder={t('users.searchPlaceholder')}
            actions={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="User actions"><MoreHorizontal className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setCreateOpen(true)}>{t('users.newUser')}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { void load(); }}>{t('users.refresh')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
          <ActiveFilterChips columns={columns} filters={table.filters} onChange={table.setFilters} />
          {toast ? <div className={toast.kind === 'ok' ? 'rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700' : 'rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive'}>{toast.text}</div> : null}
        </div>

        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>{table.visibleColumns.map((c) => <TableHead key={c.id} className={c.headClassName}>{c.id === '__actions' ? '' : t(c.labelKey)}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {loading ? (
                <TableRow><TableCell colSpan={table.visibleColumns.length} className="py-8 text-center text-muted-foreground">{t('common.loading')}</TableCell></TableRow>
              ) : view.rows.length === 0 ? (
                <TableRow><TableCell colSpan={table.visibleColumns.length} className="py-8 text-center text-muted-foreground">{effectiveFilters.length > 0 ? t('users.noMatch') : t('users.noUsers')}</TableCell></TableRow>
              ) : (
                view.rows.map((u) => (
                  <TableRow key={u.id} className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]" onClick={() => setEditing(u)}>
                    {table.visibleColumns.map((c) => <TableCell key={c.id} className={c.cellClassName}>{c.accessor(u)}</TableCell>)}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <TablePagination page={table.page} pageSize={table.pageSize} total={view.total} onPageChange={table.setPage} onPageSizeChange={table.setPageSize} leftSlot={<span className="text-muted-foreground">{t('users.count', { count: view.total })}</span>} />

        <UserDialog open={createOpen} onOpenChange={setCreateOpen} user={null} onSaved={onSaved} />
        <UserDialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }} user={editing} onSaved={onSaved} />
        <ConfirmDialog
          open={pendingToggle !== null}
          onOpenChange={(o) => { if (!o) setPendingToggle(null); }}
          title={pendingToggle?.status === 'active' ? t('users.disableTitle', { username: pendingToggle?.username ?? '' }) : t('users.enableTitle', { username: pendingToggle?.username ?? '' })}
          description={pendingToggle?.status === 'active' ? t('users.disableDescription') : t('users.enableDescription')}
          confirmLabel={pendingToggle?.status === 'active' ? t('users.disable') : t('users.enable')}
          destructive={pendingToggle?.status === 'active'}
          onConfirm={() => { void doToggle(); }}
        />
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @openldr/web test -- Users`
Expected: PASS (3 tests). Adapt dropdown/aria selectors to the real `dropdown-menu` primitive if needed (keep the three asserted behaviours).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @openldr/web typecheck` → EXIT 0
```bash
git add apps/web/src/pages/Users.tsx apps/web/src/pages/Users.test.tsx
git commit -m "feat(web): rewrite Users page on the data-table (filters/sort/columns, confirm+self-guard, toast)"
```

---

## Task 6: UserDialog corlix polish + i18n strings

**Files:**
- Modify: `apps/web/src/users/UserDialog.tsx`

- [ ] **Step 1: Route titles/buttons through i18n + align to corlix sheet**

Read `apps/web/src/users/UserDialog.tsx` (it is a `Sheet` with fixed fields). Apply:
1. `import { useTranslation } from 'react-i18next';` and `const { t } = useTranslation();`.
2. Replace the hard-coded title/description/buttons:
   - title: `{isEdit ? t('users.editUserTitle') : t('users.newUserTitle')}`
   - description: `{isEdit ? t('users.editUserDesc') : t('users.newUserDesc')}`
   - footer buttons: Cancel → `t('common.cancel')`; primary → `saving ? t('common.loading') : isEdit ? t('common.save') : t('common.create')`.
3. Match corlix's edge-to-edge sheet: ensure `SheetContent` uses `className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"`, `SheetHeader` uses `border-b border-border px-6 py-4`, the body is `min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5`, and `SheetFooter` uses `border-t border-border px-6 py-4 sm:justify-end`. (Most of this already matches — only adjust what differs.)

Do NOT change the fields, roles editor, status checkbox, or save logic. No schema-driven form.

- [ ] **Step 2: Verify existing UserDialog behaviour still works**

Run: `pnpm --filter @openldr/web test` (the existing suite, including any UserDialog/Users tests)
Expected: all pass. If there is a `UserDialog` test asserting old hard-coded strings, update those assertions to the i18n English values.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter @openldr/web typecheck` → EXIT 0
```bash
git add apps/web/src/users/UserDialog.tsx
git commit -m "feat(web): UserDialog corlix edge-to-edge polish + i18n strings"
```

---

## Task 7: Full gate + final review

- [ ] **Step 1: Full gate**

Run: `pnpm turbo typecheck lint test build`
Expected: all PASS.

- [ ] **Step 2: depcruise**

Run: `pnpm depcruise`
Expected: no violations (the data-table module imports only `@/components/ui/*`, `react-i18next`, `lucide-react`, `./*`; Users imports the data-table + auth + api).

- [ ] **Step 3: Commit any fixups** (skip if clean)

```bash
git add -A
git commit -m "chore(users): SP3 full-gate fixups"
```

---

## Self-Review notes (coverage vs spec)

- Spec §1 i18n foundation → Task 1. §2 data-table port → Tasks 2 (logic) + 3 (UI). §3 Users page rewrite → Task 5. §4 role labels → en bundle (Task 1) + Task 5 column. §5 self-guard → Task 5 (`me?.id === u.id`, disabled menu item + test). §6 UserDialog polish → Task 6. §7 surface createdAt → Task 4.
- §Testing: applyTableState (Task 2, ported), toolbar smoke (Task 3), Users page filter/confirm/self-guard (Task 5), store createdAt (Task 4); tests init i18n via `import '@/i18n'`.
- §Out of scope honored: no auth actions, no bulk import, no facility columns, no schema-driven form, en-only (no fr/pt), other pages not migrated.
- §Acceptance: gate + depcruise (Task 7); the enum-filter value fix for `disabled` is called out inline in Task 5.
- Type consistency: `ColumnDef`/`FilterRule`/`useTableState`/`applyTableState`/`TableStateValueGetters` come from the ported module (Task 2/3); the web `User` gains `createdAt` (Task 4) used by the Users page (Task 5); `useAuth()` shape from SP1.
