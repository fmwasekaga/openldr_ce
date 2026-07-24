import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Bleed } from '@/components/ui/bleed';
import { LoadingState } from '@/components/ui/spinner';
import { SettingsHeader } from './SettingsHeader';
import { getColumnPolicy, saveColumnPolicy, type ColumnPolicyTable } from '@/api';

interface PendingPiiToggle { table: string; column: string }

/** Build the editable hidden-columns map from the server's per-column `hidden` flags. */
function buildHiddenMap(rows: ColumnPolicyTable[]): Map<string, Set<string>> {
  return new Map(rows.map((r) => [r.table, new Set(r.columns.filter((c) => c.hidden).map((c) => c.name))]));
}

/**
 * Settings → Data Exposure: lets an admin choose which columns of each analytics-facing
 * table are hidden from the query/dashboard layer. Edits are local (Map<table, Set<hidden
 * column>>) until Save; un-hiding a PII column requires confirming the exposure risk first.
 * Rendered inside SettingsShell's <Outlet/>, mirroring Roles.tsx / Connectors.tsx.
 */
export function DataExposure() {
  const { t } = useTranslation();
  const [tables, setTables] = useState<ColumnPolicyTable[]>([]);
  const [hidden, setHidden] = useState<Map<string, Set<string>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [pendingPii, setPendingPii] = useState<PendingPiiToggle | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getColumnPolicy();
      setTables(rows);
      setHidden(buildHiddenMap(rows));
      setDirty(false);
    } catch (e) {
      toast.error(t('settings.dataExposure.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const applyToggle = useCallback((table: string, column: string) => {
    setHidden((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(table) ?? []);
      if (set.has(column)) set.delete(column); else set.add(column);
      next.set(table, set);
      return next;
    });
    setDirty(true);
  }, []);

  const onToggle = useCallback((table: string, column: string, pii: boolean) => {
    const currentlyHidden = hidden.get(table)?.has(column) ?? false;
    if (pii && currentlyHidden) {
      // Un-hiding a PII column exposes it to analytics — confirm the risk before applying.
      setPendingPii({ table, column });
      return;
    }
    applyToggle(table, column);
  }, [hidden, applyToggle]);

  const confirmPiiUnhide = useCallback(() => {
    if (!pendingPii) return;
    applyToggle(pendingPii.table, pendingPii.column);
    setPendingPii(null);
  }, [pendingPii, applyToggle]);

  const onSave = useCallback(async () => {
    try {
      const payload = Object.fromEntries([...hidden].map(([table, set]) => [table, [...set]]));
      await saveColumnPolicy(payload);
      toast.success(t('settings.dataExposure.savedToast'));
      setDirty(false);
    } catch (e) {
      toast.error(t('settings.dataExposure.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [hidden, t]);

  const onDiscard = useCallback(() => { void load(); }, [load]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="data-exposure-page">
      <SettingsHeader
        description={
          <span className="flex items-center gap-2">
            {t('settings.dataExposure.description')}
            {dirty && (
              <span className="shrink-0 text-xs font-medium text-amber-600" data-testid="data-exposure-unsaved">
                {t('settings.dataExposure.unsavedIndicator')}
              </span>
            )}
          </span>
        }
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                data-testid="data-exposure-menu-trigger"
                aria-label={t('settings.dataExposure.title')}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem data-testid="data-exposure-save" onSelect={() => { void onSave(); }}>
                {t('settings.dataExposure.save')}
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="data-exposure-discard" disabled={!dirty} onSelect={onDiscard}>
                {t('settings.dataExposure.discard')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {loading ? (
        <LoadingState className="flex-1" label={t('settings.dataExposure.loading')} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
          {tables.map((tbl) => (
            <div key={tbl.table} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">{tbl.label}</h2>
              <Bleed>
                <div className="divide-y divide-border border-y border-border">
                  {tbl.columns.map((col) => {
                    const isHidden = hidden.get(tbl.table)?.has(col.name) ?? false;
                    return (
                      <div key={col.name} className="flex items-center justify-between gap-4 px-4 py-2.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm">{col.name}</span>
                          {col.pii && (
                            <Badge variant="outline" className="shrink-0 border-destructive/50 text-destructive">
                              {t('settings.dataExposure.piiBadge')}
                            </Badge>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {isHidden ? t('settings.dataExposure.hidden') : t('settings.dataExposure.shown')}
                          </span>
                          <Switch
                            checked={!isHidden}
                            onCheckedChange={() => onToggle(tbl.table, col.name, col.pii)}
                            aria-label={`toggle ${col.name}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Bleed>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingPii !== null}
        onOpenChange={(o) => { if (!o) setPendingPii(null); }}
        title={t('settings.dataExposure.confirmTitle', { name: pendingPii?.column ?? '' })}
        description={t('settings.dataExposure.confirmBody', { name: pendingPii?.column ?? '' })}
        confirmLabel={t('settings.dataExposure.confirmAction')}
        destructive
        onConfirm={confirmPiiUnhide}
      />
    </div>
  );
}

export default DataExposure;
