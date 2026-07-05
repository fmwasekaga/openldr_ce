import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { QueryEditor } from './QueryEditor';
import type { Block, ReportParam } from '@openldr/report-builder/pure';

const WIDTHS = [3, 4, 6, 8, 12];

export function BlockInspector({ block, colSpan, parameters, sqlEnabled, onPatchBlock, onSetColSpan, onMoveUp, onMoveDown, canMoveUp, canMoveDown, onDelete, onDuplicate, repeat, onSetRepeat }: {
  block: Block; colSpan: number;
  parameters: ReportParam[];
  sqlEnabled: boolean;
  onPatchBlock: (patch: Partial<Block>) => void;
  onSetColSpan: (n: number) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  repeat: 'header' | 'footer' | undefined;
  onSetRepeat: (v: 'header' | 'footer' | undefined) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 p-3 text-sm">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{`${block.kind} ${t('reportBuilder.inspector.blockSuffix')}`}</div>

      {block.kind === 'title' && (
        <label className="flex flex-col gap-1 text-xs">{t('reportBuilder.inspector.text')}
          <Input aria-label={t('reportBuilder.inspector.text')} value={block.text} onChange={(e) => onPatchBlock({ text: e.target.value } as Partial<Block>)} />
        </label>
      )}
      {block.kind === 'text' && (
        <label className="flex flex-col gap-1 text-xs">{t('reportBuilder.inspector.text')}
          <textarea aria-label={t('reportBuilder.inspector.text')} className="min-h-[80px] rounded-md border border-border bg-background p-2 text-sm" value={block.content} onChange={(e) => onPatchBlock({ content: e.target.value } as Partial<Block>)} />
        </label>
      )}
      {(block.kind === 'kpi' || block.kind === 'chart' || block.kind === 'table') && (
        <QueryEditor block={block} parameters={parameters} sqlEnabled={sqlEnabled} onChange={onPatchBlock} />
      )}

      <div className="flex flex-col gap-1 text-xs">{t('reportBuilder.inspector.width')}
        <div className="flex gap-1">
          {WIDTHS.map((w) => (
            <Button key={w} type="button" size="sm" variant={w === colSpan ? 'default' : 'outline'} className="h-7 w-8 p-0" onClick={() => onSetColSpan(w)}>{w}</Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1 text-xs">{t('reportBuilder.inspector.rowOrder')}
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="outline" className="h-7 flex-1" disabled={!canMoveUp} onClick={onMoveUp} aria-label={t('reportBuilder.inspector.moveRowUp')}>{t('reportBuilder.inspector.up')}</Button>
          <Button type="button" size="sm" variant="outline" className="h-7 flex-1" disabled={!canMoveDown} onClick={onMoveDown} aria-label={t('reportBuilder.inspector.moveRowDown')}>{t('reportBuilder.inspector.down')}</Button>
        </div>
      </div>

      <div className="flex flex-col gap-1 text-xs">{t('reportBuilder.inspector.rowRepeat')}
        <div className="flex gap-1">
          {([[t('reportBuilder.inspector.normal'), undefined], [t('reportBuilder.inspector.header'), 'header'], [t('reportBuilder.inspector.footer'), 'footer']] as const).map(([label, val]) => (
            <Button key={label} type="button" size="sm" variant={repeat === val ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => onSetRepeat(val)}>{label}</Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Button type="button" variant="outline" size="sm" className="justify-start" onClick={onDuplicate}>{t('reportBuilder.inspector.duplicate')}</Button>
        <Button type="button" variant="ghost" className="justify-start text-destructive hover:text-destructive" onClick={onDelete}>{t('reportBuilder.inspector.deleteBlock')}</Button>
      </div>
    </div>
  );
}
