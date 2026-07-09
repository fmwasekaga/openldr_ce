import { useTranslation } from 'react-i18next';
import {
  Plus, Minus, Eye, MoreHorizontal, Undo2, Redo2,
  FilePlus, Save, Download, FileText, FileSpreadsheet, ShieldCheck, Copy, Trash2,
  Check, Loader2, Share2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import type { ElementKind } from './types';
import type { SaveStatus } from './ReportDesignerPage';
import { ELEMENT_KINDS } from './model';
import { KIND_ICON } from './elementIcons';

interface Props {
  name: string;
  zoom: number;
  saveStatus: SaveStatus;
  onNameChange(name: string): void;
  onNewTemplate(): void;
  onInsert(kind: ElementKind): void;
  onUndo(): void;
  onRedo(): void;
  canUndo: boolean;
  canRedo: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onPreview(): void;
  onSave(): void;
  onExportPdf(): void;
  onExportExcel(): void;
  onPublishAsReport(): void;
  onCheck(): void;
  onDuplicate(): void;
  onDelete(): void;
}

export function CanvasHeader(props: Props): JSX.Element {
  const { t } = useTranslation();
  const status = props.saveStatus;
  return (
    <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
      <div className="flex min-w-0 items-center gap-2">
        <Input value={props.name} onChange={(e) => props.onNameChange(e.target.value)}
          aria-label={t('reportDesigner.reportName')} className="h-8 max-w-xs text-sm font-medium" />
        <span data-testid="save-status"
          className={`flex shrink-0 items-center gap-1 text-[11px] ${status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
          {status === 'saved' && <Check className="h-3 w-3" />}
          {status === 'saving' && <Loader2 className="h-3 w-3 animate-spin" />}
          {status === 'saved' && t('reportDesigner.saved')}
          {status === 'saving' && t('reportDesigner.saving')}
          {status === 'unsaved' && t('reportDesigner.unsaved')}
          {status === 'error' && t('reportDesigner.saveFailed')}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <div className="flex items-center rounded-md border border-border">
          <button onClick={props.onUndo} disabled={!props.canUndo} aria-label={t('reportDesigner.undo')}
            className="rounded-l-md p-1 text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent">
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={props.onRedo} disabled={!props.canRedo} aria-label={t('reportDesigner.redo')}
            className="rounded-r-md p-1 text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent">
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>

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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="outline" aria-label={t('reportDesigner.moreActions')}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={props.onNewTemplate}><FilePlus className="mr-2 h-4 w-4" /> {t('reportDesigner.newTemplate')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><span className="flex items-center"><Plus className="mr-2 h-4 w-4" /> {t('reportDesigner.insert')}</span></DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {ELEMENT_KINDS.map((kind) => {
                  const Icon = KIND_ICON[kind];
                  return (
                    <DropdownMenuItem key={kind} onSelect={() => props.onInsert(kind)}>
                      <Icon className="mr-2 h-4 w-4" /> {t(`reportDesigner.element.${kind}`)}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={props.onPreview}><Eye className="mr-2 h-4 w-4" /> {t('reportDesigner.preview')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onSave}><Save className="mr-2 h-4 w-4" /> {t('reportDesigner.save')}</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><span className="flex items-center"><Download className="mr-2 h-4 w-4" /> {t('reportDesigner.export')}</span></DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={props.onExportPdf}><FileText className="mr-2 h-4 w-4" /> PDF</DropdownMenuItem>
                <DropdownMenuItem onSelect={props.onExportExcel}><FileSpreadsheet className="mr-2 h-4 w-4" /> Excel</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={props.onPublishAsReport}><Share2 className="mr-2 h-4 w-4" /> {t('reportDesigner.publishAsReport')}</DropdownMenuItem>
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
