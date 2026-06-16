import { useCallback, useEffect, useMemo, useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { listUsers, setUserStatus, USER_ROLES, type User } from '@/api';
import { UserDialog } from '@/users/UserDialog';

function sortRoles(roles: string[]): string[] {
  return [...roles].sort((a, b) => {
    const ai = USER_ROLES.indexOf(a as (typeof USER_ROLES)[number]);
    const bi = USER_ROLES.indexOf(b as (typeof USER_ROLES)[number]);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function upsertUser(rows: User[], user: User): User[] {
  const next = { ...user, roles: sortRoles(user.roles) };
  const index = rows.findIndex((row) => row.id === user.id);
  if (index === -1) return [...rows, next].sort((a, b) => a.username.localeCompare(b.username));
  const copy = [...rows];
  copy[index] = next;
  return copy;
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function StatusBadge({ status }: { status: User['status'] }) {
  return status === 'active'
    ? <Badge className="border-transparent bg-emerald-500/15 text-emerald-700">Active</Badge>
    : <Badge variant="outline" className="text-muted-foreground">Disabled</Badge>;
}

export function Users() {
  const [rows, setRows] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const users = await listUsers();
      setRows(users.map((user) => ({ ...user, roles: sortRoles(user.roles) })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = q
      ? rows.filter((user) => user.username.toLowerCase().includes(q) || (user.displayName ?? '').toLowerCase().includes(q))
      : rows;
    return matches;
  }, [rows, search]);

  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize);

  const saved = (user: User) => {
    setRows((prev) => upsertUser(prev, user));
    setActionError(null);
  };

  const toggleStatus = async (user: User) => {
    setActionError(null);
    try {
      const updated = await setUserStatus(user.id, user.status === 'active' ? 'disabled' : 'active');
      setRows((prev) => upsertUser(prev, updated));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <AppShell title="Users" fullBleed>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              placeholder="Search username or full name"
              className="h-8 w-72 text-xs"
              aria-label="Search users"
            />
            <div className="flex-1" />
            {/* CE Slice A keeps corlix's list/edit/enablement flow; reset/logout/bulk-import are intentionally deferred. */}
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              New user
            </Button>
          </div>
          {actionError ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{actionError}</div> : null}
          {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
        </div>

        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Full name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {loading ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : pageRows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{search ? 'No users match.' : 'No users yet.'}</TableCell></TableRow>
              ) : (
                pageRows.map((user) => (
                  <TableRow key={user.id} className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]" onClick={() => setEditing(user)}>
                    <TableCell className="font-medium">{user.username}</TableCell>
                    <TableCell>{user.displayName || <span className="text-muted-foreground">-</span>}</TableCell>
                    <TableCell>{user.email || <span className="text-muted-foreground">-</span>}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {user.roles.length === 0 ? <span className="text-muted-foreground">-</span> : user.roles.map((role) => <Badge key={role} variant="outline" className="whitespace-nowrap text-[10px]">{role}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell><StatusBadge status={user.status} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(user.lastLoginAt)}</TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${user.username}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(user)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { void toggleStatus(user); }}>
                            {user.status === 'active' ? 'Disable' : 'Enable'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <TablePagination
          page={page}
          pageSize={pageSize}
          total={filtered.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          leftSlot={<span className="text-muted-foreground">{filtered.length} users</span>}
        />

        <UserDialog open={createOpen} onOpenChange={setCreateOpen} user={null} onSaved={saved} />
        <UserDialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }} user={editing} onSaved={saved} />
      </div>
    </AppShell>
  );
}
