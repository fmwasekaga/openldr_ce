import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import type { Margins, Orientation, Paper, Rect, ReportTemplate } from './types';
import { findElement, paperSize } from './model';
import { clampRectToPage } from './geometry';

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
