import { useTranslation } from 'react-i18next';
import type { Block } from '@openldr/report-builder/pure';
import { resultToChartData, chartOpts } from '@openldr/report-builder/pure';
import { renderWidget } from '../dashboard/widgets';
import { blockToWidgetConfig } from './blockToWidgetConfig';
import { ReportChart } from './ReportChart';
import type { BlockData } from './useBlockData';

export function CanvasBlock({ block, data }: { block: Block; data?: BlockData }): JSX.Element {
  const { t } = useTranslation();
  const isData = block.kind === 'kpi' || block.kind === 'chart' || block.kind === 'table';
  if (isData && data) {
    if (data.loading) return <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">{t('common.loading')}</div>;
    if (data.error) return <div className="flex h-full items-center justify-center px-1 text-center text-[10px] text-destructive">{data.error}</div>;
    if (data.result) {
      if (block.kind === 'chart') {
        const cd = resultToChartData(data.result, { title: '', ...chartOpts(block.query) });
        return <div className="h-full w-full"><ReportChart chartType={block.chartType} data={cd} /></div>;
      }
      return <div className="h-full w-full">{renderWidget(blockToWidgetConfig(block, data.result), data.result)}</div>;
    }
  }
  switch (block.kind) {
    case 'title':
      return <div style={{ fontSize: block.style?.fontSize ?? 14, fontWeight: block.style?.bold ? 600 : 500, textAlign: block.style?.align ?? 'left' }}>{block.text || <span className="text-muted-foreground">{t('reportBuilder.canvas.title')}</span>}</div>;
    case 'text':
      return <div style={{ fontSize: block.style?.fontSize ?? 11, fontStyle: block.style?.italic ? 'italic' : undefined, textAlign: block.style?.align ?? 'left', whiteSpace: 'pre-wrap' }}>{block.content || <span className="text-muted-foreground">{t('reportBuilder.canvas.text')}</span>}</div>;
    case 'kpi':
      return <div className="flex h-full flex-col items-center justify-center"><span className="text-[10px] text-muted-foreground">{block.label || t('reportBuilder.canvas.kpi')}</span><span className="text-xl font-medium">{t('reportBuilder.canvas.kpiPlaceholder')}</span></div>;
    case 'chart':
      return <div className="flex h-full items-center justify-center rounded border border-dashed border-border text-[11px] text-muted-foreground">{`${block.chartType} ${t('reportBuilder.canvas.chartSuffix')}`}</div>;
    case 'table':
      return <div className="rounded border border-dashed border-border p-1 text-[10px] text-muted-foreground">{t('reportBuilder.palette.kind.table')}{block.source === 'primary' ? t('reportBuilder.canvas.tablePrimarySuffix') : ''}</div>;
    case 'image':
      return <div className="flex h-full items-center justify-center rounded border border-dashed border-border text-[11px] text-muted-foreground">{block.src === 'org-logo' ? t('reportBuilder.canvas.logo') : t('reportBuilder.canvas.image')}</div>;
    case 'divider':
      return <div className="w-full border-t border-border" />;
    case 'spacer':
      return <div className="h-full" />;
    case 'pageBreak':
      return <div className="text-center text-[10px] text-muted-foreground">{t('reportBuilder.canvas.pageBreak')}</div>;
    default:
      return <div />;
  }
}
