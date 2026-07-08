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
    <div className="flex flex-col gap-1 p-2">
      {elements.length === 0 && <p className="px-1 py-3 text-xs text-muted-foreground">{t('reportDesigner.noElements')}</p>}
      {elements.map((el) => {
        const Icon = KIND_ICON[el.kind];
        const active = el.id === selectedElementId;
        return (
          <button key={el.id} onClick={() => onSelectElement(el.id)}
            className={cn('flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs',
              active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted')}>
            <Icon className="h-3.5 w-3.5" /> <span className="truncate">{el.name}</span>
          </button>
        );
      })}
    </div>
  );
}
