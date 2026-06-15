import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { DateRangePicker, type DateRangePreset } from '@/components/ui/date-range-picker';
import { runWidgetQuery, type DashboardFilterDef } from '../../api';

const ALL = '__all__';

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
}
function monthStart(): string {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth(), 1));
}

const DATE_PRESETS: DateRangePreset[] = [
  { label: 'Today', range: { from: iso(new Date()), to: iso(new Date()) } },
  { label: 'Last 7 days', range: { from: daysAgo(7), to: iso(new Date()) } },
  { label: 'Last 30 days', range: { from: daysAgo(30), to: iso(new Date()) } },
  { label: 'This month', range: { from: monthStart(), to: iso(new Date()) } },
];

export function DashboardFilterBar({
  filters,
  values,
  onChange,
}: {
  filters: DashboardFilterDef[];
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  // Dynamic dropdown options resolved from each filter's optionsSql (first column of the result).
  const [dynamicOptions, setDynamicOptions] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let alive = true;
    for (const f of filters) {
      if (f.type !== 'text' || !f.optionsSql || f.options) continue;
      runWidgetQuery({ mode: 'sql', sql: f.optionsSql })
        .then((r) => {
          if (!alive || !r.columns?.length) return;
          const key = r.columns[0].key;
          const opts = r.rows.map((row) => String(row[key])).filter((v) => v !== 'null' && v !== '');
          setDynamicOptions((prev) => ({ ...prev, [f.id]: opts }));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters.map((f) => [f.id, f.optionsSql]))]);

  if (filters.length === 0) return null;
  const set = (id: string, v: unknown) => onChange({ ...values, [id]: v });

  return (
    <div className="flex flex-wrap items-end gap-3">
      {filters.map((f) => {
        const options = f.options ?? dynamicOptions[f.id];
        return (
          <div key={f.id} className="flex flex-col gap-1">
            <Label htmlFor={`f-${f.id}`} className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {f.label}
            </Label>
            {f.type === 'text' && options ? (
              <Select
                value={values[f.id] == null || values[f.id] === '' ? ALL : String(values[f.id])}
                onValueChange={(v) => set(f.id, v === ALL ? null : v)}
              >
                <SelectTrigger id={`f-${f.id}`} aria-label={f.label} className="h-8 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All</SelectItem>
                  {options.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : f.type === 'text' ? (
              <Input
                id={`f-${f.id}`}
                aria-label={f.label}
                className="h-8 w-32 text-xs"
                value={String(values[f.id] ?? '')}
                onChange={(e) => set(f.id, e.target.value)}
              />
            ) : f.type === 'number' ? (
              <Input
                id={`f-${f.id}`}
                type="number"
                aria-label={f.label}
                className="h-8 w-24 text-xs"
                value={String(values[f.id] ?? '')}
                onChange={(e) => set(f.id, e.target.value === '' ? null : Number(e.target.value))}
              />
            ) : f.type === 'date' ? (
              <DatePicker
                value={(values[f.id] as string) ?? null}
                onChange={(v) => set(f.id, v)}
                className="h-8 w-40 text-xs"
              />
            ) : (
              <DateRangePicker
                value={(values[f.id] as { from: string; to: string }) ?? null}
                onChange={(v) => set(f.id, v)}
                presets={DATE_PRESETS}
                className="h-8 text-xs"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
