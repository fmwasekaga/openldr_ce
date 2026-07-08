import { useTranslation } from 'react-i18next';
import { GripVertical } from 'lucide-react';
import type { ReportTemplate } from './types';
import { findElement } from './model';

interface Props { template: ReportTemplate; selectedIds: string[]; }

function Field({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div className="flex-1">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex h-8 items-center rounded-md border border-border bg-muted/30 px-2 text-xs">{value}</div>
    </div>
  );
}

export function PropertiesTab({ template, selectedIds }: Props): JSX.Element {
  const { t } = useTranslation();
  const selected = selectedIds.length === 1 ? findElement(template, selectedIds[0]) : null;

  if (selectedIds.length > 1) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        {t('reportDesigner.selectedCount', { count: selectedIds.length })}
      </div>
    );
  }
  if (!selected) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.pageSettings')}</div>
        <Field label={t('reportDesigner.paper')} value={template.paper} />
        <Field label={t('reportDesigner.orientation')} value={template.orientation} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {t('reportDesigner.elementLabel')} · {t(`reportDesigner.element.${selected.kind}`)}
      </div>
      <div className="flex gap-2">
        <Field label="X" value={selected.rect.x} />
        <Field label="Y" value={selected.rect.y} />
      </div>
      <div className="flex gap-2">
        <Field label="W" value={selected.rect.w} />
        <Field label="H" value={selected.rect.h} />
      </div>
      {selected.kind === 'table' && (
        <>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.boundReport')}</div>
            <div className="flex h-8 items-center rounded-md border border-border bg-muted/30 px-2 text-xs">{selected.boundReport || '—'}</div>
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.columns')}</div>
            <div className="flex flex-col gap-1">
              {(selected.columns ?? []).map((c) => (
                <div key={c} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <GripVertical className="h-3 w-3" /> {c}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
