import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2 } from 'lucide-react';
import type { DashboardFilterDef } from '../../api';

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
  const add = () =>
    setList([...list, { id: `f-${Math.round(performance.now())}`, label: 'New filter', type: 'text' }]);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[36rem] max-w-[95vw] p-6">
        <div className="mb-4">
          <DialogTitle className="text-lg font-semibold">Dashboard filters</DialogTitle>
        </div>
        <div className="flex flex-col gap-2">
          {list.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2">
              <Input
                aria-label={`filter-${i}-label`}
                value={f.label}
                onChange={(e) =>
                  setList(list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                }
              />
              <select
                className="rounded border border-border bg-background p-2"
                value={f.type}
                onChange={(e) =>
                  setList(
                    list.map((x, j) =>
                      j === i ? { ...x, type: e.target.value as DashboardFilterDef['type'] } : x,
                    ),
                  )
                }
              >
                <option value="text">text</option>
                <option value="number">number</option>
                <option value="date">date</option>
                <option value="date-range">date-range</option>
              </select>
              <Button
                size="icon"
                variant="ghost"
                aria-label="remove"
                onClick={() => setList(list.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={add}>
            Add filter
          </Button>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onSave(list);
                onClose();
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
