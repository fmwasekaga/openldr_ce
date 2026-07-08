import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { AlignLeft, AlignCenter, AlignRight, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Margins, Orientation, Paper, Rect, ReportTemplate, TextAlign } from './types';
import { findElement, paperSize } from './model';
import { clampRectToPage } from './geometry';
import { ColorField } from './ColorField';
import { MOCK_REPORTS } from './mockTemplates';

export interface PatchOpts { discrete?: boolean }

interface Props {
  template: ReportTemplate;
  selectedIds: string[];
  onPatchElement(id: string, patch: Partial<import('./types').DesignElement>, opts?: PatchOpts): void;
  onPatchPage(patch: Partial<ReportTemplate>, opts?: PatchOpts): void;
}

function NumberField({ label, value, onChange, min }: { label: string; value: number; onChange(n: number): void; min?: number }): JSX.Element {
  return (
    <div className="flex-1">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <Input type="number" aria-label={label} value={value} min={min}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (e.target.value !== '' && !Number.isNaN(n)) onChange(min != null ? Math.max(min, n) : n);
        }}
        className="h-8 text-xs" />
    </div>
  );
}

function KindControls({ el, onPatch }: {
  el: import('./types').DesignElement;
  onPatch(patch: Partial<import('./types').DesignElement>, opts?: PatchOpts): void;
}): JSX.Element | null {
  const { t } = useTranslation();
  const s = el.style ?? {};
  const style = (patch: Partial<import('./types').ElementStyle>, discrete?: boolean) => onPatch({ style: patch }, discrete ? { discrete: true } : undefined);

  if (el.kind === 'text' || el.kind === 'datetime') {
    const aligns: { v: TextAlign; icon: typeof AlignLeft; label: string }[] = [
      { v: 'left', icon: AlignLeft, label: t('reportDesigner.alignLeft') },
      { v: 'center', icon: AlignCenter, label: t('reportDesigner.alignCenter') },
      { v: 'right', icon: AlignRight, label: t('reportDesigner.alignRight') },
    ];
    return (
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.content')}</div>
          <Textarea aria-label={t('reportDesigner.content')} value={el.text ?? ''} onChange={(e) => onPatch({ text: e.target.value })} className="min-h-[44px] text-xs" />
        </div>
        <div className="flex items-end gap-2">
          <NumberField label={t('reportDesigner.fontSize')} value={s.fontSize ?? 11} onChange={(n) => style({ fontSize: n })} min={4} />
          <Button type="button" variant={s.bold ? 'default' : 'outline'} size="icon" className="h-8 w-8 font-bold"
            aria-label={t('reportDesigner.bold')} onClick={() => style({ bold: !s.bold }, true)}>B</Button>
          <div className="flex h-8 rounded-md border border-border">
            {aligns.map(({ v, icon: Icon, label }) => (
              <button key={v} type="button" aria-label={label} onClick={() => style({ align: v }, true)}
                className={cn('flex w-8 items-center justify-center', (s.align ?? 'left') === v ? 'text-foreground' : 'text-muted-foreground')}>
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.color')}</div>
          <ColorField value={s.color ?? '#000000'} onChange={(c) => style({ color: c }, true)} aria-label={t('reportDesigner.color')} />
        </div>
      </div>
    );
  }

  if (el.kind === 'line' || el.kind === 'rect') {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.strokeColor')}</div>
          <ColorField value={s.strokeColor ?? '#9ca3af'} onChange={(c) => style({ strokeColor: c }, true)} aria-label={t('reportDesigner.strokeColor')} />
        </div>
        <NumberField label={t('reportDesigner.strokeWidth')} value={s.strokeWidth ?? 1} onChange={(n) => style({ strokeWidth: n })} min={1} />
        {el.kind === 'rect' && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.fill')}</div>
            <ColorField value={s.fill ?? 'none'} onChange={(c) => style({ fill: c }, true)} allowNone aria-label={t('reportDesigner.fill')} />
          </div>
        )}
      </div>
    );
  }

  if (el.kind === 'image') {
    return (
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.source')}</div>
        <Input aria-label={t('reportDesigner.source')} value={el.src ?? ''} onChange={(e) => onPatch({ src: e.target.value })} placeholder="https://…" className="h-8 text-xs" />
      </div>
    );
  }

  if (el.kind === 'table') {
    const cols = el.columns ?? [];
    const setCols = (next: string[], discrete?: boolean) => onPatch({ columns: next }, discrete ? { discrete: true } : undefined);
    return (
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.boundReport')}</div>
          <Select value={el.boundReport || ''} onValueChange={(v) => onPatch({ boundReport: v }, { discrete: true })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>{MOCK_REPORTS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.columns')}</div>
          <div className="flex flex-col gap-1">
            {cols.map((c, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input aria-label={`Column ${i + 1}`} value={c} onChange={(e) => setCols(cols.map((x, j) => (j === i ? e.target.value : x)))} className="h-7 text-xs" />
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                  aria-label={t('reportDesigner.removeColumn')} onClick={() => setCols(cols.filter((_, j) => j !== i), true)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="justify-start"
              onClick={() => setCols([...cols, `Column ${cols.length + 1}`], true)}>{t('reportDesigner.addColumn')}</Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export function PropertiesTab({ template, selectedIds, onPatchElement, onPatchPage }: Props): JSX.Element {
  const { t } = useTranslation();
  const selected = selectedIds.length === 1 ? findElement(template, selectedIds[0]) : null;
  const size = paperSize(template.paper, template.orientation);

  if (selectedIds.length > 1) {
    return <div className="p-3 text-xs text-muted-foreground">{t('reportDesigner.selectedCount', { count: selectedIds.length })}</div>;
  }

  if (!selected) {
    const m: Margins = template.margins ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const setMargin = (patch: Partial<Margins>) => onPatchPage({ margins: { ...m, ...patch } });
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.pageSettings')}</div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.paper')}</div>
          <Select value={template.paper} onValueChange={(v) => onPatchPage({ paper: v as Paper }, { discrete: true })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="A4">A4</SelectItem><SelectItem value="Letter">Letter</SelectItem></SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.orientation')}</div>
          <Select value={template.orientation} onValueChange={(v) => onPatchPage({ orientation: v as Orientation }, { discrete: true })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="portrait">portrait</SelectItem><SelectItem value="landscape">landscape</SelectItem></SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.margins')}</div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Margin top" value={m.top} onChange={(top) => setMargin({ top })} min={0} />
            <NumberField label="Margin right" value={m.right} onChange={(right) => setMargin({ right })} min={0} />
            <NumberField label="Margin bottom" value={m.bottom} onChange={(bottom) => setMargin({ bottom })} min={0} />
            <NumberField label="Margin left" value={m.left} onChange={(left) => setMargin({ left })} min={0} />
          </div>
        </div>
      </div>
    );
  }

  const setRect = (patch: Partial<Rect>) => onPatchElement(selected.id, { rect: clampRectToPage({ ...selected.rect, ...patch }, size) });
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {t('reportDesigner.elementLabel')} · {t(`reportDesigner.element.${selected.kind}`)}
      </div>
      {/* KIND CONTROLS INSERTION POINT (Task 6) */}
      <KindControls el={selected} onPatch={(patch, opts) => onPatchElement(selected.id, patch, opts)} />
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.positionSize')}</div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" value={selected.rect.x} onChange={(x) => setRect({ x })} />
          <NumberField label="Y" value={selected.rect.y} onChange={(y) => setRect({ y })} />
          <NumberField label="W" value={selected.rect.w} onChange={(w) => setRect({ w })} min={8} />
          <NumberField label="H" value={selected.rect.h} onChange={(h) => setRect({ h })} min={8} />
        </div>
      </div>
    </div>
  );
}
