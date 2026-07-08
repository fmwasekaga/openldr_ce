import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import type { ReportTemplate } from './types';
import { PropertiesTab } from './PropertiesTab';
import { LayersTab } from './LayersTab';
import { DataTab } from './DataTab';

type TabKey = 'properties' | 'layers' | 'data';

interface Props {
  template: ReportTemplate;
  selectedIds: string[];
  onSelect(ids: string[]): void;
}

export function InspectorTabs({ template, selectedIds, onSelect }: Props): JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>('properties');

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'properties', label: t('reportDesigner.properties') },
    { key: 'layers', label: t('reportDesigner.layers') },
    { key: 'data', label: t('reportDesigner.data') },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Flush rectangular tabs with vertical dividers, matching the query workspace tab bar:
          active = primary top-accent line + content-surface background. */}
      <div className="flex h-10 shrink-0 items-stretch divide-x divide-border border-b border-border bg-muted/40">
        {tabs.map((tb) => {
          const active = tab === tb.key;
          return (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className={cn('flex flex-1 items-center justify-center border-t-2 text-[11px] font-medium uppercase tracking-wide',
                active ? 'border-t-primary bg-background text-foreground' : 'border-t-transparent text-muted-foreground hover:bg-background/40')}>
              {tb.label}
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'properties' && <PropertiesTab template={template} selectedIds={selectedIds} />}
        {tab === 'layers' && <LayersTab template={template} selectedIds={selectedIds} onSelect={onSelect} />}
        {tab === 'data' && <DataTab template={template} />}
      </div>
    </div>
  );
}
