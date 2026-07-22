import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Trash2, Plus, FolderPlus } from 'lucide-react';
import type { ModelDimension } from '../../api';
import { OPS, toValue, toLiteral } from './conditionModel';
import {
  addRule, addGroup, updateRule, removeAt, setCombinator,
  type TreeGroup, type TreeNode, type Path,
} from './conditionTree.model';

function GroupView({ group, path, dimensions, onChange, isRoot }: {
  group: TreeGroup; path: Path; dimensions: ModelDimension[];
  onChange: (mutate: (root: TreeGroup) => TreeGroup) => void; isRoot: boolean;
}) {
  return (
    <div className={isRoot ? 'flex flex-col gap-1' : 'flex flex-col gap-1 rounded-md border border-border/70 bg-muted/30 p-2'}>
      <div className="flex items-center gap-1">
        <Select value={group.combinator} onValueChange={(v) => onChange((r) => setCombinator(r, path, v as 'and' | 'or'))}>
          <SelectTrigger aria-label="Match type" className="h-7 w-24 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="and">All</SelectItem>
            <SelectItem value="or">Any</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-[11px] text-muted-foreground">of the following</span>
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Add condition" onClick={() => onChange((r) => addRule(r, path, dimensions))}>
            <Plus className="h-3 w-3" />
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Add group" onClick={() => onChange((r) => addGroup(r, path))}>
            <FolderPlus className="h-3 w-3" />
          </Button>
          {!isRoot && (
            <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Remove group" onClick={() => onChange((r) => removeAt(r, path))}>
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      {group.children.map((child: TreeNode, i) =>
        child.kind === 'group' ? (
          <div key={i} className="ml-3">
            <GroupView group={child} path={[...path, i]} dimensions={dimensions} onChange={onChange} isRoot={false} />
          </div>
        ) : (
          <div key={i} className="ml-3 flex items-center gap-1">
            <Select value={child.dimension} onValueChange={(v) => onChange((r) => updateRule(r, [...path, i], { dimension: v }))}>
              <SelectTrigger aria-label="Filter field" className="h-7 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dimensions.map((d) => (
                  <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={child.op} onValueChange={(v) => onChange((r) => updateRule(r, [...path, i], { op: v, value: toValue(v, toLiteral(child.value)) }))}>
              <SelectTrigger aria-label="Filter operator" className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPS.map((o) => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label="Filter value"
              className="h-7 flex-1 text-xs"
              value={toLiteral(child.value)}
              onChange={(e) => onChange((r) => updateRule(r, [...path, i], { value: toValue(child.op, e.target.value) }))}
            />
            <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Remove filter" onClick={() => onChange((r) => removeAt(r, [...path, i]))}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ),
      )}
    </div>
  );
}

/**
 * Recursive shadcn shell over conditionTree.model.ts. Owns no state transitions itself — every
 * edit routes through a pure helper (addRule/updateRule/…) applied to the whole tree. Radix Selects
 * aren't jsdom-drivable, so behavior is covered by conditionTree.model.test.ts; this gets a render
 * smoke-test only (FilterTreeEditor.test.tsx).
 */
export function FilterTreeEditor({ value, dimensions, onChange }: {
  value: TreeGroup; dimensions: ModelDimension[]; onChange: (t: TreeGroup) => void;
}): JSX.Element {
  return <GroupView group={value} path={[]} dimensions={dimensions} onChange={(mutate) => onChange(mutate(value))} isRoot />;
}
