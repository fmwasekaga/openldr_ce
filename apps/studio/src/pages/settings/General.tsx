import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { DangerConfirmDialog } from '@/terminology/DangerConfirmDialog';
import {
  fetchClientConfig, fetchFeatureFlags, setFeatureFlag, runDangerAction,
  type ClientConfig, type FeatureFlag, type DangerAction,
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

  const load = useCallback(async () => {
    try {
      const cfg = await fetchClientConfig();
      setConfig(cfg);
      if (isAdmin) setFlags(await fetchFeatureFlags());
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    }
  }, [isAdmin]);
  useEffect(() => { void load(); }, [load]);

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
