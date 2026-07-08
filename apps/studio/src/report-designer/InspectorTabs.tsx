import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import type { ReportTemplate, TemplateParam } from './types';
import { findElement } from './model';
import { PropertiesTab } from './PropertiesTab';
import { LayersTab } from './LayersTab';
import { DataTab } from './DataTab';

type TabKey = 'properties' | 'layers' | 'data';

interface Props {
  template: ReportTemplate;
  selectedIds: string[];
  onSelect(ids: string[]): void;
  onPatchElement(id: string, patch: Partial<import('./types').DesignElement>, opts?: { discrete?: boolean }): void;
  onPatchPage(patch: Partial<ReportTemplate>, opts?: { discrete?: boolean }): void;
  onPatchElements(ids: string[], patch: Partial<import('./types').DesignElement>, opts?: { discrete?: boolean }): void;
  onPatchParameters(next: TemplateParam[]): void;
}

export function InspectorTabs({ template, selectedIds, onSelect, onPatchElement, onPatchPage, onPatchElements, onPatchParameters }: Props): JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>('properties');
  // Binding is a single-selection action; for 0/multi selection pass undefined so the tab shows its hint.
  const selectedElement = (selectedIds.length === 1 ? findElement(template, selectedIds[0]) : undefined) ?? undefined;

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
        {tab === 'properties' && <PropertiesTab template={template} selectedIds={selectedIds} onPatchElement={onPatchElement} onPatchPage={onPatchPage} onPatchElements={onPatchElements} />}
        {tab === 'layers' && <LayersTab template={template} selectedIds={selectedIds} onSelect={onSelect} />}
        {tab === 'data' && <DataTab element={selectedElement} parameters={template.parameters} onPatchElement={onPatchElement} onPatchParameters={onPatchParameters} />}
      </div>
    </div>
  );
}
