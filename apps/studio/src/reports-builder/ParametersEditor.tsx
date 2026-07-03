import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import type { ReportParam } from '@openldr/report-builder/pure';

const TYPES: ReportParam['type'][] = ['text', 'select', 'daterange'];

function newId(): string { return `p_${crypto.randomUUID().slice(0, 6)}`; }

export function ParametersEditor({ open, parameters, onClose, onSave }: {
  open: boolean;
  parameters: ReportParam[];
  onClose: () => void;
  onSave: (p: ReportParam[]) => void;
}): JSX.Element {
  const [list, setList] = useState<ReportParam[]>(parameters);
  useEffect(() => { if (open) setList(parameters); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  const update = (i: number, patch: Partial<ReportParam>) => setList(list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; setList(next);
  };
  const add = () => setList([...list, { id: newId(), label: 'New Parameter', type: 'text', required: false }]);

  const ids = list.map((p) => p.id.trim());
  const invalid = ids.some((id) => id === '') || new Set(ids).size !== ids.length;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full max-w-lg max-h-[80vh] flex flex-col p-0">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">Report Parameters</DialogTitle>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {list.length === 0 && <p className="text-sm text-muted-foreground">No parameters yet. Add one below.</p>}
          {list.map((p, i) => (
            <div key={i} className="space-y-2 rounded-md border border-border p-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Variable ID</Label>
                  <Input aria-label={`param-${i}-id`} className="h-8 text-xs" value={p.id}
                    onChange={(e) => update(i, { id: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Label</Label>
                  <Input aria-label={`param-${i}-label`} className="h-8 text-xs" value={p.label}
                    onChange={(e) => update(i, { label: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Type</Label>
                  <select aria-label={`param-${i}-type`} className="h-8 w-full rounded border border-border bg-background text-xs"
                    value={p.type} onChange={(e) => update(i, { type: e.target.value as ReportParam['type'], optionsSql: undefined })}>
                    {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              {p.type === 'select' && (
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Options SQL</Label>
                  <Input aria-label={`param-${i}-options-sql`} className="h-8 font-mono text-xs"
                    placeholder="SELECT name FROM … — first column populates the dropdown"
                    value={p.optionsSql ?? ''} onChange={(e) => update(i, { optionsSql: e.target.value || undefined })} />
                </div>
              )}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input type="checkbox" aria-label={`param-${i}-required`} checked={p.required}
                    onChange={(e) => update(i, { required: e.target.checked })} />Required
                </label>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" aria-label={`param-${i}-up`} className="h-7 w-7" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label={`param-${i}-down`} className="h-7 w-7" disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label={`param-${i}-remove`} className="h-7 w-7 text-destructive" onClick={() => setList(list.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <Button variant="outline" size="sm" onClick={add}>Add Parameter</Button>
          <div className="flex items-center gap-2">
            {invalid && <span className="text-xs text-destructive">Parameter ids must be unique and non-empty</span>}
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={invalid} onClick={() => { if (!invalid) { onSave(list); onClose(); } }}>Save Parameters</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
