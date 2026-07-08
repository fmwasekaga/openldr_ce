import type { MouseEvent, CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { DesignElement, ReportTemplate } from './types';
import { paperSize } from './model';
import { HANDLES, type Handle } from './geometry';

interface Props {
  template: ReportTemplate;
  zoom: number;
  selectedIds: string[];
  onSelect(ids: string[]): void;
}

export function PageCanvas({ template, zoom, selectedIds, onSelect }: Props): JSX.Element {
  const { t } = useTranslation();
  const size = paperSize(template.paper, template.orientation);
  const toggle = (id: string, additive: boolean) =>
    onSelect(additive ? (selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]) : [id]);
  return (
    <div data-testid="page-canvas" onClick={() => onSelect([])}
      className="flex min-h-0 flex-1 flex-col items-center gap-6 overflow-auto bg-neutral-200 p-6 dark:bg-neutral-800">
      {template.pages.map((page, i) => (
        <div key={page.id} className="flex flex-col items-center gap-1.5">
          <div className="relative bg-white shadow-md ring-1 ring-border" style={{ width: size.w * zoom, height: size.h * zoom }}>
            {page.elements.map((el) => (
              <ElementBox key={el.id} el={el} zoom={zoom}
                selected={selectedIds.includes(el.id)}
                showHandles={selectedIds.length === 1 && selectedIds[0] === el.id}
                onSelect={(e) => { e.stopPropagation(); toggle(el.id, e.shiftKey); }} />
            ))}
          </div>
          <span className="text-[11px] text-neutral-600 dark:text-neutral-300">
            {t('reportDesigner.pageOf', { n: i + 1, total: template.pages.length })}
          </span>
        </div>
      ))}
    </div>
  );
}

const HANDLE_CLASS: Record<Handle, string> = {
  nw: '-left-1 -top-1', n: 'left-1/2 -top-1 -translate-x-1/2', ne: '-right-1 -top-1',
  e: '-right-1 top-1/2 -translate-y-1/2', se: '-right-1 -bottom-1', s: 'left-1/2 -bottom-1 -translate-x-1/2',
  sw: '-left-1 -bottom-1', w: '-left-1 top-1/2 -translate-y-1/2',
};

function ElementBox({ el, zoom, selected, showHandles, onSelect }: {
  el: DesignElement; zoom: number; selected: boolean; showHandles: boolean; onSelect(e: MouseEvent): void;
}): JSX.Element {
  const style: CSSProperties = { left: el.rect.x * zoom, top: el.rect.y * zoom, width: el.rect.w * zoom, height: el.rect.h * zoom };
  return (
    <div role="button" tabIndex={0} aria-label={el.name} onClick={onSelect} data-testid={`el-${el.id}`}
      className={cn('absolute cursor-pointer', selected && 'outline outline-2 outline-offset-2 outline-primary')}
      style={style}>
      <ElementContent el={el} />
      {showHandles && HANDLES.map((h) => (
        <span key={h} data-testid={`handle-${h}`} className={cn('absolute h-2 w-2 border border-primary bg-white', HANDLE_CLASS[h])} />
      ))}
    </div>
  );
}

function ElementContent({ el }: { el: DesignElement }): JSX.Element {
  switch (el.kind) {
    case 'text':
    case 'datetime':
      return <div className="h-full w-full overflow-hidden text-[11px] leading-tight text-neutral-800">{el.text}</div>;
    case 'line':
      return <div className="h-px w-full bg-neutral-400" />;
    case 'rect':
      return <div className="h-full w-full border border-neutral-300" />;
    case 'image':
      return (
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
