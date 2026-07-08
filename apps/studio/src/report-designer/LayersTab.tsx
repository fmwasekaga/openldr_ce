import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import type { ReportTemplate } from './types';
import { KIND_ICON } from './elementIcons';

interface Props {
  template: ReportTemplate;
  selectedElementId: string | null;
  onSelectElement(id: string): void;
}

export function LayersTab({ template, selectedElementId, onSelectElement }: Props): JSX.Element {
  const { t } = useTranslation();
  // topmost (last-painted) element first
  const elements = template.pages.flatMap((p) => p.elements).slice().reverse();
  return (
    <div>
      {elements.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">{t('reportDesigner.noElements')}</p>}
      {elements.map((el) => {
        const Icon = KIND_ICON[el.kind];
        const active = el.id === selectedElementId;
        return (
          <button key={el.id} onClick={() => onSelectElement(el.id)}
            className={cn('flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left text-sm transition-colors',
              active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')}>
            <Icon className="h-4 w-4 shrink-0" /> <span className="truncate">{el.name}</span>
          </button>
        );
      })}
    </div>
  );
}
