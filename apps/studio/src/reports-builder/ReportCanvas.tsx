import { useMemo } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { computeLayout, type Block, type PageSpec, type PositionedBox, type ReportTemplate, type ReportLintIssue } from '@openldr/report-builder/pure';
import { previewLayoutModel } from './reportBuilderModel';
import { createDomMeasurer } from './domMeasurer';
import { CanvasBlock } from './CanvasBlock';
import type { BlockData } from './useBlockData';

export interface CellRef { row: number; cell: number }

function CanvasCell({ b, scale, isSel, sev, onSelect, block, data }: {
  b: PositionedBox; scale: number; isSel: boolean; sev: 'error' | 'warning' | null;
  onSelect: (row: number, cell: number) => void; block: Block; data?: BlockData;
}): JSX.Element {
  const id = `cell:${b.rowIndex}:${b.cellIndex}`;
  const { setNodeRef: dropRef } = useDroppable({ id });
  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({ id });
  return (
    <div
      ref={dropRef}
      data-testid={`canvas-cell-${b.rowIndex}-${b.cellIndex}`}
      data-selected={isSel ? 'true' : 'false'}
      onClick={(e) => { e.stopPropagation(); onSelect(b.rowIndex, b.cellIndex); }}
      className={`group absolute cursor-pointer overflow-hidden rounded-sm ${isDragging ? 'opacity-40' : ''} ${isSel ? 'ring-2 ring-[#378ADD]' : 'ring-1 ring-transparent hover:ring-border'}`}
      style={{ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale, padding: 2 }}
    >
      {sev && <span data-testid={`lint-marker-${b.rowIndex}-${b.cellIndex}`} className={`pointer-events-none absolute right-1 top-1 z-10 h-2 w-2 rounded-full ${sev === 'error' ? 'bg-destructive' : 'bg-amber-500'}`} />}
      <button
        ref={dragRef}
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        onClick={(e) => e.stopPropagation()}
        className="absolute left-1 top-1 z-10 cursor-grab rounded bg-muted/80 px-1 text-[9px] leading-none text-muted-foreground opacity-0 group-hover:opacity-100"
      >⋮⋮</button>
      <CanvasBlock block={block} data={data} />
    </div>
  );
}

const PAGE_DIMS: Record<PageSpec['size'], [number, number]> = { A4: [595.28, 841.89], Letter: [612, 792] };
const CANVAS_W = 640; // px width the page is scaled to

function pageWH(p: PageSpec): [number, number] {
  const [w, h] = PAGE_DIMS[p.size];
  return p.orientation === 'landscape' ? [h, w] : [w, h];
}

export function ReportCanvas({ template, selected, onSelect, data, issues }: { template: ReportTemplate; selected: CellRef | null; onSelect: (row: number, cell: number) => void; data?: Map<string, BlockData>; issues?: ReportLintIssue[] }): JSX.Element {
  const measurer = useMemo(() => createDomMeasurer(), []);
  const page = template.page as PageSpec;
  const [pw, ph] = pageWH(page);
  const scale = CANVAS_W / pw;
  const tableRowCounts = useMemo(() => {
    const m: Record<string, number> = {};
    data?.forEach((d, k) => { if (d.result) m[k] = d.result.rows.length; });
    return m;
  }, [data]);
  const boxes: PositionedBox[] = useMemo(() => computeLayout(previewLayoutModel(template, tableRowCounts), measurer), [template, tableRowCounts, measurer]);
  const maxPage = boxes.reduce((m, b) => Math.max(m, b.page), 1);
  const cellSeverity = (r: number, c: number): 'error' | 'warning' | null => {
    const matched = (issues ?? []).filter((i) => i.rowIndex === r && i.cellIndex === c);
    if (matched.some((i) => i.severity === 'error')) return 'error';
    return matched.length ? 'warning' : null;
  };

  if (template.rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Drag a block from the palette, or click one to add it.
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 overflow-auto p-4">
      {Array.from({ length: maxPage }, (_, i) => i + 1).map((pageNo) => (
        <div key={pageNo} className="relative bg-white shadow-sm ring-1 ring-border" style={{ width: CANVAS_W, height: ph * scale }}>
          {boxes.filter((b) => b.page === pageNo).map((b) => (
            <CanvasCell
              key={`${b.rowIndex}-${b.cellIndex}`}
              b={b}
              scale={scale}
              isSel={selected?.row === b.rowIndex && selected?.cell === b.cellIndex}
              sev={cellSeverity(b.rowIndex, b.cellIndex)}
              onSelect={onSelect}
              block={template.rows[b.rowIndex].cells[b.cellIndex].block}
              data={data?.get(`${b.rowIndex}:${b.cellIndex}`)}
            />
          ))}
          <div className="pointer-events-none absolute bottom-1 right-2 text-[9px] text-muted-foreground">Page {pageNo} / {maxPage}</div>
        </div>
      ))}
    </div>
  );
}
