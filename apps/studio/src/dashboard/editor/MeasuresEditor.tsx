import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { ChevronDown, ChevronRight, Plus, Sigma, Trash2 } from 'lucide-react';
import type { QueryModel } from '../../api';
import { addMeasure, addFormula, updateMeasure, removeMeasure, aggregateMeasures, type Measure } from './measures.model';
import { OPS, toValue, toLiteral, addCondition, updateCondition, removeCondition, type FilterCondition } from './conditionModel';

// Local agg vocabulary (mirrors @openldr/dashboards AGGS) — kept here to avoid pulling the package
// root into the browser bundle.
const AGGS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const;

export function MeasuresEditor({ value, model, onChange }: {
  value: Measure[]; model?: QueryModel; onChange: (list: Measure[]) => void;
}): JSX.Element {
  const [open, setOpen] = useState<number | null>(null);
  const dims = model?.dimensions ?? [];
  const aggChoices = aggregateMeasures(value);
  return (
    <div className="flex flex-col gap-1">
      {value.map((m, i) => {
        const expanded = open === i;
        const isFormula = !!m.derived;
        return (
          <div key={i} className="rounded-md border border-border/70">
            <div className="flex items-center gap-1 px-2 py-1">
              <button type="button" aria-label="Toggle measure" className="text-muted-foreground" onClick={() => setOpen(expanded ? null : i)}>
                {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
              <span className="flex-1 truncate text-xs">
                {m.label || m.key} <span className="text-muted-foreground">{isFormula ? '· formula' : `· ${m.agg}`}</span>
              </span>
              <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0" aria-label="Remove measure" onClick={() => { onChange(removeMeasure(value, i)); setOpen(null); }}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            {expanded && (
              <div className="flex flex-col gap-2 border-t border-border/70 p-2">
                {isFormula ? (
                  <>
                    <div className="flex items-center gap-1">
                      <Select value={m.derived!.numerator} onValueChange={(v) => onChange(updateMeasure(value, i, { derived: { ...m.derived!, numerator: v } }))}>
                        <SelectTrigger aria-label="Numerator" className="h-7 flex-1 text-xs"><SelectValue placeholder="Numerator" /></SelectTrigger>
                        <SelectContent>{aggChoices.map((a) => <SelectItem key={a.key} value={a.key}>{a.label || a.key}</SelectItem>)}</SelectContent>
                      </Select>
                      <span className="text-xs text-muted-foreground">÷</span>
                      <Select value={m.derived!.denominator} onValueChange={(v) => onChange(updateMeasure(value, i, { derived: { ...m.derived!, denominator: v } }))}>
                        <SelectTrigger aria-label="Denominator" className="h-7 flex-1 text-xs"><SelectValue placeholder="Denominator" /></SelectTrigger>
                        <SelectContent>{aggChoices.map((a) => <SelectItem key={a.key} value={a.key}>{a.label || a.key}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-1">
                      <Select value={String(m.derived!.scale)} onValueChange={(v) => onChange(updateMeasure(value, i, { derived: { ...m.derived!, scale: Number(v) } }))}>
                        <SelectTrigger aria-label="Format" className="h-7 flex-1 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="100">Percent (×100)</SelectItem><SelectItem value="1">Number</SelectItem></SelectContent>
                      </Select>
                      <Input aria-label="Decimals" type="number" min={0} max={4} className="h-7 w-16 text-xs" value={m.derived!.decimals} onChange={(e) => onChange(updateMeasure(value, i, { derived: { ...m.derived!, decimals: Number(e.target.value) } }))} />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1">
                      <Select value={m.agg} onValueChange={(v) => onChange(updateMeasure(value, i, { agg: v }))}>
                        <SelectTrigger aria-label="Aggregate" className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{AGGS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                      </Select>
                      {m.agg !== 'count' && (
                        <Input aria-label="Column" className="h-7 flex-1 text-xs" placeholder="column" value={m.column ?? ''} onChange={(e) => onChange(updateMeasure(value, i, { column: e.target.value || undefined }))} />
                      )}
                    </div>
                    <WhereEditor value={(m.where ?? []) as FilterCondition[]} dims={dims} onChange={(w) => onChange(updateMeasure(value, i, { where: w.length ? (w as Measure['where']) : undefined }))} />
                  </>
                )}
                <Input aria-label="Measure label" className="h-7 text-xs" placeholder="Label" value={m.label ?? ''} onChange={(e) => onChange(updateMeasure(value, i, { label: e.target.value || undefined }))} />
              </div>
            )}
          </div>
        );
      })}
      <div className="flex justify-end gap-1">
        <Button type="button" size="sm" variant="outline" className="h-7" aria-label="Add measure" onClick={() => onChange(addMeasure(value, model ?? { metrics: [] }))}>
          <Plus className="mr-1 h-3 w-3" /> Add measure
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7" aria-label="Add formula" onClick={() => onChange(addFormula(value))}>
          <Sigma className="mr-1 h-3 w-3" /> Formula
        </Button>
      </div>
    </div>
  );
}

function WhereEditor({ value, dims, onChange }: { value: FilterCondition[]; dims: { key: string; label: string }[]; onChange: (c: FilterCondition[]) => void }) {
  return (
    <div className="flex flex-col gap-1 rounded border border-dashed border-border/70 p-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Only where</span>
      {value.map((c, i) => (
        <div key={i} className="flex items-center gap-1">
          <Select value={c.dimension} onValueChange={(v) => onChange(updateCondition(value, i, { dimension: v }))}>
            <SelectTrigger aria-label="Where field" className="h-6 w-28 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{dims.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={c.op} onValueChange={(v) => onChange(updateCondition(value, i, { op: v, value: toValue(v, toLiteral(c.value)) }))}>
            <SelectTrigger aria-label="Where operator" className="h-6 w-20 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{OPS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
          </Select>
          <Input aria-label="Where value" className="h-6 flex-1 text-xs" value={toLiteral(c.value)} onChange={(e) => onChange(updateCondition(value, i, { value: toValue(c.op, e.target.value) }))} />
          <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0" aria-label="Remove where" onClick={() => onChange(removeCondition(value, i))}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" className="h-6 self-start text-[11px]" onClick={() => onChange(addCondition(value, dims))}>+ condition</Button>
    </div>
  );
}
