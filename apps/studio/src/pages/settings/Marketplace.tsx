import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  listAvailableArtifacts, listInstalledArtifacts, refreshRegistry,
  installArtifact, setArtifactEnabled, rollbackArtifact, removeArtifact, detachArtifact,
  getPublishStatus, publishArtifact,
  type AvailableArtifact, type InstalledArtifact,
} from '@/api';
import { MarketplaceTabs } from './marketplace/MarketplaceTabs';
import { capabilityLine, type CardEntry } from './marketplace/util';

export function Marketplace() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [configured, setConfigured] = useState(true);
  const [source, setSource] = useState<'local' | 'http' | null>(null);
  const [host, setHost] = useState<string | null>(null);
  const [available, setAvailable] = useState<AvailableArtifact[]>([]);
  const [installed, setInstalled] = useState<InstalledArtifact[]>([]);
  const [consent, setConsent] = useState<{ entry: CardEntry; capabilities: unknown[] } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<CardEntry | null>(null);
  const [pendingDetach, setPendingDetach] = useState<CardEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canPublish, setCanPublish] = useState(false);

  const load = useCallback(async () => {
    try {
      const [avail, inst] = await Promise.all([listAvailableArtifacts(), listInstalledArtifacts()]);
      setConfigured(avail.configured);
      setAvailable(avail.bundles);
      setSource(avail.source); setHost(avail.host);
      setLoadError(avail.error ?? null);
      setInstalled(inst);
    } catch (e) {
      toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => { void getPublishStatus().then((s) => setCanPublish(s.configured)).catch(() => setCanPublish(false)); }, []);

  const doInstall = useCallback(async () => {
    if (!consent || !consent.entry.ref || busy) return;
    setBusy(true);
    try {
      await installArtifact(consent.entry.ref, consent.capabilities);
      toast.success(t('settings.marketplace.installedToast', { id: consent.entry.id }));
      setConsent(null);
      await load();
    } catch (e) {
      toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }, [consent, busy, t, load]);

  const onRefresh = useCallback(async () => {
    try { await refreshRegistry(); await load(); toast.success(t('settings.marketplace.refresh')); }
    catch (e) { toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [t, load]);

  const onToggleEnabled = useCallback(async (id: string, enabled: boolean) => {
    try { await setArtifactEnabled(id, enabled); await load(); }
    catch (e) { toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [t, load]);

  const onRollback = useCallback(async (id: string, version: string) => {
    try { await rollbackArtifact(id, version); toast.success(t('settings.marketplace.installedToast', { id })); await load(); }
    catch (e) { toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [t, load]);

  const onPublish = useCallback(async (entry: CardEntry) => {
    if (!entry.ref) return;
    try {
      const { prUrl, prNumber } = await publishArtifact(entry.ref);
      toast.success(t('settings.marketplace.publishedToast', { number: prNumber }), {
        action: { label: t('settings.marketplace.viewPr'), onClick: () => window.open(prUrl, '_blank', 'noopener') },
      });
    } catch (e) {
      toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [t]);

  const doRemove = useCallback(async () => {
    if (!pendingRemove) return;
    const entry = pendingRemove;
    setPendingRemove(null);
    try { await removeArtifact(entry.id); await load(); }
    catch (e) { toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [pendingRemove, t, load]);

  const doDetach = useCallback(async () => {
    if (!pendingDetach) return;
    const entry = pendingDetach;
    setPendingDetach(null);
    try { await detachArtifact(entry.id); toast.success(t('settings.marketplace.detach')); await load(); }
    catch (e) { toast.error(t('settings.marketplace.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [pendingDetach, t, load]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4" data-testid="marketplace-page">
      <h1 className="text-lg font-semibold">{t('settings.marketplace.heading')}</h1>

      <MarketplaceTabs
        configured={configured}
        available={available}
        installed={installed}
        onInstall={(entry, capabilities) => setConsent({ entry, capabilities })}
        onToggleEnabled={onToggleEnabled}
        onRollback={onRollback}
        onRemove={(entry) => setPendingRemove(entry)}
        onDetach={(e) => setPendingDetach(e)}
        onOpenForm={(id) => navigate('/forms/' + id)}
        canPublish={canPublish}
        onPublish={onPublish}
        source={source}
        host={host}
        onRefresh={onRefresh}
        loadError={loadError}
      />

      {/* Consent dialog */}
      <Dialog open={consent !== null} onOpenChange={(o) => { if (!o) setConsent(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>{t('settings.marketplace.consentTitle', { id: consent?.entry.id ?? '' })}</DialogTitle>
          {consent ? (
            <div className="grid gap-3 text-sm">
              <div><span className="font-medium">{t('settings.marketplace.version')}:</span> {consent.entry.version}</div>
              <div>
                <div className="mb-1 font-medium">{t('settings.marketplace.requestedCapabilities')}</div>
                {consent.capabilities.length === 0 ? (
                  <div className="text-muted-foreground">{t('settings.marketplace.noneCapabilities')}</div>
                ) : (
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {consent.capabilities.map((cap, i) => <li key={i}>{capabilityLine(cap)}</li>)}
                  </ul>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setConsent(null)}>{t('settings.marketplace.cancel')}</Button>
                <Button data-testid="approve-install" disabled={busy} onClick={() => void doInstall()}>
                  {t('settings.marketplace.approveInstall')}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(o) => { if (!o) setPendingRemove(null); }}
        title={t('settings.marketplace.removeTitle', { id: pendingRemove?.id ?? '' })}
        description={t('settings.marketplace.removeDescription')}
        confirmLabel={t('settings.marketplace.remove')}
        destructive
        onConfirm={() => { void doRemove(); }}
      />

      <ConfirmDialog
        open={pendingDetach !== null}
        onOpenChange={(o) => { if (!o) setPendingDetach(null); }}
        title={t('settings.marketplace.detachTitle', { id: pendingDetach?.id ?? '' })}
        description={t('settings.marketplace.detachDescription')}
        confirmLabel={t('settings.marketplace.detach')}
        destructive
        onConfirm={() => { void doDetach(); }}
      />
    </div>
  );
}
