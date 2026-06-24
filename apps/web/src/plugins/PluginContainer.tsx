import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { listPluginUis, type PluginUiEntry } from '@/api';
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

  if (entry === undefined) return <div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div>;
  if (entry === null) return <div className="p-6 text-sm text-muted-foreground">{t('plugins.notFound', 'Plugin not found or not installed.')}</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-3 text-lg font-semibold">{entry.nav.label}</div>
      <div className="min-h-0 flex-1">
        {entry.hasWebview ? (
          <PluginFrame
            pluginId={entry.id}
            context={{ pluginId: entry.id, capabilities: [], theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light', locale: i18n.language, sessionId: crypto.randomUUID() }}
          />
        ) : entry.hasDeclarative ? (
          <DeclarativeForm pluginId={entry.id} schema={entry.declarative} />
        ) : (
          <div className="p-6 text-sm text-muted-foreground">{t('plugins.noUi', 'This plugin contributes no UI.')}</div>
        )}
      </div>
    </div>
  );
}
