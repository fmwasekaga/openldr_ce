import type { Block } from '@openldr/report-builder/pure';
import { renderWidget } from '../dashboard/widgets';
import { blockToWidgetConfig } from './blockToWidgetConfig';
import type { BlockData } from './useBlockData';

export function CanvasBlock({ block, data }: { block: Block; data?: BlockData }): JSX.Element {
  const isData = block.kind === 'kpi' || block.kind === 'chart' || block.kind === 'table';
  if (isData && data) {
    if (data.loading) return <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">Loading…</div>;
    if (data.error) return <div className="flex h-full items-center justify-center px-1 text-center text-[10px] text-destructive">{data.error}</div>;
    if (data.result) return <div className="h-full w-full">{renderWidget(blockToWidgetConfig(block, data.result), data.result)}</div>;
  }
  switch (block.kind) {
    case 'title':
      return <div style={{ fontSize: block.style?.fontSize ?? 14, fontWeight: block.style?.bold ? 600 : 500, textAlign: block.style?.align ?? 'left' }}>{block.text || <span className="text-muted-foreground">Title</span>}</div>;
    case 'text':
      return <div style={{ fontSize: block.style?.fontSize ?? 11, fontStyle: block.style?.italic ? 'italic' : undefined, textAlign: block.style?.align ?? 'left', whiteSpace: 'pre-wrap' }}>{block.content || <span className="text-muted-foreground">Text</span>}</div>;
    case 'kpi':
      return <div className="flex h-full flex-col items-center justify-center"><span className="text-[10px] text-muted-foreground">{block.label || 'KPI'}</span><span className="text-xl font-medium">123</span></div>;
    case 'chart':
      return <div className="flex h-full items-center justify-center rounded border border-dashed border-border text-[11px] text-muted-foreground">{block.chartType} chart</div>;
    case 'table':
      return <div className="rounded border border-dashed border-border p-1 text-[10px] text-muted-foreground">Table{block.source === 'primary' ? ' · primary dataset' : ''}</div>;
    case 'image':
      return <div className="flex h-full items-center justify-center rounded border border-dashed border-border text-[11px] text-muted-foreground">{block.src === 'org-logo' ? 'Logo' : 'Image'}</div>;
    case 'divider':
      return <div className="w-full border-t border-border" />;
    case 'spacer':
      return <div className="h-full" />;
    case 'pageBreak':
      return <div className="text-center text-[10px] text-muted-foreground">— page break —</div>;
    default:
      return <div />;
  }
}
