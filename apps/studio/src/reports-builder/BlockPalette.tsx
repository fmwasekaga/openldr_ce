import { useDraggable } from '@dnd-kit/core';
import type { BlockKind } from '@openldr/report-builder/pure';

const KINDS: { kind: BlockKind; label: string }[] = [
  { kind: 'title', label: 'Title' },
  { kind: 'text', label: 'Text' },
  { kind: 'kpi', label: 'KPI' },
  { kind: 'chart', label: 'Chart' },
  { kind: 'table', label: 'Table' },
  { kind: 'image', label: 'Image' },
  { kind: 'divider', label: 'Divider' },
  { kind: 'pageBreak', label: 'Page break' },
];

function PaletteItem({ kind, label, onAdd }: { kind: BlockKind; label: string; onAdd: (k: BlockKind) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette:${kind}`, data: { palette: kind } });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onAdd(kind)}
      className={`flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left text-xs hover:bg-accent ${isDragging ? 'opacity-50' : ''}`}
    >
      <span className="text-muted-foreground">⋮⋮</span>{label}
    </button>
  );
}

export function BlockPalette({ onAdd }: { onAdd: (kind: BlockKind) => void }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Blocks</div>
      {KINDS.map((k) => <PaletteItem key={k.kind} kind={k.kind} label={k.label} onAdd={onAdd} />)}
    </div>
  );
}
