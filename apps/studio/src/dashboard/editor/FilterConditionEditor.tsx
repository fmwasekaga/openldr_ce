import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Trash2 } from 'lucide-react';
import type { ModelDimension } from '../../api';
import { OPS, toLiteral, toValue, addCondition, updateCondition, removeCondition, setBound, type FilterCondition } from './conditionModel';

export type { FilterCondition };

/**
 * Thin shadcn shell over conditionModel.ts's pure functions — this component owns no state
 * transitions itself, only rendering + wiring onValueChange/onClick to the pure helpers. Radix
 * Select isn't reliably drivable in jsdom (see WidgetEditorDialog.test.tsx), so behavior is
 * covered by conditionModel.test.ts; this component gets a render smoke-test only.
 */
export function FilterConditionEditor({ value, dimensions, dashboardFilters = [], bindings = {}, onChange, onBindingsChange }: {
  value: FilterCondition[]; dimensions: ModelDimension[];
  dashboardFilters?: { id: string; label: string }[]; bindings?: Record<string, string>;
  onChange: (c: FilterCondition[]) => void; onBindingsChange?: (b: Record<string, string>) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      {value.map((c, i) => {
        const boundFilterId = bindings[c.dimension];
        const bound = !!boundFilterId;
        return (
          <div key={i} className="flex items-center gap-1">
            <Select value={c.dimension} onValueChange={(v) => onChange(updateCondition(value, i, { dimension: v }))}>
              <SelectTrigger aria-label="Filter field" className="h-7 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dimensions.map((d) => (
                  <SelectItem key={d.key} value={d.key}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={c.op} onValueChange={(v) => onChange(updateCondition(value, i, { op: v, value: toValue(v, toLiteral(c.value)) }))}>
              <SelectTrigger aria-label="Filter operator" className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPS.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {dashboardFilters.length > 0 && (
              <div className="inline-flex shrink-0 overflow-hidden rounded border border-input text-[10px]">
                <button
                  type="button"
                  aria-pressed={!bound}
                  onClick={() => onBindingsChange?.(setBound(bindings, c.dimension, null))}
                  className={`px-1.5 py-0.5 ${!bound ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                >
                  {t('widgetEditor.bindValue')}
                </button>
                <button
                  type="button"
                  aria-pressed={bound}
                  onClick={() => onBindingsChange?.(setBound(bindings, c.dimension, boundFilterId ?? dashboardFilters[0]?.id ?? ''))}
                  className={`px-1.5 py-0.5 ${bound ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                >
                  {t('widgetEditor.bindDashboardFilter')}
                </button>
              </div>
            )}
            {bound ? (
              <Select value={boundFilterId} onValueChange={(v) => onBindingsChange?.(setBound(bindings, c.dimension, v))}>
                <SelectTrigger aria-label="Bound dashboard filter" className="h-7 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dashboardFilters.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                aria-label="Filter value"
                className="h-7 flex-1 text-xs"
                value={toLiteral(c.value)}
                onChange={(e) => onChange(updateCondition(value, i, { value: toValue(c.op, e.target.value) }))}
              />
            )}
            <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Remove filter" onClick={() => onChange(removeCondition(value, i))}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        );
      })}
      <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => onChange(addCondition(value, dimensions))}>
        Add filter
      </Button>
    </div>
  );
}
