import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { listPluginUis, type PluginUiEntry } from '@/api';
import { AppShell } from '@/shell/AppShell';
import { PluginFrame } from './PluginFrame';
import { DeclarativeForm } from './DeclarativeForm';

export function PluginContainer(): JSX.Element {
  const { pluginId = '' } = useParams();
  const { t } = useTranslation();
  const [entry, setEntry] = useState<PluginUiEntry | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void listPluginUis().then((list) => { if (!cancelled) setEntry(list.find((e) => e.id === pluginId) ?? null); });
    return () => { cancelled = true; };
  }, [pluginId]);

  // Render inside AppShell so the plugin UI keeps the app chrome (sidebar to navigate
  // away, header) and a full-height layout. `fullBleed` gives the webview/iframe the
  // whole content area (AppShell is h-screen; without it h-full has no height to resolve).
  if (entry === undefined) {
    return <AppShell title={pluginId}><div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div></AppShell>;
  }
  if (entry === null) {
    return <AppShell title={pluginId}><div className="p-6 text-sm text-muted-foreground">{t('plugins.notFound', 'Plugin not found or not installed.')}</div></AppShell>;
  }

  return (
    <AppShell title={entry.nav.label} fullBleed>
      {entry.hasWebview ? (
        <div className="min-h-0 flex-1">
          <PluginFrame
            pluginId={entry.id}
            context={{ pluginId: entry.id, capabilities: [], theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light', locale: i18n.language, sessionId: crypto.randomUUID() }}
          />
        </div>
      ) : entry.hasDeclarative ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <DeclarativeForm pluginId={entry.id} schema={entry.declarative} />
        </div>
      ) : (
        <div className="p-6 text-sm text-muted-foreground">{t('plugins.noUi', 'This plugin contributes no UI.')}</div>
      )}
    </AppShell>
  );
}
