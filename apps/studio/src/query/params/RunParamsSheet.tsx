// apps/studio/src/query/params/RunParamsSheet.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { queryApi } from '../api';
import type { CustomQueryParam } from '../custom-query-types';

export function RunParamsSheet({ open, params, connectorId, onClose, onRun }: {
  open: boolean; params: CustomQueryParam[]; connectorId: string;
  onClose(): void; onRun(values: Record<string, unknown>): void;
}): JSX.Element {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [options, setOptions] = useState<Record<string, unknown[]>>({});

  useEffect(() => {
    if (!open) return;
    for (const p of params) {
      if (p.type === 'select' && p.optionsSql && connectorId && !options[p.id]) {
        queryApi.paramOptions(connectorId, p.optionsSql).then((o) => setOptions((m) => ({ ...m, [p.id]: o })));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, params, connectorId]);

  const set = (id: string, v: unknown) => setValues((s) => ({ ...s, [id]: v }));
  const setRange = (id: string, k: 'from' | 'to', v: string) =>
    setValues((s) => ({ ...s, [id]: { ...(s[id] as object ?? {}), [k]: v } }));

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="flex w-80 flex-col gap-4">
        <SheetHeader><SheetTitle>{t('query.runParameters')}</SheetTitle></SheetHeader>
        {params.map((p) => (
          <div key={p.id} className="space-y-1">
            <label className="text-xs text-muted-foreground">{p.label} · {p.type}</label>
            {p.type === 'daterange' && (
              <div className="flex gap-2">
                <input aria-label={`${p.id}-from`} type="date" className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                  onChange={(e) => setRange(p.id, 'from', e.target.value)} />
                <input aria-label={`${p.id}-to`} type="date" className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                  onChange={(e) => setRange(p.id, 'to', e.target.value)} />
              </div>
            )}
            {p.type === 'select' && (
              <select aria-label={p.id} className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                onChange={(e) => set(p.id, e.target.value)}>
                <option value="" />
                {(options[p.id] ?? []).map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
              </select>
            )}
            {p.type === 'text' && (
              <input aria-label={p.id} className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                onChange={(e) => set(p.id, e.target.value)} />
            )}
          </div>
        ))}
        <button className="mt-auto rounded bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={() => onRun(values)}>
          {t('query.runWithValues')}
        </button>
      </SheetContent>
    </Sheet>
  );
}
