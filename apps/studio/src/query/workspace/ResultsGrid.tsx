// apps/studio/src/query/workspace/ResultsGrid.tsx
// Excel-like results grid backed by @glideapps/glide-data-grid (parity with the workbench
// prototype): cell/range selection, copy (TSV via getCellsForSelection), header type icons and
// a selection status bar. The glide theme is built from the app's CSS token vars so it tracks
// light/dark. glide is canvas-based, so it renders nothing until the container has a measured
// size — which also makes it a no-op under jsdom (getBoundingClientRect is 0 there), keeping
// unit tests on the surrounding DOM (pagination/status/error), not canvas cells.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataEditor, GridCellKind } from '@glideapps/glide-data-grid';
import type { GridCell, GridColumn, GridSelection, Item, Theme } from '@glideapps/glide-data-grid';
import type { RunResult } from '../api';
import { StripedEmpty } from '@/components/ui/striped-empty';

type ColType = 'pk' | 'num' | 'bool' | 'text';

function inferType(key: string, rows: Record<string, unknown>[]): ColType {
  for (const r of rows) {
    const v = r[key];
    if (v === null || v === undefined) continue;
    if (typeof v === 'boolean') return 'bool';
    if (typeof v === 'number') return key === 'id' ? 'pk' : 'num';
    return 'text';
  }
  return key === 'id' ? 'pk' : 'text';
}

function readVar(cs: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = cs.getPropertyValue(name).trim();
  return v || fallback;
}

/** Build a glide theme from the app's CSS custom properties (so it follows the active theme). */
function buildTheme(): Partial<Theme> {
  if (typeof document === 'undefined') return {};
  const cs = getComputedStyle(document.documentElement);
  const bg = readVar(cs, '--bg', '#171717');
  const card = readVar(cs, '--card', bg);
  const sidebar = readVar(cs, '--sidebar', bg);
  const border = readVar(cs, '--border', '#2e2e2e');
  const rule = readVar(cs, '--rule', border);
  const text = readVar(cs, '--text', '#fafafa');
  const muted = readVar(cs, '--text-muted', '#898989');
  const tableHead = readVar(cs, '--table-head', sidebar);
  const brand = readVar(cs, '--brand', '#4682B4');
  const brandWash = readVar(cs, '--brand-wash', 'rgba(70,130,180,0.15)');
  const link = readVar(cs, '--link', brand);
  return {
    accentColor: brand, accentFg: '#ffffff', accentLight: brandWash,
    textDark: text, textMedium: muted, textLight: muted, textBubble: text,
    bgIconHeader: muted, fgIconHeader: bg, textHeader: text, textHeaderSelected: '#ffffff',
    bgCell: bg, bgCellMedium: card, bgHeader: tableHead, bgHeaderHasFocus: border, bgHeaderHovered: border,
    borderColor: border, horizontalBorderColor: rule, drilldownBorder: border, linkColor: link,
    cellHorizontalPadding: 12, cellVerticalPadding: 8,
    headerFontStyle: '500 12px', baseFontStyle: '13px', editorFontSize: '13px',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  };
}

export function ResultsGrid({ result }: { result: Omit<RunResult, 'ms'> | null }): JSX.Element {
  const [selection, setSelection] = useState<GridSelection | undefined>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [theme, setTheme] = useState<Partial<Theme>>(() => buildTheme());

  // Measure the container ourselves and hand glide explicit pixel dimensions (its "100%"
  // auto-sizer can miss a container that grows after mount).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = { width: Math.floor(r.width), height: Math.floor(r.height) };
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Fallback: in a nested flex layout the container can start at zero size and grow after mount
    // without a reliable ResizeObserver notification, so poll for a short window until a non-zero
    // size is seen (the observer handles resizes after that).
    let timer = 0;
    let ticks = 0;
    const poll = () => {
      measure();
      const r = el.getBoundingClientRect();
      if ((r.width === 0 || r.height === 0) && ticks++ < 40) timer = window.setTimeout(poll, 50);
    };
    timer = window.setTimeout(poll, 50);
    return () => { ro.disconnect(); window.clearTimeout(timer); };
  }, []);

  // Rebuild the glide theme whenever the app theme (data-theme) flips.
  useEffect(() => {
    const update = () => setTheme(buildTheme());
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  const columns = result?.columns ?? [];
  const rows = result?.rows ?? [];
  const colTypes = useMemo(() => columns.map((c) => inferType(c.key, rows)), [columns, rows]);
  const gridColumns = useMemo<GridColumn[]>(
    () => columns.map((c) => ({ title: c.label, id: c.key, width: 160 })),
    [columns],
  );

  const getCellContent = useCallback((cell: Item): GridCell => {
    const [col, row] = cell;
    const c = columns[col];
    const t = colTypes[col];
    const value = c ? rows[row]?.[c.key] : undefined;
    if (t === 'bool') {
      const s = String(value ?? '');
      return { kind: GridCellKind.Text, data: s, displayData: s, allowOverlay: false,
        themeOverride: { textDark: Boolean(value) ? '#22c55e' : '#ef4444' } };
    }
    if (t === 'num' || t === 'pk') {
      return { kind: GridCellKind.Number, data: typeof value === 'number' ? value : undefined,
        displayData: value == null ? '' : String(value), allowOverlay: false, contentAlign: 'left' };
    }
    const s = String(value ?? '');
    return { kind: GridCellKind.Text, data: s, displayData: s, allowOverlay: false };
  }, [columns, colTypes, rows]);

  const stats = useMemo(() => {
    const range = selection?.current?.range;
    if (!range || range.width === 0 || range.height === 0) return null;
    return { rows: range.height, cols: range.width, cells: range.width * range.height };
  }, [selection]);

  // The measured container is ALWAYS rendered (never behind an early return) so the sizing
  // effect can attach on mount and pick up the size once data arrives.
  const hasData = !!result && result.columns.length > 0;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div ref={scrollRef} className="min-h-0 min-w-0 flex-1">
        {hasData && size.width > 0 && size.height > 0 ? (
          <DataEditor
            columns={gridColumns}
            getCellContent={getCellContent}
            rows={rows.length}
            rowHeight={34}
            headerHeight={36}
            theme={theme}
            gridSelection={selection}
            onGridSelectionChange={setSelection}
            rowMarkers="checkbox-visible"
            rangeSelect="multi-rect"
            columnSelect="multi"
            rowSelect="multi"
            getCellsForSelection
            smoothScrollX
            smoothScrollY
            width={size.width}
            height={size.height}
          />
        ) : (
          <StripedEmpty>{result ? 'No rows' : 'No results'}</StripedEmpty>
        )}
      </div>
      {stats && (
        <div className="flex h-6 shrink-0 items-center gap-2 border-t border-border px-3 text-[11px] text-muted-foreground">
          <span>{stats.rows}R &times; {stats.cols}C</span>
          <span className="opacity-50">&middot;</span>
          <span>{stats.cells} cells</span>
          <span className="ml-1 opacity-60">&#8984;C to copy</span>
        </div>
      )}
    </div>
  );
}
