import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  ActiveFilterChips, DataTableToolbar, useTableState, type ColumnDef, type FilterRule,
} from '@/components/data-table';
import { cn } from '@/lib/cn';
import {
  listNotifications, markNotificationsRead,
  type Notification, type NotificationListParams, type NotificationPriority, type NotificationType,
} from '@/api';

const NOTIFICATION_TYPES: NotificationType[] = [
  'sync_diverged', 'sync_failed', 'sync_quarantined',
  'plugin_crashed', 'auth_failed', 'site_revoked',
];

const PRIORITIES: NotificationPriority[] = ['info', 'warning', 'critical'];

/**
 * Translate the data-table's generic FilterRule[] into the params
 * listNotifications() understands. The API only supports unreadOnly/
 * type/priority server-side filtering — no date range, no text search,
 * no read-only filter — so the `created_at` and `title` columns are
 * marked filterable: false and `status` only offers 'unread'.
 */
function translateFilters(filters: FilterRule[]): NotificationListParams {
  const params: NotificationListParams = {};
  for (const f of filters) {
    if (f.column === 'type' && f.operator === 'eq' && typeof f.value === 'string') {
      params.type = f.value;
    } else if (f.column === 'priority' && f.operator === 'eq' && typeof f.value === 'string') {
      params.priority = f.value;
    } else if (f.column === 'status' && f.operator === 'eq' && f.value === 'unread') {
      params.unreadOnly = true;
    }
  }
  return params;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

// Studio's Badge only ships default/secondary/outline variants (no built-in
// "destructive"), so critical priority is styled via className like Audit.tsx's
// ActionBadge does for destructive audit actions.
function priorityVariant(p: NotificationPriority): 'default' | 'secondary' {
  return p === 'warning' ? 'secondary' : 'default';
}

export function Notifications() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const columns = useMemo<ColumnDef<Notification>[]>(() => [
    {
      id: 'created_at',
      labelKey: 'notifications.history.time',
      accessor: (n) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          <span className="font-mono">{formatTimestamp(n.createdAt)}</span>
          <span className="ml-2">({formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })})</span>
        </span>
      ),
      type: 'date',
      defaultVisible: true,
      filterable: false,
      sortable: false,
      headClassName: 'w-64',
    },
    {
      id: 'type',
      labelKey: 'notifications.history.type',
      accessor: (n) => t(`notifications.triggers.${n.type}`, n.type),
      type: 'enum',
      enumOptions: NOTIFICATION_TYPES.map((v) => ({ value: v, labelKey: `notifications.triggers.${v}` })),
      defaultVisible: true,
      filterable: true,
      sortable: false,
      headClassName: 'w-48',
    },
    {
      id: 'priority',
      labelKey: 'notifications.history.priority',
      accessor: (n) => (
        <Badge
          variant={priorityVariant(n.priority)}
          className={cn('capitalize', n.priority === 'critical' && 'border-transparent bg-destructive text-destructive-foreground')}
        >
          {t(`notifications.history.priority${n.priority.charAt(0).toUpperCase()}${n.priority.slice(1)}`, n.priority)}
        </Badge>
      ),
      type: 'enum',
      enumOptions: PRIORITIES.map((v) => ({
        value: v,
        labelKey: `notifications.history.priority${v.charAt(0).toUpperCase()}${v.slice(1)}`,
      })),
      defaultVisible: true,
      filterable: true,
      sortable: false,
      headClassName: 'w-32',
    },
    {
      id: 'status',
      labelKey: 'notifications.history.status',
      accessor: (n) => (
        <span className={cn('text-xs', !n.readAt && 'font-medium text-foreground')}>
          {n.readAt ? t('notifications.history.read') : t('notifications.history.unread')}
        </span>
      ),
      type: 'enum',
      enumOptions: [
        { value: 'unread', labelKey: 'notifications.history.unread' },
      ],
      defaultVisible: true,
      filterable: true,
      sortable: false,
      headClassName: 'w-24',
    },
    {
      id: 'title',
      labelKey: 'notifications.history.title',
      accessor: (n) => (
        <div className="flex flex-col">
          <span className={cn('text-sm', !n.readAt && 'font-medium')}>{n.title}</span>
          {n.body && <span className="text-xs text-muted-foreground line-clamp-1">{n.body}</span>}
        </div>
      ),
      type: 'text',
      defaultVisible: true,
      filterable: false,
      sortable: false,
    },
  ], [t]);

  const table = useTableState({ columns, defaultPageSize: 25 });

  const [rows, setRows] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listNotifications({
        ...translateFilters(table.filters),
        limit: table.pageSize,
        offset: table.page * table.pageSize,
      });
      setRows(result.notifications);
      setTotal(result.total);
    } catch (err) {
      setRows([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [table.filters, table.page, table.pageSize]);

  useEffect(() => { void load(); }, [load]);

  const handleRowClick = async (n: Notification): Promise<void> => {
    if (!n.readAt) {
      try { await markNotificationsRead([n.id]); } catch { /* best-effort; row still navigates */ }
    }
    if (n.linkTo) {
      const route = n.linkTo.startsWith('#') ? n.linkTo.slice(1) : n.linkTo;
      navigate(route);
    } else {
      void load();
    }
  };

  return (
    <AppShell title={t('notifications.title')} fullBleed>
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
            onResetAll={table.resetAll}
            actions={
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={() => void load()}
                disabled={loading}
                aria-label={t('notifications.history.refresh')}
                title={t('notifications.history.refresh')}
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </Button>
            }
          />
          <ActiveFilterChips columns={columns} filters={table.filters} onChange={table.setFilters} />
        </div>

        <div className="flex flex-1 flex-col overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                {table.visibleColumns.map((c) => (
                  <TableHead key={c.id} className={c.headClassName}>{t(c.labelKey)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            {!loading && !error && rows.length > 0 && (
              <TableBody className="[&_tr:last-child]:border-b">
                {rows.map((n) => (
                  <TableRow
                    key={n.id}
                    className={cn(
                      'cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]',
                      !n.readAt && 'bg-muted/10',
                    )}
                    onClick={() => { void handleRowClick(n); }}
                  >
                    {table.visibleColumns.map((c) => (
                      <TableCell key={c.id} className={c.cellClassName}>{c.accessor(n)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            )}
          </Table>
          {loading && <LoadingState className="flex-1" label={t('common.loading')} />}
          {!loading && error && <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>}
          {!loading && !error && rows.length === 0 && <StripedEmpty className="flex-1">{t('notifications.history.empty')}</StripedEmpty>}
        </div>

        <TablePagination
          page={table.page}
          pageSize={table.pageSize}
          total={total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          leftSlot={<span className="text-muted-foreground">{t('notifications.history.totalCount', { count: total })}</span>}
        />
      </div>
    </AppShell>
  );
}
