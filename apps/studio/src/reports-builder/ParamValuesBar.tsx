import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { runWidgetQuery } from '../api';
import type { ReportParam } from '@openldr/report-builder/pure';

const ALL = '__all__';

export function ParamValuesBar({ parameters, values, onChange }: {
  parameters: ReportParam[];
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}): JSX.Element | null {
  const [options, setOptions] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let alive = true;
    for (const p of parameters) {
      if (p.type !== 'select' || !p.optionsSql) continue;
      runWidgetQuery({ mode: 'sql', sql: p.optionsSql })
        .then((r) => {
          if (!alive || !r.columns?.length) return;
          const key = r.columns[0].key;
          const opts = r.rows.map((row) => String(row[key])).filter((v) => v !== 'null' && v !== '');
          setOptions((prev) => ({ ...prev, [p.id]: opts }));
        })
        .catch(() => {});
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(parameters.map((p) => [p.id, p.optionsSql]))]);

  if (parameters.length === 0) return null;

  const set = (patch: Record<string, string | undefined>) => {
    const next: Record<string, string> = { ...values };
    for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === '') delete next[k]; else next[k] = v; }
    onChange(next);
  };

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-2">
      {parameters.map((p) => (
        <div key={p.id} className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {p.label}{p.required && <span className="text-destructive"> *</span>}
          </Label>
          {p.type === 'daterange' ? (
            <DateRangePicker
              value={values.from || values.to ? { from: values.from ?? '', to: values.to ?? '' } : null}
              onChange={(v) => set({ from: v?.from, to: v?.to })}
              className="h-8 text-xs"
            />
          ) : p.type === 'select' ? (
            <Select value={values[p.id] ?? ALL} onValueChange={(v) => set({ [p.id]: v === ALL ? undefined : v })}>
              <SelectTrigger aria-label={p.label} className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {(options[p.id] ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Input aria-label={p.label} className="h-8 w-40 text-xs" value={values[p.id] ?? ''} onChange={(e) => set({ [p.id]: e.target.value })} />
          )}
        </div>
      ))}
    </div>
  );
}
