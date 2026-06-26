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
import {
  listConnectors, listSinkPlugins, createConnector, updateConnector, deleteConnector, testConnector,
  type Connector, type SinkPluginRef,
} from '@/api';

interface DraftState {
  id: string | null; // null = create
  name: string;
  pluginId: string;
  baseUrl: string;
  username: string;
  password: string; // blank on edit = keep existing
  enabled: boolean;
}

const emptyDraft = (): DraftState => ({ id: null, name: '', pluginId: '', baseUrl: '', username: '', password: '', enabled: true });

export function Connectors() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Connector[]>([]);
  const [plugins, setPlugins] = useState<SinkPluginRef[]>([]);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Connector | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cs, ps] = await Promise.all([listConnectors(), listSinkPlugins()]);
      setRows(cs); setPlugins(ps);
    } catch (e) {
      toast.error(t('settings.connectors.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const openCreate = () => setDraft(emptyDraft());
  const openEdit = (c: Connector) =>
    setDraft({ id: c.id, name: c.name, pluginId: c.pluginId, baseUrl: '', username: '', password: '', enabled: c.enabled });

  const onSave = useCallback(async () => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      const anyFilled = Boolean(draft.baseUrl || draft.username || draft.password);
      const allFilled = Boolean(draft.baseUrl && draft.username && draft.password);
      // Connection fields go all-or-nothing: the server replaces the whole encrypted
      // config blob, and secrets can't be read back to pre-fill, so a partial re-entry
      // would silently wipe the fields left blank.
      if (draft.id === null ? !allFilled : (anyFilled && !allFilled)) {
        toast.error(t('settings.connectors.partialSecrets'));
        return;
      }
      const config: Record<string, string> = allFilled
        ? { baseUrl: draft.baseUrl, username: draft.username, password: draft.password }
        : {};
      if (draft.id === null) {
        await createConnector({ name: draft.name, pluginId: draft.pluginId, config });
      } else {
        await updateConnector(draft.id, { name: draft.name, enabled: draft.enabled, ...(allFilled ? { config } : {}) });
      }
      toast.success(t('settings.connectors.savedToast', { name: draft.name }));
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(t('settings.connectors.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }, [draft, busy, t, load]);

  const onToggle = useCallback(async (c: Connector, enabled: boolean) => {
    try { await updateConnector(c.id, { enabled }); await load(); }
    catch (e) { toast.error(t('settings.connectors.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [t, load]);

  const onTest = useCallback(async (c: Connector) => {
    setTesting(c.id);
    setTestResult((r) => ({ ...r, [c.id]: t('settings.connectors.testing') }));
    try {
      const res = await testConnector(c.id);
      setTestResult((r) => ({
        ...r,
        [c.id]: res.ok
          ? t('settings.connectors.testOk', { dataElements: res.metadata.dataElements, orgUnits: res.metadata.orgUnits })
          : t('settings.connectors.testFailed', { error: res.error }),
      }));
    } catch (e) {
      setTestResult((r) => ({ ...r, [c.id]: t('settings.connectors.testFailed', { error: e instanceof Error ? e.message : String(e) }) }));
    } finally {
      setTesting(null);
    }
  }, [t]);

  const onRemove = useCallback(async () => {
    if (!pendingRemove) return;
    const c = pendingRemove;
    setPendingRemove(null);
    try { await deleteConnector(c.id); toast.success(t('settings.connectors.removedToast', { name: c.name })); await load(); }
    catch (e) { toast.error(t('settings.connectors.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [pendingRemove, t, load]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" data-testid="connectors-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{t('settings.connectors.heading')}</h1>
          <p className="text-sm text-muted-foreground">{t('settings.connectors.description')}</p>
        </div>
        <Button data-testid="add-connector" onClick={openCreate} disabled={plugins.length === 0}>
          {t('settings.connectors.add')}
        </Button>
      </div>

      {plugins.length === 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
          {t('settings.connectors.noPlugins')}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">{t('settings.connectors.empty')}</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('settings.connectors.colName')}</TableHead>
              <TableHead>{t('settings.connectors.colPlugin')}</TableHead>
              <TableHead>{t('settings.connectors.colHost')}</TableHead>
              <TableHead>{t('settings.connectors.colEnabled')}</TableHead>
              <TableHead className="text-right">{t('settings.connectors.colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id} data-testid={`connector-row-${c.id}`}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-muted-foreground">{c.pluginId}</TableCell>
                <TableCell className="text-muted-foreground">{c.allowedHost ?? '—'}</TableCell>
                <TableCell>
                  <Switch checked={c.enabled} onCheckedChange={(v) => void onToggle(c, v)} aria-label={t('settings.connectors.enabledLabel')} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="outline" size="sm" data-testid={`test-${c.id}`} disabled={testing === c.id} onClick={() => void onTest(c)}>
                      {t('settings.connectors.test')}
                    </Button>
                    <Button variant="outline" size="sm" data-testid={`edit-${c.id}`} onClick={() => openEdit(c)}>
                      {t('settings.connectors.edit')}
                    </Button>
                    <Button variant="ghost" size="sm" data-testid={`remove-${c.id}`} onClick={() => setPendingRemove(c)}>
                      {t('settings.connectors.remove')}
                    </Button>
                  </div>
                  {testResult[c.id] ? (
                    <div className="mt-1 text-right text-xs text-muted-foreground" data-testid={`test-result-${c.id}`}>{testResult[c.id]}</div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={draft !== null} onOpenChange={(o) => { if (!o) setDraft(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogTitle>{draft?.id === null ? t('settings.connectors.newTitle') : t('settings.connectors.editTitle')}</DialogTitle>
          {draft ? (
            <div className="text-sm">
              {/* Two-column form so the dialog is wider than it is tall. Base URL spans both. */}
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-muted-foreground">{t('settings.connectors.fieldName')}</span>
                  <Input data-testid="connector-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </label>
                <label className="grid gap-1">
                  <span className="text-muted-foreground">{t('settings.connectors.fieldPlugin')}</span>
                  <Select value={draft.pluginId} onValueChange={(v) => setDraft({ ...draft, pluginId: v })}>
                    <SelectTrigger data-testid="connector-plugin"><SelectValue placeholder={t('settings.connectors.pickPlugin')} /></SelectTrigger>
                    <SelectContent>
                      {plugins.map((p) => <SelectItem key={p.id} value={p.id}>{p.id}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
                <label className="grid gap-1 sm:col-span-2">
                  <span className="text-muted-foreground">{t('settings.connectors.fieldBaseUrl')}</span>
                  <Input data-testid="connector-baseurl" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                    placeholder={draft.id === null ? 'https://external-system.example.org/api' : t('settings.connectors.secretSet')} />
                </label>
                <label className="grid gap-1">
                  <span className="text-muted-foreground">{t('settings.connectors.fieldUsername')}</span>
                  <Input data-testid="connector-username" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })}
                    placeholder={draft.id === null ? '' : t('settings.connectors.secretSet')} />
                </label>
                <label className="grid gap-1">
                  <span className="text-muted-foreground">{t('settings.connectors.fieldPassword')}</span>
                  <Input data-testid="connector-password" type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                    placeholder={draft.id === null ? '' : t('settings.connectors.secretSet')} />
                </label>
                {draft.id !== null ? (
                  <label className="flex items-center gap-2 sm:col-span-2">
                    <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} aria-label={t('settings.connectors.enabledLabel')} />
                    <span className="text-muted-foreground">{t('settings.connectors.enabledLabel')}</span>
                  </label>
                ) : null}
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDraft(null)}>{t('settings.connectors.cancel')}</Button>
                <Button data-testid="connector-save" disabled={busy || !draft.name || !draft.pluginId} onClick={() => void onSave()}>
                  {t('settings.connectors.save')}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(o) => { if (!o) setPendingRemove(null); }}
        title={t('settings.connectors.removeTitle', { name: pendingRemove?.name ?? '' })}
        description={t('settings.connectors.removeDescription')}
        confirmLabel={t('settings.connectors.remove')}
        destructive
        onConfirm={() => { void onRemove(); }}
      />
    </div>
  );
}
