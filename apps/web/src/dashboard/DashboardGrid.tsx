import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import GridLayout, { type Layout } from 'react-grid-layout';
import { useDashboardStore } from './store';
import { DashboardWidget } from './DashboardWidget';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2, GripVertical } from 'lucide-react';

export function DashboardGrid({ filterValues, onEdit }: { filterValues: Record<string, unknown>; onEdit?: (id: string) => void }) {
  const { current, editing, setLayout, removeWidget } = useDashboardStore();
  if (!current) return null;
  const onLayoutChange = (l: Layout[]) => { if (editing) setLayout(l.map((x) => ({ i: x.i, x: x.x, y: x.y, w: x.w, h: x.h }))); };
  return (
    <GridLayout className="layout" layout={current.layout as Layout[]} cols={12} rowHeight={80} width={1200}
      isDraggable={editing} isResizable={editing} draggableHandle=".drag-handle" compactType="vertical" margin={[16, 16]}
      onLayoutChange={onLayoutChange}>
      {current.widgets.map((w) => (
        <div key={w.id} className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-2 py-1 text-sm">
            <span className="flex items-center gap-1 font-medium">
              {editing && <GripVertical className="drag-handle h-4 w-4 cursor-move text-muted-foreground" />}{w.title}
            </span>
            {editing && (
              <span className="flex gap-1">
                <Button size="icon" variant="ghost" aria-label="edit widget" onClick={() => onEdit?.(w.id)}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label="delete widget" onClick={() => removeWidget(w.id)}><Trash2 className="h-4 w-4" /></Button>
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1"><DashboardWidget config={w} filterValues={filterValues} /></div>
        </div>
      ))}
    </GridLayout>
  );
}
