import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { DesignElement, DesignPage, Rect } from './types';
import { type Handle, type Box, clampRectToPage, clampGroupDelta, resizeRect, boundingBox, boxFromPoints, marqueeHits } from './geometry';
import { type GuideLine, computeMoveGuides, computeResizeGuides, applyResizeSnap } from './alignmentGuides';

const DRAG_THRESHOLD = 4;   // px before a press becomes a drag
const SNAP_SCREEN = 6;      // guide snap threshold in screen px

interface Args {
  page: DesignPage;
  zoom: number;
  pageSize: { w: number; h: number };
  selectedIds: string[];
  originRef: RefObject<HTMLElement>;
  onSelect(ids: string[]): void;
  onCommitRects(rects: Map<string, Rect>): void;
}

type Drag =
  | { mode: 'move'; sx: number; sy: number; base: Map<string, Rect> }
  | { mode: 'resize'; sx: number; sy: number; id: string; handle: Handle; base: Rect }
  | { mode: 'marquee'; sx: number; sy: number; additive: boolean };

export interface CanvasInteraction {
  preview: Map<string, Rect> | null;
  guides: GuideLine[];
  marquee: Box | null;
  onElementPointerDown(e: ReactPointerEvent, id: string): void;
  onHandlePointerDown(e: ReactPointerEvent, id: string, handle: Handle): void;
  onSurfacePointerDown(e: ReactPointerEvent): void;
}

export function useCanvasInteraction(args: Args): CanvasInteraction {
  const latest = useRef(args);
  latest.current = args;

  const dragRef = useRef<Drag | null>(null);
  const movedRef = useRef(false);
  const [preview, setPreview] = useState<Map<string, Rect> | null>(null);
  const previewRef = useRef<Map<string, Rect> | null>(null);
  const setPreviewBoth = (m: Map<string, Rect> | null) => { previewRef.current = m; setPreview(m); };
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);

  const toModel = (clientX: number, clientY: number, zoom: number) => {
    const r = latest.current.originRef.current?.getBoundingClientRect();
    return { x: (clientX - (r?.left ?? 0)) / zoom, y: (clientY - (r?.top ?? 0)) / zoom };
  };

  const end = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    dragRef.current = null;
    setPreviewBoth(null); setGuides([]); setMarquee(null);
  };

  function onMove(e: PointerEvent) {
    const d = dragRef.current; if (!d) return;
    const { page, zoom, pageSize, selectedIds } = latest.current;
    const dx = (e.clientX - d.sx) / zoom, dy = (e.clientY - d.sy) / zoom;
    if (Math.abs(e.clientX - d.sx) > DRAG_THRESHOLD || Math.abs(e.clientY - d.sy) > DRAG_THRESHOLD) movedRef.current = true;
    const thr = SNAP_SCREEN / zoom;

    if (d.mode === 'move') {
      const ids = new Set(d.base.keys());
      const others = page.elements.filter((el) => !ids.has(el.id));
      const baseRects = [...d.base.values()];
      const clamped = clampGroupDelta(baseRects, dx, dy, pageSize);
      const bbox = boundingBox(baseRects.map((r) => ({ ...r, x: r.x + clamped.dx, y: r.y + clamped.dy })))!;
      const snap = computeMoveGuides(bbox, others, pageSize, thr);
      const fdx = clamped.dx + snap.dx, fdy = clamped.dy + snap.dy;
      const next = new Map<string, Rect>();
      for (const [id, r] of d.base) next.set(id, clampRectToPage({ ...r, x: r.x + fdx, y: r.y + fdy }, pageSize));
      setPreviewBoth(next); setGuides(snap.lines);
    } else if (d.mode === 'resize') {
      const others = page.elements.filter((el) => el.id !== d.id);
      let rect = resizeRect(d.base, d.handle, dx, dy);
      const snap = computeResizeGuides(rect, d.handle, others, pageSize, thr);
      rect = clampRectToPage(applyResizeSnap(rect, d.handle, snap), pageSize);
      setPreviewBoth(new Map([[d.id, rect]])); setGuides(snap.lines);
    } else {
      const a = toModel(d.sx, d.sy, zoom), b = toModel(e.clientX, e.clientY, zoom);
      setMarquee(boxFromPoints(a.x, a.y, b.x, b.y));
    }
    void selectedIds;
  }

  function onUp(e: PointerEvent) {
    const d = dragRef.current; if (!d) { end(); return; }
    const { page, zoom, selectedIds, onSelect, onCommitRects } = latest.current;
    if (d.mode === 'move' || d.mode === 'resize') {
      if (movedRef.current && previewRef.current) onCommitRects(previewRef.current);
    } else {
      if (movedRef.current) {
        const a = toModel(d.sx, d.sy, zoom), b = toModel(e.clientX, e.clientY, zoom);
        const hits = marqueeHits(boxFromPoints(a.x, a.y, b.x, b.y), page.elements);
        onSelect(d.additive ? [...new Set([...selectedIds, ...hits])] : hits);
      } else if (!d.additive) {
        onSelect([]);
      }
    }
    end();
  }

  const begin = (drag: Drag) => {
    dragRef.current = drag; movedRef.current = false;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onElementPointerDown = (e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    const { selectedIds, page, onSelect } = latest.current;
    if (e.shiftKey) {
      onSelect(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
      return; // shift-click toggles; no drag
    }
    const ids = selectedIds.includes(id) ? selectedIds : [id];
    if (!selectedIds.includes(id)) onSelect([id]);
    const base = new Map<string, Rect>();
    for (const el of page.elements) if (ids.includes(el.id)) base.set(el.id, el.rect);
    begin({ mode: 'move', sx: e.clientX, sy: e.clientY, base });
  };

  const onHandlePointerDown = (e: ReactPointerEvent, id: string, handle: Handle) => {
    e.stopPropagation();
    const el = latest.current.page.elements.find((x) => x.id === id);
    if (!el) return;
    begin({ mode: 'resize', sx: e.clientX, sy: e.clientY, id, handle, base: el.rect });
  };

  const onSurfacePointerDown = (e: ReactPointerEvent) => {
    begin({ mode: 'marquee', sx: e.clientX, sy: e.clientY, additive: e.shiftKey });
  };

  return { preview, guides, marquee, onElementPointerDown, onHandlePointerDown, onSurfacePointerDown };
}
