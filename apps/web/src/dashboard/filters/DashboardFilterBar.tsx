import { Input } from '@/components/ui/input';
import type { DashboardFilterDef } from '../../api';

export function DashboardFilterBar({
  filters,
  values,
  onChange,
}: {
  filters: DashboardFilterDef[];
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  if (filters.length === 0) return null;
  const set = (id: string, v: unknown) => onChange({ ...values, [id]: v });
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      {filters.map((f) => (
        <label key={f.id} className="text-sm">
          {f.label}
          {f.type === 'date' || f.type === 'date-range' ? (
            <Input
              type="date"
              aria-label={f.label}
              className="mt-1 w-auto"
              value={String(values[f.id] ?? '')}
              onChange={(e) => set(f.id, e.target.value)}
            />
          ) : (
            <Input
              type={f.type === 'number' ? 'number' : 'text'}
              aria-label={f.label}
              className="mt-1 w-40"
              value={String(values[f.id] ?? '')}
              onChange={(e) => set(f.id, e.target.value)}
            />
          )}
        </label>
      ))}
    </div>
  );
}
