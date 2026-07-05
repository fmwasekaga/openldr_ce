import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2 } from 'lucide-react';
import type { ModelDimension } from '../../api';

export interface MetricCondition { dimension: string; op: string; value: unknown }

const OPS = ['eq', 'in', 'contains', 'gte', 'lte', 'between'] as const;

function toValue(op: string, raw: string): unknown {
  if (op === 'in' || op === 'between') return raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
  return raw;
}
function toLiteral(v: unknown): string {
  return Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
}

export function MetricConditionEditor({ conditions, dimensions, onChange }: {
  conditions: MetricCondition[]; dimensions: ModelDimension[]; onChange: (c: MetricCondition[]) => void;
}): JSX.Element {
  const update = (i: number, patch: Partial<MetricCondition>) =>
    onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const add = () => onChange([...conditions, { dimension: dimensions[0]?.key ?? '', op: 'eq', value: '' }]);
  const remove = (i: number) => onChange(conditions.filter((_, j) => j !== i));
  return (
    <div className="flex flex-col gap-1">
      {conditions.map((c, i) => (
        <div key={i} className="flex items-center gap-1">
          <select aria-label="Condition field" className="h-7 rounded border border-border bg-background text-xs"
            value={c.dimension} onChange={(e) => update(i, { dimension: e.target.value })}>
            {dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
          <select aria-label="Condition operator" className="h-7 rounded border border-border bg-background text-xs"
            value={c.op} onChange={(e) => update(i, { op: e.target.value, value: toValue(e.target.value, toLiteral(c.value)) })}>
            {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <Input className="h-7 flex-1 text-xs" value={toLiteral(c.value)}
            onChange={(e) => update(i, { value: toValue(c.op, e.target.value) })} />
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Remove condition" onClick={() => remove(i)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="h-7" onClick={add}>Add condition</Button>
    </div>
  );
}
