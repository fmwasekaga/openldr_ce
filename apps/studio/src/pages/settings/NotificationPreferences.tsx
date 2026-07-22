import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
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
  const [saving, setSaving] = useState(false);

  // Overlay of explicit opt-outs. Absence of a type here = enabled (matches
  // the server's contract: `disabled` only lists the types turned off).
  const [enabled, setEnabled] = useState<Map<NotificationType, boolean>>(new Map());
  const [originalEnabled, setOriginalEnabled] = useState<Map<NotificationType, boolean>>(new Map());
  const [minPriority, setMinPriority] = useState<NotificationPriority>('info');
  const [originalMinPriority, setOriginalMinPriority] = useState<NotificationPriority>('info');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { disabled, minPriority: mp } = await getNotificationPrefs();
      const next = new Map<NotificationType, boolean>();
      for (const type of TRIGGER_TYPES) next.set(type, !disabled.includes(type));
      setEnabled(next);
      setOriginalEnabled(new Map(next));
      setMinPriority(mp);
      setOriginalMinPriority(mp);
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = (type: NotificationType) => {
    setEnabled((prev) => {
      const next = new Map(prev);
      next.set(type, !(prev.get(type) ?? true));
      return next;
    });
  };

  const dirty = useMemo(() => {
    if (minPriority !== originalMinPriority) return true;
    for (const type of TRIGGER_TYPES) {
      if ((enabled.get(type) ?? true) !== (originalEnabled.get(type) ?? true)) return true;
    }
    return false;
  }, [enabled, originalEnabled, minPriority, originalMinPriority]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const prefs = TRIGGER_TYPES.map((type) => ({ type, enabled: enabled.get(type) ?? true }));
      await saveNotificationPrefs(prefs, minPriority);
      setOriginalEnabled(new Map(enabled));
      setOriginalMinPriority(minPriority);
      toast.success(t('settings.saved'));
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
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
                      <th className="pb-2 px-3 text-center font-medium">{t('notifications.enabledColumn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TRIGGER_TYPES.map((type) => (
                      <tr key={type} className="border-b border-border/50 last:border-0">
                        <td className="py-2.5 pr-4 pl-4 text-foreground">{t(`notifications.triggers.${type}`)}</td>
                        <td className="py-2.5 px-3 text-center">
                          <Checkbox
                            checked={enabled.get(type) ?? true}
                            onCheckedChange={() => toggle(type)}
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
              <Select value={minPriority} onValueChange={(v) => setMinPriority(v as NotificationPriority)}>
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

            <div className="flex items-center justify-end">
              <Button size="sm" disabled={saving || !dirty} onClick={() => void handleSave()} data-testid="notif-save">
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
