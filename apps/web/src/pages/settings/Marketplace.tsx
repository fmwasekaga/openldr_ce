import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  listAvailableArtifacts, listInstalledArtifacts,
  installArtifact, setArtifactEnabled, rollbackArtifact, removeArtifact,
  type AvailableArtifact, type InstalledArtifact,
} from '@/api';

function capabilityLine(cap: unknown): string {
  if (typeof cap !== 'object' || cap === null) return String(cap);
  const c = cap as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof c.kind === 'string') parts.push(c.kind);
  if (Array.isArray(c.resourceTypes)) parts.push(`(${(c.resourceTypes as string[]).join(', ')})`);
  return parts.join(' ') || JSON.stringify(cap);
}

export function Marketplace() {
  const { t } = useTranslation();

  const [configured, setConfigured] = useState(true);
  const [available, setAvailable] = useState<AvailableArtifact[]>([]);
  const [installed, setInstalled] = useState<InstalledArtifact[]>([]);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [consentBundle, setConsentBundle] = useState<AvailableArtifact | null>(null);
  const [pendingRemove, setPendingRemove] = useState<InstalledArtifact | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const showToast = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  const load = useCallback(async () => {
    try {
      const [avail, inst] = await Promise.all([listAvailableArtifacts(), listInstalledArtifacts()]);
      setConfigured(avail.configured);
      setAvailable(avail.bundles);
      setInstalled(inst);
    } catch (e) {
      showToast('err', t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [t, showToast]);

  useEffect(() => { void load(); }, [load]);

  const doInstall = useCallback(async () => {
    if (!consentBundle || busy) return;
    setBusy(true);
    try {
      await installArtifact(consentBundle.ref, consentBundle.capabilities as unknown[]);
      showToast('ok', t('settings.marketplace.installedToast', { id: consentBundle.id }));
      setConsentBundle(null);
      await load();
    } catch (e) {
      showToast('err', t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }, [consentBundle, busy, t, showToast, load]);

  const doToggleEnabled = useCallback(async (artifact: InstalledArtifact) => {
    try {
      await setArtifactEnabled(artifact.id, !artifact.enabled);
      await load();
    } catch (e) {
      showToast('err', t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [t, showToast, load]);

  const doRollback = useCallback(async (id: string, version: string) => {
    try {
      await rollbackArtifact(id, version);
      showToast('ok', t('settings.marketplace.installedToast', { id }));
      await load();
    } catch (e) {
      showToast('err', t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [t, showToast, load]);

  const doRemove = useCallback(async () => {
    if (!pendingRemove) return;
    const a = pendingRemove;
    setPendingRemove(null);
    try {
      await removeArtifact(a.id);
      await load();
    } catch (e) {
      showToast('err', t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [pendingRemove, t, showToast, load]);

  const filteredAvailable = available.filter((b) => {
    const textMatch = !filter || b.id.toLowerCase().includes(filter.toLowerCase()) || b.ref.toLowerCase().includes(filter.toLowerCase());
    const typeMatch = typeFilter === 'all' || b.type === typeFilter;
    return textMatch && typeMatch;
  });

  const signatureBadge = (b: AvailableArtifact) => {
    if (!b.valid) return <Badge variant="secondary" className="border-destructive/50 text-destructive">{t('settings.marketplace.invalid')}</Badge>;
    if (b.publisher) return <Badge variant="outline" className="border-emerald-500 text-emerald-700">{t('settings.marketplace.verified')}</Badge>;
    return <Badge variant="outline">{t('settings.marketplace.firstUse')}</Badge>;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4" data-testid="marketplace-page">
      <h1 className="text-lg font-semibold">{t('settings.marketplace.heading')}</h1>

      {toast ? (
        <div className={toast.kind === 'ok'
          ? 'rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700'
          : 'rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive'}>{toast.text}</div>
      ) : null}

      {/* Filter row */}
      <div className="flex items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder={t('settings.marketplace.filterPlaceholder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="plugin">Plugin</SelectItem>
            <SelectItem value="form-template">Form template</SelectItem>
            <SelectItem value="report">Report</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Available bundles */}
      <Card>
        <CardHeader><CardTitle>{t('settings.marketplace.available')}</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!configured ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">{t('settings.marketplace.notConfigured')}</div>
          ) : filteredAvailable.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">No bundles available.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>{t('settings.marketplace.version')}</TableHead>
                  <TableHead>{t('settings.marketplace.type')}</TableHead>
                  <TableHead>{t('settings.marketplace.publisher')}</TableHead>
                  <TableHead>Signature</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAvailable.map((b) => (
                  <TableRow key={b.ref}>
                    <TableCell className="font-medium">{b.id}</TableCell>
                    <TableCell>{b.version}</TableCell>
                    <TableCell><Badge variant="outline">{b.type}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {b.publisher ? b.publisher.name : '—'}
                    </TableCell>
                    <TableCell>{signatureBadge(b)}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        disabled={!b.valid || b.type !== 'plugin'}
                        title={b.type !== 'plugin' ? t('settings.marketplace.installPluginOnly') : undefined}
                        data-testid={`install-${b.ref}`}
                        onClick={() => setConsentBundle(b)}
                      >
                        {t('settings.marketplace.install')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Installed artifacts */}
      <Card>
        <CardHeader><CardTitle>{t('settings.marketplace.installed')}</CardTitle></CardHeader>
        <CardContent className="p-0">
          {installed.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing installed yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>{t('settings.marketplace.version')}</TableHead>
                  <TableHead>{t('settings.marketplace.active')}</TableHead>
                  <TableHead>{t('settings.marketplace.enabledLabel')}</TableHead>
                  <TableHead>{t('settings.marketplace.approvedBy')}</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {installed.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.id}</TableCell>
                    <TableCell>{a.version}</TableCell>
                    <TableCell>
                      {a.active ? <Badge variant="outline" className="border-emerald-500 text-emerald-700">{t('settings.marketplace.active')}</Badge> : <Badge variant="outline">Inactive</Badge>}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={`toggle-enabled-${a.id}`}
                        onClick={() => void doToggleEnabled(a)}
                      >
                        {a.enabled ? t('settings.marketplace.disable') : t('settings.marketplace.enable')}
                      </Button>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{a.approvedBy ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void doRollback(a.id, a.version)}
                        >
                          {t('settings.marketplace.rollback')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setPendingRemove(a)}
                        >
                          {t('settings.marketplace.remove')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Consent dialog */}
      <Dialog open={consentBundle !== null} onOpenChange={(o) => { if (!o) setConsentBundle(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>{t('settings.marketplace.consentTitle', { id: consentBundle?.id ?? '' })}</DialogTitle>
          {consentBundle ? (
            <div className="grid gap-3 text-sm">
              {consentBundle.publisher ? (
                <div><span className="font-medium">{t('settings.marketplace.publisher')}:</span> {consentBundle.publisher.name}</div>
              ) : null}
              <div><span className="font-medium">{t('settings.marketplace.version')}:</span> {consentBundle.version}</div>
              <div>{signatureBadge(consentBundle)}</div>
              <div>
                <div className="mb-1 font-medium">{t('settings.marketplace.requestedCapabilities')}</div>
                {(consentBundle.capabilities as unknown[]).length === 0 ? (
                  <div className="text-muted-foreground">None</div>
                ) : (
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {(consentBundle.capabilities as unknown[]).map((cap, i) => (
                      <li key={i}>{capabilityLine(cap)}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setConsentBundle(null)}>
                  {t('settings.marketplace.cancel')}
                </Button>
                <Button
                  data-testid="approve-install"
                  disabled={busy}
                  onClick={() => void doInstall()}
                >
                  {t('settings.marketplace.approveInstall')}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Remove confirm */}
      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(o) => { if (!o) setPendingRemove(null); }}
        title={t('settings.marketplace.removeTitle', { id: pendingRemove?.id ?? '' })}
        description={t('settings.marketplace.removeDescription')}
        confirmLabel={t('settings.marketplace.remove')}
        destructive
        onConfirm={() => { void doRemove(); }}
      />
    </div>
  );
}
