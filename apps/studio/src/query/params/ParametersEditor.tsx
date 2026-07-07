// apps/studio/src/query/params/ParametersEditor.tsx
// Query-specific parameters editor — a shadcn Dialog + Select (not native controls), operating on
// CustomQueryParam[]. Field labels reuse the generic reportBuilder.parameters.* i18n strings.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CustomQueryParam } from '../custom-query-types';

const TYPES: CustomQueryParam['type'][] = ['text', 'select', 'daterange'];
function newId(): string { return `p_${crypto.randomUUID().slice(0, 6)}`; }

export function ParametersEditor({ open, parameters, onClose, onSave }: {
  open: boolean;
  parameters: CustomQueryParam[];
  onClose: () => void;
  onSave: (p: CustomQueryParam[]) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [list, setList] = useState<CustomQueryParam[]>(parameters);
  useEffect(() => { if (open) setList(parameters); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  const update = (i: number, patch: Partial<CustomQueryParam>) => setList(list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; setList(next);
  };
  const add = () => setList([...list, { id: newId(), label: 'New Parameter', type: 'text', required: false }]);

  const ids = list.map((p) => p.id.trim());
  const invalid = ids.some((id) => id === '') || new Set(ids).size !== ids.length;
  const labelCls = 'text-[10px] uppercase tracking-wide text-muted-foreground';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-lg flex-col p-0">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">{t('query.parameters')}</DialogTitle>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {list.length === 0 && <p className="text-sm text-muted-foreground">{t('reportBuilder.parameters.empty')}</p>}
          {list.map((p, i) => (
            <div key={i} className="space-y-2 rounded-md border border-border p-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className={labelCls}>{t('reportBuilder.parameters.variableId')}</Label>
                  <Input aria-label={`param-${i}-id`} className="h-8 text-xs" value={p.id}
                    onChange={(e) => update(i, { id: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })} />
                </div>
                <div className="space-y-1">
                  <Label className={labelCls}>{t('reportBuilder.parameters.label')}</Label>
                  <Input aria-label={`param-${i}-label`} className="h-8 text-xs" value={p.label}
                    onChange={(e) => update(i, { label: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className={labelCls}>{t('reportBuilder.parameters.type')}</Label>
                  <Select value={p.type} onValueChange={(v) => update(i, { type: v as CustomQueryParam['type'], optionsSql: undefined })}>
                    <SelectTrigger aria-label={`param-${i}-type`} className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TYPES.map((ty) => <SelectItem key={ty} value={ty}>{ty}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {p.type === 'select' && (
                <div className="space-y-1">
                  <Label className={labelCls}>{t('reportBuilder.parameters.optionsSql')}</Label>
                  <Input aria-label={`param-${i}-options-sql`} className="h-8 font-mono text-xs"
                    placeholder={t('reportBuilder.parameters.optionsSqlPlaceholder')}
                    value={p.optionsSql ?? ''} onChange={(e) => update(i, { optionsSql: e.target.value || undefined })} />
                </div>
              )}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox aria-label={`param-${i}-required`} checked={p.required}
                    onCheckedChange={(c) => update(i, { required: c === true })} />
                  {t('reportBuilder.parameters.required')}
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
          <Button variant="outline" size="sm" onClick={add}>{t('reportBuilder.parameters.addParameter')}</Button>
          <div className="flex items-center gap-2">
            {invalid && <span className="text-xs text-destructive">{t('reportBuilder.parameters.invalid')}</span>}
            <Button variant="outline" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
            <Button size="sm" disabled={invalid} onClick={() => { if (!invalid) { onSave(list); onClose(); } }}>{t('reportBuilder.parameters.saveParameters')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
