import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Plus, PanelLeftClose } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { ReportTemplate } from './types';

interface Props {
  templates: ReportTemplate[];
  selectedId: string | null;
  onSelect(id: string): void;
  onNew(): void;
  onCollapse(): void;
}

export function TemplatesExplorer({ templates, selectedId, onSelect, onNew, onCollapse }: Props): JSX.Element {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const filtered = templates.filter((tpl) => tpl.name.toLowerCase().includes(needle));

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-muted/40 px-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('reportDesigner.templates')}</span>
        <button onClick={onCollapse} className="rounded p-1 text-muted-foreground hover:bg-accent"
          aria-label={t('reportDesigner.collapseExplorer')} title={t('reportDesigner.collapseExplorer')}>
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-2 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('reportDesigner.search')}
            aria-label={t('reportDesigner.search')} className="h-8 pl-7 text-sm" />
        </div>
        <Button size="sm" variant="outline" className="w-full justify-start gap-1.5" onClick={onNew}>
          <Plus className="h-4 w-4" /> {t('reportDesigner.newTemplate')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        <div className="flex flex-col gap-1.5">
          {filtered.map((tpl) => {
            const active = tpl.id === selectedId;
            return (
              <button key={tpl.id} onClick={() => onSelect(tpl.id)}
                className={cn(
                  'rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  active ? 'border-primary/40 bg-accent text-accent-foreground' : 'hover:bg-muted',
                )}>
                <div className="font-medium">{tpl.name}</div>
                <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {tpl.paper} · {tpl.orientation} · {tpl.pages.length}
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="px-1 py-4 text-xs text-muted-foreground">{t('reportDesigner.noTemplates')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
