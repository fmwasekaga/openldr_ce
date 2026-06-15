import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import type { DashboardFilterDef } from '../../api';

type FilterType = DashboardFilterDef['type'];

function newId(): string {
  return `f_${crypto.randomUUID().slice(0, 6)}`;
}

export function DashboardFilterEditor({
  open,
  filters,
  onClose,
  onSave,
}: {
  open: boolean;
  filters: DashboardFilterDef[];
  onClose: () => void;
  onSave: (f: DashboardFilterDef[]) => void;
}) {
  const [list, setList] = useState<DashboardFilterDef[]>(filters);

  // Reset local state whenever the dialog (re)opens.
  useEffect(() => {
    if (open) setList(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const update = (i: number, patch: Partial<DashboardFilterDef>) =>
    setList(list.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
  };

  const addFilter = () =>
    setList([...list, { id: newId(), label: 'New Filter', type: 'text' }]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full max-w-lg max-h-[80vh] flex flex-col p-0">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">Dashboard Filters</DialogTitle>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {list.length === 0 && (
            <p className="text-sm text-muted-foreground">No filters yet. Add one below.</p>
          )}
          {list.map((f, i) => (
            <div key={f.id} className="space-y-2 rounded-md border border-border p-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Variable ID</Label>
                  <Input
                    aria-label={`filter-${i}-id`}
                    className="h-8 text-xs"
                    value={f.id}
                    onChange={(e) => update(i, { id: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Label</Label>
                  <Input
                    aria-label={`filter-${i}-label`}
                    className="h-8 text-xs"
                    value={f.label}
                    onChange={(e) => update(i, { label: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Type</Label>
                  <Select
                    value={f.type}
                    onValueChange={(v) =>
                      update(i, { type: v as FilterType, defaultValue: null, defaultRange: null })
                    }
                  >
                    <SelectTrigger aria-label={`filter-${i}-type`} className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">text</SelectItem>
                      <SelectItem value="number">number</SelectItem>
                      <SelectItem value="date">date</SelectItem>
                      <SelectItem value="date-range">date-range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {f.type === 'text' && (
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Options SQL</Label>
                  <Input
                    aria-label={`filter-${i}-options-sql`}
                    className="h-8 font-mono text-xs"
                    placeholder="optional — populates dropdown"
                    value={f.optionsSql ?? ''}
                    onChange={(e) => update(i, { optionsSql: e.target.value || undefined })}
                  />
                </div>
              )}

              {(f.type === 'text' || f.type === 'number') && (
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Default Value</Label>
                  <Input
                    aria-label={`filter-${i}-default`}
                    type={f.type === 'number' ? 'number' : 'text'}
                    className="h-8 text-xs"
                    value={f.defaultValue == null ? '' : String(f.defaultValue)}
                    onChange={(e) =>
                      update(i, {
                        defaultValue:
                          e.target.value === ''
                            ? null
                            : f.type === 'number'
                              ? Number(e.target.value)
                              : e.target.value,
                      })
                    }
                  />
                </div>
              )}

              {f.type === 'date' && (
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Default Value</Label>
                  <DatePicker
                    value={(f.defaultValue as string) ?? null}
                    onChange={(v) => update(i, { defaultValue: v })}
                    className="h-8 text-xs"
                  />
                </div>
              )}

              {f.type === 'date-range' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Default From</Label>
                    <DatePicker
                      value={f.defaultRange?.from ?? null}
                      onChange={(v) =>
                        update(i, { defaultRange: { from: v ?? '', to: f.defaultRange?.to ?? '' } })
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Default To</Label>
                    <DatePicker
                      value={f.defaultRange?.to ?? null}
                      onChange={(v) =>
                        update(i, { defaultRange: { from: f.defaultRange?.from ?? '', to: v ?? '' } })
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-1 pt-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`filter-${i}-up`}
                  className="h-7 w-7"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`filter-${i}-down`}
                  className="h-7 w-7"
                  disabled={i === list.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`filter-${i}-remove`}
                  className="h-7 w-7 text-destructive"
                  onClick={() => setList(list.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <Button variant="outline" size="sm" onClick={addFilter}>
            Add Filter
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onSave(list);
                onClose();
              }}
            >
              Save Filters
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
