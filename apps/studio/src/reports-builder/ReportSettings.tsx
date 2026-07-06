import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PageSpec } from '@openldr/report-builder/pure';

export function ReportSettings({ page, onPatch, onOpenParams }: { page: PageSpec; onPatch: (page: PageSpec) => void; onOpenParams: () => void }): JSX.Element {
  const { t } = useTranslation();
  const setMargin = (side: keyof PageSpec['margins'], v: number) => onPatch({ ...page, margins: { ...page.margins, [side]: v } });
  return (
    <div className="flex flex-col gap-3 p-4 text-xs">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportBuilder.settings.heading')}</div>
      <label className="flex flex-col gap-1">{t('reportBuilder.settings.pageSize')}
        <select aria-label={t('reportBuilder.settings.pageSize')} className="h-7 rounded border border-border bg-background text-xs"
          value={page.size} onChange={(e) => onPatch({ ...page, size: e.target.value as PageSpec['size'] })}>
          <option value="A4">A4</option>
          <option value="Letter">Letter</option>
        </select>
      </label>
      <div className="flex flex-col gap-1">{t('reportBuilder.settings.orientation')}
        <div className="flex gap-1">
          {(['portrait', 'landscape'] as const).map((o) => (
            <Button key={o} type="button" size="sm" variant={page.orientation === o ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => onPatch({ ...page, orientation: o })}>{t(`reportBuilder.settings.${o}`)}</Button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">{t('reportBuilder.settings.margins')}
        <div className="grid grid-cols-2 gap-1">
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <label key={side} className="flex items-center gap-1 text-[11px] text-muted-foreground">{t(`reportBuilder.settings.${side}`)}
              <Input aria-label={t(`reportBuilder.settings.${side}`)} type="number" className="h-7 text-xs" value={page.margins[side]} onChange={(e) => setMargin(side, Number(e.target.value))} />
            </label>
          ))}
        </div>
      </div>
      <Button type="button" size="sm" variant="outline" className="h-7" onClick={onOpenParams}>{t('reportBuilder.settings.parameters')}</Button>
    </div>
  );
}
