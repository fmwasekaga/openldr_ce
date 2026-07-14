import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { DangerConfirmDialog } from '@/terminology/DangerConfirmDialog';
import {
  fetchClientConfig, fetchFeatureFlags, setFeatureFlag, runDangerAction,
  fetchSyncConfig, saveSyncConfig, fetchSyncStatus, triggerSyncNow,
  fetchNumberSettings, setNumberSetting,
  type ClientConfig, type FeatureFlag, type DangerAction,
  type SyncConfigView, type SyncConfigInput, type SyncMode, type SyncStatus, type SyncDirectionStatus,
  type NumberSetting,
} from '@/api';

type PendingDanger = null | 'reset-dashboards' | 'clear-audit' | 'factory-reset';

export function General() {
  const { t } = useTranslation();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('lab_admin');
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [busyFlag, setBusyFlag] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDanger>(null);
  const [dangerBusy, setDangerBusy] = useState(false);
  const [sync, setSync] = useState<SyncConfigView | null>(null);
  // Write-only secret field: blank ⇒ leave the stored secret unchanged (omit from the PUT payload).
  const [secretInput, setSecretInput] = useState('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncSaving, setSyncSaving] = useState(false);
  const [syncNowBusy, setSyncNowBusy] = useState(false);
  const [numbers, setNumbers] = useState<NumberSetting[]>([]);
  const [busyNumber, setBusyNumber] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const cfg = await fetchClientConfig();
      setConfig(cfg);
      if (isAdmin) {
        setFlags(await fetchFeatureFlags());
        setSync(await fetchSyncConfig());
        setSyncStatus(await fetchSyncStatus());
        setNumbers(await fetchNumberSettings());
      }
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    }
  }, [isAdmin]);

  const commitNumber = useCallback(async (setting: NumberSetting) => {
    setBusyNumber(setting.id);
    try {
      const { value } = await setNumberSetting(setting.id, setting.value);
      // The server clamps into range; reflect the stored value.
      setNumbers((prev) => prev.map((s) => (s.id === setting.id ? { ...s, value } : s)));
      toast.success(t('settings.general.numbers.saved'));
    } catch (e) {
      toast.error(t('settings.general.numbers.saveFailed', { error: e instanceof Error ? e.message : String(e) }));
      setNumbers(await fetchNumberSettings());
    } finally {
      setBusyNumber(null);
    }
  }, [t]);

  const refreshSyncStatus = useCallback(async () => {
    try {
      setSyncStatus(await fetchSyncStatus());
    } catch {
      // Status is best-effort telemetry; a transient failure shouldn't surface a toast.
    }
  }, []);

  const saveSync = useCallback(async () => {
    if (!sync) return;
    setSyncSaving(true);
    try {
      const input: SyncConfigInput = {
        enabled: sync.enabled,
        mode: sync.mode,
        centralUrl: sync.centralUrl,
        siteId: sync.siteId,
        oidcIssuer: sync.oidcIssuer,
        clientId: sync.clientId,
        intervalMinutes: sync.intervalMinutes,
        // Only send the secret when the operator typed a new one; blank ⇒ preserve the stored value.
        ...(secretInput ? { clientSecret: secretInput } : {}),
      };
      setSync(await saveSyncConfig(input));
      setSecretInput('');
      toast.success(t('settings.general.sync.saved'));
      await refreshSyncStatus();
    } catch (e) {
      toast.error(t('settings.general.sync.saveFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSyncSaving(false);
    }
  }, [sync, secretInput, t, refreshSyncStatus]);

  const doSyncNow = useCallback(async () => {
    setSyncNowBusy(true);
    try {
      const res = await triggerSyncNow();
      if (res.triggered) toast.success(t('settings.general.sync.triggered'));
      else toast.info(t('settings.general.sync.disabledToast'));
      await refreshSyncStatus();
    } catch (e) {
      toast.error(t('settings.general.sync.saveFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSyncNowBusy(false);
    }
  }, [t, refreshSyncStatus]);

  useEffect(() => { void load(); }, [load]);

  // Poll live sync status while the card is mounted (admin + config loaded). Cleared on unmount.
  useEffect(() => {
    if (!isAdmin || !sync) return;
    const id = setInterval(() => { void refreshSyncStatus(); }, 10_000);
    return () => clearInterval(id);
  }, [isAdmin, sync, refreshSyncStatus]);

  const onToggle = useCallback(async (flag: FeatureFlag, value: boolean) => {
    setBusyFlag(flag.id);
    setFlags((prev) => prev.map((f) => (f.id === flag.id ? { ...f, value } : f)));
    try {
      await setFeatureFlag(flag.id, value);
      await fetchClientConfig().then(setConfig);
      toast.success(t('settings.general.flags.saved'));
    } catch (e) {
      setFlags((prev) => prev.map((f) => (f.id === flag.id ? { ...f, value: !value } : f)));
      toast.error(t('settings.general.flags.saveFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusyFlag(null);
    }
  }, [t]);

  const runDanger = useCallback(async (action: DangerAction) => {
    setDangerBusy(true);
    try {
      await runDangerAction(action);
      toast.success(t('settings.general.danger.done', { action }));
      await load();
    } catch (e) {
      toast.error(t('settings.general.danger.failed', { action, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setDangerBusy(false);
      setPending(null);
    }
  }, [t, load]);

  const dangerMeta: Record<Exclude<PendingDanger, null>, { key: string }> = {
    'reset-dashboards': { key: 'resetDashboards' },
    'clear-audit': { key: 'clearAudit' },
    'factory-reset': { key: 'factoryReset' },
  };

  // One-line summary of a sync direction: "not started", or "running/idle · seq N · <time>".
  const directionLine = (dir: SyncDirectionStatus | null): string => {
    if (!dir) return t('settings.general.sync.notStarted');
    const state = dir.running ? t('settings.general.sync.running') : t('settings.general.sync.idle');
    const parts = [state, `seq ${dir.lastSeq}`];
    if (dir.lastSyncedAt) parts.push(new Date(dir.lastSyncedAt).toLocaleString());
    return parts.join(' · ');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" data-testid="general-page">
      <div>
        <h1 className="text-lg font-semibold">{t('settings.general.heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('settings.general.description')}</p>
      </div>

      {/* About — all users */}
      <Card>
        <CardHeader><CardTitle>{t('settings.general.about.title')}</CardTitle></CardHeader>
        <CardContent className="text-sm">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
            <dt className="text-muted-foreground">{t('settings.general.about.version')}</dt>
            <dd className="font-mono">{config?.version || '—'}</dd>
            <dt className="text-muted-foreground">{t('settings.general.about.environment')}</dt>
            <dd className="font-mono">{config?.environment || '—'}</dd>
            <dt className="text-muted-foreground">{t('settings.general.about.license')}</dt>
            <dd>Apache-2.0</dd>
          </dl>
        </CardContent>
      </Card>

      {/* Feature Flags — admin only */}
      {isAdmin && (
      <Card>
        <CardHeader><CardTitle>{t('settings.general.flags.title')}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t('settings.general.flags.description')}</p>
          {flags.map((f) => (
            <div key={f.id} className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium">{t(f.labelKey)}</div>
                <div className="text-xs text-muted-foreground">{t(f.descriptionKey)}</div>
              </div>
              <Switch checked={f.value} disabled={busyFlag === f.id} onCheckedChange={(v) => void onToggle(f, v)} aria-label={t(f.labelKey)} />
            </div>
          ))}
        </CardContent>
      </Card>
      )}

      {/* Limits & tuning — admin only. DB-backed number settings migrated from env vars. */}
      {isAdmin && numbers.length > 0 && (
      <Card>
        <CardHeader><CardTitle>{t('settings.general.numbers.title')}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t('settings.general.numbers.description')}</p>
          {numbers.map((s) => (
            <div key={s.id} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium">{t(s.labelKey)}</div>
                <div className="text-xs text-muted-foreground">{t(s.descriptionKey)}</div>
              </div>
              <Input
                type="number"
                min={s.min}
                max={s.max}
                className="w-40 shrink-0"
                disabled={busyNumber === s.id}
                value={s.value}
                onChange={(e) => setNumbers((prev) => prev.map((x) => (x.id === s.id ? { ...x, value: Number(e.target.value) } : x)))}
                onBlur={() => void commitNumber(s)}
                aria-label={t(s.labelKey)}
              />
            </div>
          ))}
        </CardContent>
      </Card>
      )}

      {/* Lab ⇄ central sync — admin only. Config form + live status + manual trigger. */}
      {isAdmin && sync && (
      <Card>
        <CardHeader><CardTitle>{t('settings.general.sync.title')}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">{t('settings.general.sync.enabled.label')}</div>
              <div className="text-xs text-muted-foreground">{t('settings.general.sync.enabled.description')}</div>
            </div>
            <Switch
              checked={sync.enabled}
              onCheckedChange={(v) => setSync({ ...sync, enabled: v })}
              aria-label={t('settings.general.sync.enabled.label')}
            />
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('settings.general.sync.mode.label')}</span>
            <Select value={sync.mode} onValueChange={(v) => setSync({ ...sync, mode: v as SyncMode })}>
              <SelectTrigger className="w-56" aria-label={t('settings.general.sync.mode.label')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['push', 'pull', 'bidirectional'] as const).map((m) => (
                  <SelectItem key={m} value={m}>{t(`settings.general.sync.mode.${m}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('settings.general.sync.centralUrl.label')}</span>
            <Input
              value={sync.centralUrl}
              placeholder="https://central.example.org"
              onChange={(e) => setSync({ ...sync, centralUrl: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('settings.general.sync.siteId.label')}</span>
            <Input
              value={sync.siteId}
              placeholder="lab-ndola-01"
              onChange={(e) => setSync({ ...sync, siteId: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('settings.general.sync.oidcIssuer.label')}</span>
            <Input
              value={sync.oidcIssuer}
              placeholder="https://central.example.org/auth/realms/openldr"
              onChange={(e) => setSync({ ...sync, oidcIssuer: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('settings.general.sync.clientId.label')}</span>
            <Input
              value={sync.clientId}
              placeholder="sync-lab-ndola-01"
              onChange={(e) => setSync({ ...sync, clientId: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('settings.general.sync.clientSecret.label')}</span>
            <Input
              type="password"
              value={secretInput}
              placeholder={sync.clientSecretSet ? t('settings.general.sync.clientSecretSet') : ''}
              onChange={(e) => setSecretInput(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('settings.general.sync.intervalMinutes.label')}</span>
            <Input
              type="number"
              min={1}
              className="w-32"
              value={sync.intervalMinutes}
              onChange={(e) => setSync({ ...sync, intervalMinutes: Number(e.target.value) })}
            />
          </label>
          <div>
            <Button onClick={() => void saveSync()} disabled={syncSaving}>
              {t('settings.general.sync.save')}
            </Button>
          </div>

          {/* Live status panel */}
          <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="font-medium">{t('settings.general.sync.status')}</span>
              <span className={`rounded px-2 py-0.5 text-xs ${syncStatus?.enabled ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                {syncStatus?.enabled ? t('settings.general.sync.on') : t('settings.general.sync.off')}
              </span>
            </div>
            <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">{t('settings.general.sync.mode.push')}</dt>
              <dd className="font-mono">{directionLine(syncStatus?.push ?? null)}</dd>
              <dt className="text-muted-foreground">{t('settings.general.sync.mode.pull')}</dt>
              <dd className="font-mono">{directionLine(syncStatus?.pull ?? null)}</dd>
              <dt className="text-muted-foreground">{t('settings.general.sync.pending')}</dt>
              <dd className="font-mono">{syncStatus?.pendingPush ?? 0}</dd>
            </dl>
            <div>
              <Button variant="secondary" onClick={() => void doSyncNow()} disabled={syncNowBusy}>
                {t('settings.general.sync.syncNow')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Danger Zone — admin only */}
      {isAdmin && (
      <Card className="border-destructive/40">
        <CardHeader><CardTitle className="text-destructive">{t('settings.general.danger.title')}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t('settings.general.danger.description')}</p>
          {(['reset-dashboards', 'clear-audit', 'factory-reset'] as const).map((action) => {
            const k = dangerMeta[action].key;
            return (
              <div key={action} className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">{t(`settings.general.danger.${k}.label`)}</div>
                  <div className="text-xs text-muted-foreground">{t(`settings.general.danger.${k}.description`)}</div>
                </div>
                <Button variant="secondary" className="border-destructive/50 text-destructive" disabled={dangerBusy} onClick={() => setPending(action)}>
                  {t(`settings.general.danger.${k}.button`)}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
      )}

      {isAdmin && pending && (
        <DangerConfirmDialog
          open={pending !== null}
          onOpenChange={(o) => { if (!o) setPending(null); }}
          title={t(`settings.general.danger.${dangerMeta[pending].key}.title`)}
          confirmName={t(`settings.general.danger.${dangerMeta[pending].key}.confirm`)}
          confirmLabel={t(`settings.general.danger.${dangerMeta[pending].key}.button`)}
          summary={<p>{t(`settings.general.danger.${dangerMeta[pending].key}.warning`)}</p>}
          onConfirm={() => void runDanger(pending)}
        />
      )}
    </div>
  );
}
