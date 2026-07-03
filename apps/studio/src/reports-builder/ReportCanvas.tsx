import { useMemo } from 'react';
import { computeLayout, type PageSpec, type PositionedBox, type ReportTemplate, type ReportLintIssue } from '@openldr/report-builder/pure';
import { previewLayoutModel } from './reportBuilderModel';
import { createDomMeasurer } from './domMeasurer';
import { CanvasBlock } from './CanvasBlock';
import type { BlockData } from './useBlockData';

export interface CellRef { row: number; cell: number }

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

  return (
    <div className="flex flex-col items-center gap-3 overflow-auto p-4">
      {Array.from({ length: maxPage }, (_, i) => i + 1).map((pageNo) => (
        <div key={pageNo} className="relative bg-white shadow-sm ring-1 ring-border" style={{ width: CANVAS_W, height: ph * scale }}>
          {boxes.filter((b) => b.page === pageNo).map((b) => {
            const isSel = selected?.row === b.rowIndex && selected?.cell === b.cellIndex;
            return (
              <div
                key={`${b.rowIndex}-${b.cellIndex}`}
                data-testid={`canvas-cell-${b.rowIndex}-${b.cellIndex}`}
                data-selected={isSel ? 'true' : 'false'}
                onClick={(e) => { e.stopPropagation(); onSelect(b.rowIndex, b.cellIndex); }}
                className={`absolute cursor-pointer overflow-hidden rounded-sm ${isSel ? 'ring-2 ring-[#378ADD]' : 'ring-1 ring-transparent hover:ring-border'}`}
                style={{ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale, padding: 2 }}
              >
                {(() => { const sev = cellSeverity(b.rowIndex, b.cellIndex); return sev ? (
                  <span data-testid={`lint-marker-${b.rowIndex}-${b.cellIndex}`} className={`pointer-events-none absolute right-1 top-1 z-10 h-2 w-2 rounded-full ${sev === 'error' ? 'bg-destructive' : 'bg-amber-500'}`} />
                ) : null; })()}
                <CanvasBlock block={template.rows[b.rowIndex].cells[b.cellIndex].block} data={data?.get(`${b.rowIndex}:${b.cellIndex}`)} />
              </div>
            );
          })}
          <div className="pointer-events-none absolute bottom-1 right-2 text-[9px] text-muted-foreground">Page {pageNo} / {maxPage}</div>
        </div>
      ))}
    </div>
  );
}
