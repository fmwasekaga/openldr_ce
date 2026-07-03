import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2 } from 'lucide-react';
import type { ModelDimension } from '../api';
import type { ReportParam } from '@openldr/report-builder/pure';

// Studio builder-filter shape (loose, mirrors api.ts WidgetQuery filters).
export interface BuilderFilter { dimension: string; op: string; value: unknown }

const OPS = ['eq', 'in', 'contains', 'gte', 'lte', 'between'] as const;
const PARAM_TOKEN = /^\{\{\s*param\.(\w+)\s*\}\}$/;

function isParamValue(v: unknown): v is string {
  return typeof v === 'string' && PARAM_TOKEN.test(v);
}
function paramId(v: unknown): string {
  return typeof v === 'string' ? (v.match(PARAM_TOKEN)?.[1] ?? '') : '';
}
// Turn a literal input string into the stored value for the given op.
function literalToValue(op: string, raw: string): unknown {
  if (op === 'in' || op === 'between') return raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
  return raw;
}
function valueToLiteral(v: unknown): string {
  return Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
}

export function FilterListEditor({ filters, dimensions, parameters, onChange }: {
  filters: BuilderFilter[];
  dimensions: ModelDimension[];
  parameters: ReportParam[];
  onChange: (f: BuilderFilter[]) => void;
}): JSX.Element {
  const update = (i: number, patch: Partial<BuilderFilter>) =>
    onChange(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const add = () =>
    onChange([...filters, { dimension: dimensions[0]?.key ?? '', op: 'eq', value: '' }]);
  const remove = (i: number) => onChange(filters.filter((_, j) => j !== i));

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Filters</div>
      {filters.map((f, i) => {
        const paramMode = isParamValue(f.value);
        return (
          <div key={i} className="flex flex-col gap-1 rounded border border-border p-2">
            <div className="flex gap-1">
              <select
                aria-label={`filter-${i}-dimension`}
                className="h-7 flex-1 rounded border border-border bg-background text-xs"
                value={f.dimension}
                onChange={(e) => update(i, { dimension: e.target.value })}
              >
                {dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
              <select
                aria-label={`filter-${i}-op`}
                className="h-7 w-20 rounded border border-border bg-background text-xs"
                value={f.op}
                onChange={(e) => update(i, { op: e.target.value })}
              >
                {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <div className="flex">
                <Button
                  type="button" size="sm" className="h-7 rounded-r-none px-2 text-[10px]"
                  aria-label={`filter-${i}-mode-literal`}
                  variant={paramMode ? 'outline' : 'default'}
                  onClick={() => update(i, { value: '' })}
                >Value</Button>
                <Button
                  type="button" size="sm" className="h-7 rounded-l-none px-2 text-[10px]"
                  aria-label={`filter-${i}-mode-param`}
                  variant={paramMode ? 'default' : 'outline'}
                  onClick={() => update(i, { value: `{{param.${parameters[0]?.id ?? ''}}}` })}
                >Param</Button>
              </div>
              {paramMode ? (
                <select
                  aria-label={`filter-${i}-param`}
                  className="h-7 flex-1 rounded border border-border bg-background text-xs"
                  value={paramId(f.value)}
                  onChange={(e) => update(i, { value: `{{param.${e.target.value}}}` })}
                >
                  {parameters.length === 0 && <option value="">(no parameters)</option>}
                  {parameters.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              ) : (
                <Input
                  aria-label={`filter-${i}-value`}
                  className="h-7 flex-1 text-xs"
                  value={valueToLiteral(f.value)}
                  onChange={(e) => update(i, { value: literalToValue(f.op, e.target.value) })}
                />
              )}
              <Button
                type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                aria-label={`filter-${i}-remove`} onClick={() => remove(i)}
              ><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
        );
      })}
      <Button type="button" size="sm" variant="outline" className="h-7" onClick={add}>Add filter</Button>
    </div>
  );
}
