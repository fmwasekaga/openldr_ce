import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { Block } from '@openldr/report-builder/pure';

const WIDTHS = [3, 4, 6, 8, 12];

export function BlockInspector({ block, colSpan, onPatchBlock, onSetColSpan, onMoveUp, onMoveDown, canMoveUp, canMoveDown, onDelete }: {
  block: Block; colSpan: number;
  onPatchBlock: (patch: Partial<Block>) => void;
  onSetColSpan: (n: number) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onDelete: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4 p-3 text-sm">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{block.kind} block</div>

      {block.kind === 'title' && (
        <label className="flex flex-col gap-1 text-xs">Text
          <Input aria-label="Text" value={block.text} onChange={(e) => onPatchBlock({ text: e.target.value } as Partial<Block>)} />
        </label>
      )}
      {block.kind === 'text' && (
        <label className="flex flex-col gap-1 text-xs">Text
          <textarea aria-label="Text" className="min-h-[80px] rounded-md border border-border bg-background p-2 text-sm" value={block.content} onChange={(e) => onPatchBlock({ content: e.target.value } as Partial<Block>)} />
        </label>
      )}
      {(block.kind === 'kpi' || block.kind === 'chart' || block.kind === 'table') && (
        <p className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">Configure this block's data in the next step.</p>
      )}

      <div className="flex flex-col gap-1 text-xs">Width
        <div className="flex gap-1">
          {WIDTHS.map((w) => (
            <Button key={w} type="button" size="sm" variant={w === colSpan ? 'default' : 'outline'} className="h-7 w-8 p-0" onClick={() => onSetColSpan(w)}>{w}</Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1 text-xs">Row order
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="outline" className="h-7 flex-1" disabled={!canMoveUp} onClick={onMoveUp} aria-label="Move row up">↑ Up</Button>
          <Button type="button" size="sm" variant="outline" className="h-7 flex-1" disabled={!canMoveDown} onClick={onMoveDown} aria-label="Move row down">↓ Down</Button>
        </div>
      </div>

      <Button type="button" variant="ghost" className="justify-start text-destructive hover:text-destructive" onClick={onDelete}>Delete block</Button>
    </div>
  );
}
