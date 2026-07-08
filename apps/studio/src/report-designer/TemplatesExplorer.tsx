import { useTranslation } from 'react-i18next';
import { PanelLeftClose } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ReportTemplate } from './types';

interface Props {
  templates: ReportTemplate[];
  selectedId: string | null;
  onSelect(id: string): void;
  onCollapse(): void;
}

export function TemplatesExplorer({ templates, selectedId, onSelect, onCollapse }: Props): JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-muted/40 px-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('reportDesigner.templates')}</span>
        <button onClick={onCollapse} className="rounded p-1 text-muted-foreground hover:bg-accent"
          aria-label={t('reportDesigner.collapseExplorer')} title={t('reportDesigner.collapseExplorer')}>
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {templates.map((tpl) => {
          const active = tpl.id === selectedId;
          return (
            <button key={tpl.id} onClick={() => onSelect(tpl.id)}
              className={cn(
                'block w-full border-b border-border px-3 py-2.5 text-left text-sm transition-colors',
                active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
              )}>
              <div className="font-medium">{tpl.name}</div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {tpl.paper} · {tpl.orientation} · {tpl.pages.length}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
