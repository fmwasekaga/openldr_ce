import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Bleed } from '@/components/ui/bleed';
import { SettingsHeader } from './SettingsHeader';
import {
  getNotificationPrefs, saveNotificationPrefs,
  type NotificationType, type NotificationPriority,
} from '@/api';

// The trigger types the server emits. New triggers land here + a matching
// `notifications.triggers.<type>` i18n key (Task 11).
const TRIGGER_TYPES: NotificationType[] = [
  'sync_diverged', 'sync_failed', 'sync_quarantined',
  'plugin_crashed', 'system_crashed', 'auth_failed', 'site_revoked',
  'terminology_import_done', 'terminology_import_failed',
];

const PRIORITIES: NotificationPriority[] = ['info', 'warning', 'critical'];

export function NotificationPreferences() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Overlay of explicit opt-outs. Absence of a type here = enabled (matches
  // the server's contract: `disabled` only lists the types turned off).
  const [enabled, setEnabled] = useState<Map<NotificationType, boolean>>(new Map());
  const [minPriority, setMinPriority] = useState<NotificationPriority>('info');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { disabled, minPriority: mp } = await getNotificationPrefs();
      const next = new Map<NotificationType, boolean>();
      for (const type of TRIGGER_TYPES) next.set(type, !disabled.includes(type));
      setEnabled(next);
      setMinPriority(mp);
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback(async (type: NotificationType) => {
    const next = new Map(enabled);
    next.set(type, !(enabled.get(type) ?? true));
    setEnabled(next);
    setBusy(true);
    try {
      await saveNotificationPrefs(
        TRIGGER_TYPES.map((tt) => ({ type: tt, enabled: next.get(tt) ?? true })),
        minPriority,
      );
      toast.success(t('settings.saved'));
    } catch (e) {
      setEnabled(enabled);
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }, [enabled, minPriority, t]);

  const changeMinPriority = useCallback(async (next: NotificationPriority) => {
    const prev = minPriority;
    setMinPriority(next);
    setBusy(true);
    try {
      await saveNotificationPrefs(
        TRIGGER_TYPES.map((tt) => ({ type: tt, enabled: enabled.get(tt) ?? true })),
        next,
      );
      toast.success(t('settings.saved'));
    } catch (e) {
      setMinPriority(prev);
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }, [enabled, minPriority, t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="notification-preferences-page">
      <SettingsHeader description={t('notifications.preferencesHint')} />
      <div className="flex flex-col gap-4 p-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : (
          <>
            <Bleed>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="pb-2 pr-4 pl-4 text-left font-medium">{t('notifications.eventColumn')}</th>
                      <th className="pb-2 pr-4 pl-3 text-right font-medium">{t('notifications.enabledColumn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TRIGGER_TYPES.map((type) => (
                      <tr key={type} className="border-b border-border/50 last:border-0">
                        <td className="py-2.5 pr-4 pl-4 text-foreground">{t(`notifications.triggers.${type}`)}</td>
                        <td className="py-2.5 pr-4 pl-3 text-right">
                          <Switch
                            checked={enabled.get(type) ?? true}
                            disabled={busy}
                            onCheckedChange={() => void toggle(type)}
                            aria-label={t(`notifications.triggers.${type}`)}
                            data-testid={`notif-enabled-${type}`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Bleed>

            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium">{t('notifications.minPriority')}</div>
              </div>
              <Select
                value={minPriority}
                disabled={busy}
                onValueChange={(v) => void changeMinPriority(v as NotificationPriority)}
              >
                <SelectTrigger className="w-32 shrink-0" aria-label={t('notifications.minPriority')} data-testid="notif-min-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>{t(`notifications.priorities.${p}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
