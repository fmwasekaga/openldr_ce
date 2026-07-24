import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/spinner';
import { TruncatedText } from '@/components/ui/truncated-text';
import { Bleed } from '@/components/ui/bleed';
import { useAuth } from '@/auth/AuthProvider';
import { listRoles, deleteRole, type RoleRecord } from '@/api';
import { RoleSheet } from '@/roles/RoleSheet';
import { SettingsHeader } from './settings/SettingsHeader';

/**
 * Settings → Roles: lists capability-based roles and hosts the create/edit sheet.
 * Rendered inside SettingsShell's <Outlet/> (mirrors General.tsx and the other settings
 * sub-pages), so no AppShell of its own here.
 */
export function Roles() {
  const { t } = useTranslation();
  const { hasCapability } = useAuth();
  const canManage = hasCapability('roles.manage');

  const [rows, setRows] = useState<RoleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRecord | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RoleRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await listRoles()); }
    catch (e) { toast.error(t('roles.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const upsert = (r: RoleRecord) => setRows((prev) => {
    const i = prev.findIndex((x) => x.id === r.id);
    if (i === -1) return [...prev, r];
    const next = [...prev]; next[i] = r; return next;
  });

  const onSaved = (r: RoleRecord) => { upsert(r); toast.success(t('roles.savedToast', { name: r.name })); };

  const doDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const r = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteRole(r.id);
      setRows((prev) => prev.filter((x) => x.id !== r.id));
      toast.success(t('roles.deletedToast', { name: r.name }));
    } catch (e) {
      toast.error(t('roles.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [pendingDelete, t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="roles-page">
      <SettingsHeader
        description={t('roles.subtitle')}
        actions={canManage ? (
          <Button size="sm" data-testid="create-role" onClick={() => setCreateOpen(true)}>{t('roles.createRole')}</Button>
        ) : undefined}
      />

      <div className="flex flex-1 flex-col overflow-auto p-4">
        <Bleed>
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>{t('roles.colName')}</TableHead>
                <TableHead>{t('roles.colDescription')}</TableHead>
                <TableHead className="w-28">{t('roles.colMembers')}</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            {!loading && rows.length > 0 && (
              <TableBody className="[&_tr:last-child]:border-b">
                {rows.map((r) => (
                  <TableRow
                    key={r.id}
                    data-testid={`role-row-${r.id}`}
                    className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                    onClick={() => setEditing(r)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <TruncatedText text={r.name} className="max-w-[16rem]" />
                        {r.isSystem && <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">{t('roles.systemBadge')}</Badge>}
                        {r.locked && <Badge variant="secondary" className="shrink-0 text-[10px]">{t('roles.lockedBadge')}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[24rem] text-muted-foreground">
                      {r.description ? <TruncatedText text={r.description} className="max-w-[24rem]" /> : <span>-</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{t('roles.memberCount', { count: r.memberCount })}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {canManage ? (
                        <div className="flex items-center justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" data-testid={`role-actions-${r.id}`} aria-label={t('roles.actionsFor', { name: r.name })}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem data-testid={`role-edit-${r.id}`} onClick={() => setEditing(r)}>{t('roles.edit')}</DropdownMenuItem>
                              <DropdownMenuItem
                                data-testid={`role-delete-${r.id}`}
                                disabled={r.isSystem || r.locked}
                                className="text-destructive focus:text-destructive"
                                onClick={() => { if (!r.isSystem && !r.locked) setPendingDelete(r); }}
                              >
                                {t('roles.delete')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            )}
          </Table>
        </Bleed>
        {loading && <LoadingState className="flex-1" label={t('roles.loading')} />}
        {!loading && rows.length === 0 && (
          <EmptyState
            icon={<ShieldCheck className="h-6 w-6" />}
            title={t('roles.emptyTitle')}
            body={t('roles.emptyBody')}
            action={canManage ? <Button onClick={() => setCreateOpen(true)}>{t('roles.createRole')}</Button> : undefined}
          />
        )}
      </div>

      <RoleSheet open={createOpen} onOpenChange={setCreateOpen} role={null} onSaved={onSaved} />
      <RoleSheet open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }} role={editing} onSaved={onSaved} />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        title={t('roles.deleteTitle', { name: pendingDelete?.name ?? '' })}
        description={t('roles.deleteDescription')}
        confirmLabel={t('roles.delete')}
        destructive
        onConfirm={() => { void doDelete(); }}
      />
    </div>
  );
}

export default Roles;
