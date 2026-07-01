import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Bleed } from '@/components/ui/bleed';
import {
  listRegistries, createRegistry, updateRegistry, deleteRegistry,
  type MarketplaceRegistry,
} from '@/api';

interface DraftState {
  id: string | null; // null = create
  name: string;
  kind: 'local' | 'http';
  location: string;
  enabled: boolean;
}

const emptyDraft = (): DraftState => ({ id: null, name: '', kind: 'http', location: '', enabled: true });

export function RegistriesTab({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<MarketplaceRegistry[]>([]);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [pendingRemove, setPendingRemove] = useState<MarketplaceRegistry | null>(null);
  const [busy, setBusy] = useState(false);

  const err = useCallback((e: unknown) =>
    toast.error(t('settings.marketplace.registryErrorToast', { error: e instanceof Error ? e.message : String(e) })), [t]);

  const load = useCallback(async () => {
    try { setRows(await listRegistries()); }
    catch (e) { err(e); }
  }, [err]);
  useEffect(() => { void load(); }, [load]);

  const openCreate = () => setDraft(emptyDraft());
  const openEdit = (r: MarketplaceRegistry) =>
    setDraft({ id: r.id, name: r.name, kind: r.kind, location: r.location, enabled: r.enabled });

  const onSave = useCallback(async () => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      if (draft.id === null) {
        await createRegistry({ name: draft.name, kind: draft.kind, location: draft.location });
      } else {
        await updateRegistry(draft.id, { name: draft.name, kind: draft.kind, location: draft.location, enabled: draft.enabled });
      }
      setDraft(null);
      await load();
      onChanged();
    } catch (e) { err(e); }
    finally { setBusy(false); }
  }, [draft, busy, load, onChanged, err]);

  const onToggle = useCallback(async (r: MarketplaceRegistry, enabled: boolean) => {
    try { await updateRegistry(r.id, { enabled }); await load(); onChanged(); }
    catch (e) { err(e); }
  }, [load, onChanged, err]);

  const onRemove = useCallback(async () => {
    if (!pendingRemove) return;
    const r = pendingRemove;
    setPendingRemove(null);
    try { await deleteRegistry(r.id); await load(); onChanged(); }
    catch (e) { err(e); }
  }, [pendingRemove, load, onChanged, err]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="registries-tab">
      <div className="flex items-center justify-end">
        <Button data-testid="add-registry" onClick={openCreate}>
          {t('settings.marketplace.registryAddBtn')}
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">{t('settings.marketplace.noRegistries')}</div>
      ) : (
        <Bleed>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('settings.marketplace.registryName')}</TableHead>
              <TableHead>{t('settings.marketplace.registryKind')}</TableHead>
              <TableHead>{t('settings.marketplace.registryLocation')}</TableHead>
              <TableHead>{t('settings.marketplace.registryEnabled')}</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} data-testid={`registry-row-${r.id}`}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {r.kind === 'http' ? t('settings.marketplace.kindHttp') : t('settings.marketplace.kindLocal')}
                </TableCell>
                <TableCell className="text-muted-foreground">{r.location}</TableCell>
                <TableCell>
                  <span data-testid={`toggle-${r.id}`}>
                    <Switch checked={r.enabled} onCheckedChange={(v) => void onToggle(r, v)} aria-label={t('settings.marketplace.registryEnabled')} />
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="outline" size="sm" data-testid={`edit-${r.id}`} onClick={() => openEdit(r)}>
                      {t('settings.marketplace.registryEditBtn')}
                    </Button>
                    <Button variant="ghost" size="sm" data-testid={`remove-${r.id}`} onClick={() => setPendingRemove(r)}>
                      {t('settings.marketplace.registryRemoveBtn')}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </Bleed>
      )}

      <Dialog open={draft !== null} onOpenChange={(o) => { if (!o) setDraft(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>{draft?.id === null ? t('settings.marketplace.addRegistry') : t('settings.marketplace.editRegistry')}</DialogTitle>
          {draft ? (
            <div className="text-sm">
              <div className="grid grid-cols-1 gap-x-4 gap-y-3">
                <label className="grid gap-1">
                  <span className="text-muted-foreground">{t('settings.marketplace.registryName')}</span>
                  <Input data-testid="registry-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </label>
                <label className="grid gap-1">
                  <span className="text-muted-foreground">{t('settings.marketplace.registryKind')}</span>
                  <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as 'local' | 'http' })}>
                    <SelectTrigger data-testid="registry-kind"><SelectValue placeholder={t('settings.marketplace.pickKind')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="local">{t('settings.marketplace.kindLocal')}</SelectItem>
                      <SelectItem value="http">{t('settings.marketplace.kindHttp')}</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="grid gap-1">
                  <span className="text-muted-foreground">{t('settings.marketplace.registryLocation')}</span>
                  <Input data-testid="registry-location" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
                </label>
                {draft.id !== null ? (
                  <label className="flex items-center gap-2">
                    <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} aria-label={t('settings.marketplace.registryEnabled')} />
                    <span className="text-muted-foreground">{t('settings.marketplace.registryEnabled')}</span>
                  </label>
                ) : null}
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDraft(null)}>{t('settings.marketplace.registryCancel')}</Button>
                <Button data-testid="registry-save" disabled={busy || !draft.name || !draft.location} onClick={() => void onSave()}>
                  {t('settings.marketplace.registrySave')}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(o) => { if (!o) setPendingRemove(null); }}
        title={t('settings.marketplace.removeRegistryTitle', { name: pendingRemove?.name ?? '' })}
        description={t('settings.marketplace.removeRegistryDescription')}
        confirmLabel={t('settings.marketplace.registryRemoveBtn')}
        destructive
        onConfirm={() => { void onRemove(); }}
      />
    </div>
  );
}
