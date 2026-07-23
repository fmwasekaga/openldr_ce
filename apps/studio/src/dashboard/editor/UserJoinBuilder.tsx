import type { UserJoin, ClientJoinableTable } from '../../api';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

export function UserJoinBuilder({ join, joinable, baseColumns, selected, onChange, onColumns, onRemove }: {
  join: UserJoin;
  joinable: ClientJoinableTable[];
  baseColumns: string[];
  selected: string[];                                   // columns currently selected for this join
  onChange: (patch: Partial<UserJoin>) => void;         // table/left/right edits
  onColumns: (id: string, columns: string[]) => void;   // column selection reconcile
  onRemove: () => void;
}) {
  const jt = joinable.find((t) => t.table === join.table);
  const fanout = jt ? !jt.primaryKeys.includes(join.right) : false;
  const toggle = (c: string) => onColumns(join.id, selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c]);

  return (
    <div className="mx-1 rounded-md border border-border bg-card p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">Join: {jt?.label ?? join.table}</span>
        <button type="button" aria-label={`Remove join ${join.id}`} className="text-muted-foreground hover:text-foreground" onClick={onRemove}>×</button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">Table
          <Select value={join.table} onValueChange={(t) => onChange({ table: t, right: '' })}>
            <SelectTrigger aria-label="Join table" className="mt-1 h-8 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{joinable.map((t) => <SelectItem key={t.table} value={t.table}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <span className="pb-2 text-xs text-muted-foreground">on</span>
        <label className="text-xs">Base key
          <Select value={join.left} onValueChange={(v) => onChange({ left: v })}>
            <SelectTrigger aria-label="Left key" className="mt-1 h-8 w-40"><SelectValue placeholder="column" /></SelectTrigger>
            <SelectContent>{baseColumns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <span className="pb-2 text-xs text-muted-foreground">=</span>
        <label className="text-xs">{jt?.label ?? 'Joined'} key
          <Select value={join.right} onValueChange={(v) => onChange({ right: v })}>
            <SelectTrigger aria-label="Right key" className="mt-1 h-8 w-40"><SelectValue placeholder="column" /></SelectTrigger>
            <SelectContent>{(jt?.allColumns ?? []).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </label>
      </div>

      {fanout && <p className="mt-1 text-xs text-amber-500">Right key isn’t a primary key — counts may inflate (fan-out).</p>}

      <fieldset className="mt-2 flex flex-col gap-1">
        <legend className="mb-1 text-xs text-muted-foreground">Columns</legend>
        {(jt?.columns ?? []).map((c) => (
          <label key={c} className="flex items-center gap-2 text-xs">
            <input type="checkbox" aria-label={c} checked={selected.includes(c)} onChange={() => toggle(c)} />
            {c}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
