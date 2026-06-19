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
        const isSelf = !!me && me.id === u.id;
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
            onSearchChange={(v) => { setSearch(v); table.setPage(0); }}
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
                <TableRow><TableCell colSpan={table.visibleColumns.length} className="py-8 text-center text-muted-foreground">{rows.length === 0 ? t('users.noUsers') : t('users.noMatch')}</TableCell></TableRow>
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
