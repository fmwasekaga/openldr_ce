import { useTranslation } from 'react-i18next';
import {
  Plus, ChevronDown, Minus, Eye, MoreHorizontal,
  Type, Table2, Image as ImageIcon, Square, CalendarClock,
  Save, FileText, FileSpreadsheet, ShieldCheck, Copy, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { ElementKind } from './types';
import { ELEMENT_KINDS } from './model';

const KIND_ICON: Record<ElementKind, typeof Type> = {
  text: Type, table: Table2, image: ImageIcon, line: Minus, rect: Square, datetime: CalendarClock,
};

interface Props {
  name: string;
  zoom: number;
  onNameChange(name: string): void;
  onInsert(kind: ElementKind): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onPreview(): void;
  onSave(): void;
  onExportPdf(): void;
  onExportExcel(): void;
  onCheck(): void;
  onDuplicate(): void;
  onDelete(): void;
}

export function CanvasHeader(props: Props): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
      <Input value={props.name} onChange={(e) => props.onNameChange(e.target.value)}
        aria-label={t('reportDesigner.reportName')} className="h-8 max-w-xs text-sm font-medium" />

      <div className="flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1">
              <Plus className="h-4 w-4" /> {t('reportDesigner.insert')} <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {ELEMENT_KINDS.map((kind) => {
              const Icon = KIND_ICON[kind];
              return (
                <DropdownMenuItem key={kind} onSelect={() => props.onInsert(kind)}>
                  <Icon className="mr-2 h-4 w-4" /> {t(`reportDesigner.element.${kind}`)}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center rounded-md border border-border">
          <button onClick={props.onZoomOut} aria-label={t('reportDesigner.zoomOut')}
            className="rounded-l-md p-1 text-muted-foreground hover:bg-accent">
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[3rem] text-center text-xs tabular-nums text-muted-foreground">{Math.round(props.zoom * 100)}%</span>
          <button onClick={props.onZoomIn} aria-label={t('reportDesigner.zoomIn')}
            className="rounded-r-md p-1 text-muted-foreground hover:bg-accent">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <Button size="sm" variant="outline" className="gap-1" onClick={props.onPreview}>
          <Eye className="h-4 w-4" /> {t('reportDesigner.preview')}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="outline" aria-label={t('reportDesigner.moreActions')}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={props.onSave}><Save className="mr-2 h-4 w-4" /> {t('reportDesigner.save')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onExportPdf}><FileText className="mr-2 h-4 w-4" /> {t('reportDesigner.exportPdf')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onExportExcel}><FileSpreadsheet className="mr-2 h-4 w-4" /> {t('reportDesigner.exportExcel')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onCheck}><ShieldCheck className="mr-2 h-4 w-4" /> {t('reportDesigner.check')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onDuplicate}><Copy className="mr-2 h-4 w-4" /> {t('reportDesigner.duplicate')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={props.onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 h-4 w-4" /> {t('reportDesigner.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
