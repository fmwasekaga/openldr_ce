import { useDraggable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { Heading, Type, Gauge, BarChart3, Table, Image as ImageIcon, Minus, SeparatorHorizontal, PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react';
import type { BlockKind } from '@openldr/report-builder/pure';

const KINDS: BlockKind[] = ['title', 'text', 'kpi', 'chart', 'table', 'image', 'divider', 'pageBreak'];
const ICONS: Record<BlockKind, LucideIcon> = { title: Heading, text: Type, kpi: Gauge, chart: BarChart3, table: Table, image: ImageIcon, divider: Minus, pageBreak: SeparatorHorizontal, spacer: Minus };

function PaletteItem({ kind, collapsed, onAdd }: { kind: BlockKind; collapsed: boolean; onAdd: (k: BlockKind) => void }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette:${kind}`, data: { palette: kind } });
  const label = t(`reportBuilder.palette.kind.${kind}`);
  const Icon = ICONS[kind];
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onAdd(kind)}
      aria-label={label}
      title={collapsed ? label : undefined}
      className={`flex w-full items-center rounded-md border border-border py-1.5 text-left text-xs hover:bg-accent ${collapsed ? 'justify-center px-0' : 'gap-2 px-2'} ${isDragging ? 'opacity-50' : ''}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{!collapsed && <span>{label}</span>}
    </button>
  );
}

export function BlockPalette({ collapsed = false, onToggle, onAdd }: { collapsed?: boolean; onToggle?: () => void; onAdd: (kind: BlockKind) => void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5 p-2">
      <button
        type="button"
        onClick={() => onToggle?.()}
        aria-label={collapsed ? t('reportBuilder.palette.expand') : t('reportBuilder.palette.collapse')}
        className="mb-1 flex items-center justify-between gap-1 rounded p-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:bg-accent"
      >
        {!collapsed && <span>{t('reportBuilder.palette.heading')}</span>}
        {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
      </button>
      {KINDS.map((kind) => <PaletteItem key={kind} kind={kind} collapsed={collapsed} onAdd={onAdd} />)}
    </div>
  );
}
