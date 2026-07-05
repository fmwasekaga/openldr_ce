import { useDraggable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import type { BlockKind } from '@openldr/report-builder/pure';

const KINDS: BlockKind[] = ['title', 'text', 'kpi', 'chart', 'table', 'image', 'divider', 'pageBreak'];

function PaletteItem({ kind, onAdd }: { kind: BlockKind; onAdd: (k: BlockKind) => void }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette:${kind}`, data: { palette: kind } });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onAdd(kind)}
      className={`flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left text-xs hover:bg-accent ${isDragging ? 'opacity-50' : ''}`}
    >
      <span className="text-muted-foreground">⋮⋮</span>{t(`reportBuilder.palette.kind.${kind}`)}
    </button>
  );
}

export function BlockPalette({ onAdd }: { onAdd: (kind: BlockKind) => void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5 p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportBuilder.palette.heading')}</div>
      {KINDS.map((kind) => <PaletteItem key={kind} kind={kind} onAdd={onAdd} />)}
    </div>
  );
}
