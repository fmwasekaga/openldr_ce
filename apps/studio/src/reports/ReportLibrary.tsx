import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Star, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { ReportSummary, ReportCategory } from '../api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';

interface Props {
  reports: ReportSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  pinnedIds: string[];
  onTogglePin: (id: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const CATEGORY_ORDER: ReportCategory[] = ['amr', 'operational', 'quality', 'regulatory'];

export function ReportLibrary({
  reports, selectedId, onSelect, pinnedIds, onTogglePin,
  search, onSearchChange, collapsed, onToggleCollapse,
}: Props) {
  const { t } = useTranslation();

  const filtered = useMemo(
    () => reports.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase())),
    [reports, search],
  );
  const pinned = filtered.filter((r) => pinnedIds.includes(r.id));
  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: filtered.filter((r) => r.category === cat),
  })).filter((g) => g.items.length > 0);

  const sections: { key: string; label: string; items: ReportSummary[] }[] = [
    ...(pinned.length > 0 ? [{ key: 'pinned', label: t('reports.pinned'), items: pinned }] : []),
    ...byCategory.map(({ cat, items }) => ({ key: cat, label: t(`reports.categories.${cat}`), items })),
  ];

  if (collapsed) {
    return (
      <aside className="flex min-h-0 w-10 flex-1 shrink-0 flex-col items-center py-2">
        <Button variant="ghost" size="icon" onClick={onToggleCollapse} aria-label="Expand library">
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
      </aside>
    );
  }

  const Row = ({ r }: { r: ReportSummary }) => (
    <div
      className={cn(
        'group flex cursor-pointer items-center gap-2 border-l-2 px-3 py-2 text-sm transition-colors',
        r.id === selectedId
          ? 'border-[#5A9BD6] bg-[rgba(70,130,180,0.08)] text-foreground'
          : 'border-transparent text-foreground/85 hover:bg-accent hover:text-foreground',
      )}
      onClick={() => onSelect(r.id)}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="min-w-0 flex-1 truncate">{r.name}</span>
        </TooltipTrigger>
        <TooltipContent side="right">{r.name}</TooltipContent>
      </Tooltip>
      {r.source === 'builder' && (
        <Badge variant="outline" className="shrink-0 px-1 py-0 text-[9px] font-medium uppercase tracking-wide">
          {t('reports.custom')}
        </Badge>
      )}
      {r.source === 'design' && (
        <Badge variant="outline" className="shrink-0 px-1 py-0 text-[9px] font-medium uppercase tracking-wide">
          {t('reports.templateBadge')}
        </Badge>
      )}
      <button
        type="button"
        aria-label={`pin-${r.id}`}
        onClick={(e) => { e.stopPropagation(); onTogglePin(r.id); }}
        className="opacity-0 transition-opacity group-hover:opacity-100 data-[pinned=true]:opacity-100"
        data-pinned={pinnedIds.includes(r.id)}
      >
        <Star className={cn('h-3.5 w-3.5', pinnedIds.includes(r.id) && 'fill-[#5A9BD6] text-[#5A9BD6]')} />
      </button>
    </div>
  );

  return (
    <aside className="flex min-h-0 w-[230px] flex-1 shrink-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border p-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('reports.searchPlaceholder')}
            className="h-8 pl-7 text-xs"
          />
        </div>
        <Button variant="ghost" size="icon" onClick={onToggleCollapse} aria-label="Collapse library">
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>
      <TooltipProvider delayDuration={400}>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {sections.map((s, idx) => (
            <div key={s.key} className={cn('pb-1', idx > 0 && 'mt-1 border-t border-border pt-2')}>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                {s.label}
              </div>
              {s.items.map((r) => <Row key={`${s.key}-${r.id}`} r={r} />)}
            </div>
          ))}
        </div>
      </TooltipProvider>
    </aside>
  );
}
