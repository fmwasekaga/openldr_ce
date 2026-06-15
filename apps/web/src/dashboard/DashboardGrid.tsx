import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './grid.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import GridLayout, { type Layout } from 'react-grid-layout';
import { useDashboardStore } from './store';
import { DashboardWidget } from './DashboardWidget';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { MoreHorizontal, GripVertical, Pencil, Trash2 } from 'lucide-react';

export function DashboardGrid({ filterValues, onEdit }: { filterValues: Record<string, unknown>; onEdit?: (id: string) => void }) {
  const { current, editing, setLayout, removeWidget } = useDashboardStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [resizing, setResizing] = useState<{ i: string; w: number; h: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Items are `static` (locked) when not editing so drag/resize handles never appear.
  const layout = useMemo<Layout[]>(
    () => (current?.layout ?? []).map((l) => ({ ...l, static: !editing }) as Layout),
    [current?.layout, editing],
  );

  if (!current) return null;

  const onLayoutChange = (l: Layout[]) => {
    if (editing) setLayout(l.map((x) => ({ i: x.i, x: x.x, y: x.y, w: x.w, h: x.h })));
  };

  return (
    <div ref={containerRef} className="dash-grid w-full">
      <GridLayout
        className="layout"
        layout={layout}
        cols={12}
        rowHeight={80}
        width={width || 1200}
        isDraggable={editing}
        isResizable={editing}
        draggableHandle=".drag-handle"
        draggableCancel=".no-drag"
        compactType="vertical"
        margin={[16, 16]}
        onLayoutChange={onLayoutChange}
        onResize={(_l, _old, item) => setResizing({ i: item.i, w: item.w, h: item.h })}
        onResizeStop={() => setResizing(null)}
      >
          {current.widgets.map((w) => (
            <div
              key={w.id}
              className={`relative flex flex-col rounded-lg border border-border bg-card ${editing ? 'drag-handle cursor-move' : ''}`}
            >
              <div className="flex items-center justify-between border-b border-border px-2 py-1 text-sm">
                <span className="flex items-center gap-1 font-medium">
                  {editing && <GripVertical className="h-4 w-4 text-muted-foreground" />}
                  {w.title}
                </span>
                {editing && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" aria-label="Widget menu" className="no-drag h-7 w-7">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onEdit?.(w.id)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => removeWidget(w.id)}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <div className={`min-h-0 flex-1 overflow-hidden rounded-b-lg ${editing ? 'pointer-events-none select-none' : ''}`}>
                <DashboardWidget config={w} filterValues={filterValues} />
              </div>
              {resizing?.i === w.id && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                  <span className="rounded border border-border bg-background/90 px-2 py-1 font-mono text-sm text-foreground">
                    {resizing.w} × {resizing.h}
                  </span>
                </div>
              )}
            </div>
          ))}
      </GridLayout>
    </div>
  );
}
