import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { DesignElement, DesignPage, Margins, Rect, ReportTemplate } from './types';
import { paperSize } from './model';
import { HANDLES, type Handle } from './geometry';
import { useCanvasInteraction } from './useCanvasInteraction';

const GUIDE_COLOR = '#e0369a'; // distinct alignment-guide color, drawn over the white page

interface Props {
  template: ReportTemplate;
  zoom: number;
  selectedIds: string[];
  onSelect(ids: string[]): void;
  onCommitRects(rects: Map<string, Rect>): void;
}

export function PageCanvas({ template, zoom, selectedIds, onSelect, onCommitRects }: Props): JSX.Element {
  const { t } = useTranslation();
  const size = paperSize(template.paper, template.orientation);
  return (
    <div data-testid="page-canvas"
      className="flex min-h-0 flex-1 flex-col items-center gap-6 overflow-auto bg-neutral-200 p-6 dark:bg-neutral-800">
      {template.pages.map((page, i) => (
        <div key={page.id} className="flex flex-col items-center gap-1.5">
          <PageSurface page={page} zoom={zoom} pageSize={size} margins={template.margins}
            selectedIds={selectedIds} onSelect={onSelect} onCommitRects={onCommitRects} />
          <span className="text-[11px] text-neutral-600 dark:text-neutral-300">
            {t('reportDesigner.pageOf', { n: i + 1, total: template.pages.length })}
          </span>
        </div>
      ))}
    </div>
  );
}

function PageSurface({ page, zoom, pageSize, margins, selectedIds, onSelect, onCommitRects }: {
  page: DesignPage; zoom: number; pageSize: { w: number; h: number }; margins?: Margins;
  selectedIds: string[]; onSelect(ids: string[]): void; onCommitRects(rects: Map<string, Rect>): void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const ix = useCanvasInteraction({ page, zoom, pageSize, selectedIds, originRef: ref, onSelect, onCommitRects });
  return (
    <div ref={ref} data-testid={`page-surface-${page.id}`} onPointerDown={ix.onSurfacePointerDown}
      className="relative bg-white shadow-md ring-1 ring-border" style={{ width: pageSize.w * zoom, height: pageSize.h * zoom }}>
      {page.elements.map((el) => {
        const rect = ix.preview?.get(el.id) ?? el.rect;
        return (
          <ElementBox key={el.id} el={el} rect={rect} zoom={zoom}
            selected={selectedIds.includes(el.id)}
            showHandles={selectedIds.length === 1 && selectedIds[0] === el.id}
            onPointerDown={(e) => ix.onElementPointerDown(e, el.id)}
            onHandlePointerDown={(e, h) => ix.onHandlePointerDown(e, el.id, h)} />
        );
      })}
      {ix.guides.map((g, idx) => (
        <span key={idx} aria-hidden data-testid="guide" style={g.axis === 'x'
          ? { position: 'absolute', left: g.pos * zoom, top: g.from * zoom, height: (g.to - g.from) * zoom, width: 1, background: GUIDE_COLOR, pointerEvents: 'none' }
          : { position: 'absolute', top: g.pos * zoom, left: g.from * zoom, width: (g.to - g.from) * zoom, height: 1, background: GUIDE_COLOR, pointerEvents: 'none' }} />
      ))}
      {ix.marquee && (
        <span aria-hidden data-testid="marquee" className="absolute border border-dashed border-primary bg-primary/10 pointer-events-none"
          style={{ left: ix.marquee.x * zoom, top: ix.marquee.y * zoom, width: ix.marquee.w * zoom, height: ix.marquee.h * zoom }} />
      )}
      {margins && (margins.top || margins.right || margins.bottom || margins.left) ? (
        <span aria-hidden data-testid="margin-guide" className="pointer-events-none absolute border border-dashed border-neutral-300"
          style={{ left: margins.left * zoom, top: margins.top * zoom, right: margins.right * zoom, bottom: margins.bottom * zoom }} />
      ) : null}
    </div>
  );
}

const HANDLE_CLASS: Record<Handle, string> = {
  nw: '-left-1 -top-1 cursor-nwse-resize', n: 'left-1/2 -top-1 -translate-x-1/2 cursor-ns-resize',
  ne: '-right-1 -top-1 cursor-nesw-resize', e: '-right-1 top-1/2 -translate-y-1/2 cursor-ew-resize',
  se: '-right-1 -bottom-1 cursor-nwse-resize', s: 'left-1/2 -bottom-1 -translate-x-1/2 cursor-ns-resize',
  sw: '-left-1 -bottom-1 cursor-nesw-resize', w: '-left-1 top-1/2 -translate-y-1/2 cursor-ew-resize',
};

function ElementBox({ el, rect, zoom, selected, showHandles, onPointerDown, onHandlePointerDown }: {
  el: DesignElement; rect: Rect; zoom: number; selected: boolean; showHandles: boolean;
  onPointerDown(e: ReactPointerEvent): void; onHandlePointerDown(e: ReactPointerEvent, h: Handle): void;
}): JSX.Element {
  const style: CSSProperties = { left: rect.x * zoom, top: rect.y * zoom, width: rect.w * zoom, height: rect.h * zoom };
  return (
    <div role="button" tabIndex={0} aria-label={el.name} data-testid={`el-${el.id}`} onPointerDown={onPointerDown}
      className={cn('absolute cursor-move touch-none', selected && 'outline outline-2 outline-offset-2 outline-primary')}
      style={style}>
      <ElementContent el={el} zoom={zoom} />
      {showHandles && HANDLES.map((h) => (
        <span key={h} data-testid={`handle-${h}`} onPointerDown={(e) => onHandlePointerDown(e, h)}
          className={cn('absolute h-2 w-2 border border-primary bg-white touch-none', HANDLE_CLASS[h])} />
      ))}
    </div>
  );
}

function ElementContent({ el, zoom }: { el: DesignElement; zoom: number }): JSX.Element {
  const s = el.style ?? {};
  switch (el.kind) {
    case 'text':
    case 'datetime':
      return (
        <div className="h-full w-full overflow-hidden leading-tight"
          style={{ fontSize: (s.fontSize ?? 11) * zoom, fontWeight: s.bold ? 600 : 400, textAlign: s.align ?? 'left', color: s.color ?? '#262626' }}>
          {el.text}
        </div>
      );
    case 'line':
      return <div className="w-full" style={{ height: (s.strokeWidth ?? 1) * zoom, background: s.strokeColor ?? '#a3a3a3' }} />;
    case 'rect':
      return <div className="h-full w-full" style={{ border: `${(s.strokeWidth ?? 1) * zoom}px solid ${s.strokeColor ?? '#d4d4d4'}`, background: s.fill && s.fill !== 'none' ? s.fill : 'transparent' }} />;
    case 'image':
      return el.src
        ? <img src={el.src} alt={el.name} className="h-full w-full object-contain" />
        : (
          <div className="flex h-full w-full items-center justify-center border border-dashed border-neutral-300 text-neutral-400">
            <ImageIcon className="h-4 w-4" />
          </div>
        );
    case 'table':
      return (
        <table className="h-full w-full border-collapse text-[8px] text-neutral-700">
          <thead>
            <tr>{(el.columns ?? []).map((c) => (
              <th key={c} className="border border-neutral-300 bg-neutral-100 px-1 py-0.5 text-left font-medium">{c}</th>
            ))}</tr>
          </thead>
          <tbody>
            {(el.rows ?? []).map((r, ri) => (
              <tr key={ri}>{r.map((cell, ci) => (
                <td key={ci} className="border border-neutral-200 px-1 py-0.5">{cell}</td>
              ))}</tr>
            ))}
          </tbody>
        </table>
      );
  }
}
