import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { queryApi } from '../query/api';
import type { CustomQuery } from '../query/custom-query-types';
import type { BoundColumn, DesignElement, TemplateParam } from './types';

interface Props {
  /** The selected element (may be undefined or a non-table). */
  element: DesignElement | undefined;
  /** Design-level parameters (edited in Task 7; used here only to pass Load-columns values). */
  parameters: TemplateParam[];
  onPatchElement: (id: string, patch: Partial<DesignElement>, opts?: { discrete?: boolean }) => void;
  // reserved for Task 7 (param editor) — kept in the interface so props don't reshape later
  onPatchParameters: (next: TemplateParam[]) => void;
}

type ResultColumn = { key: string; label: string };

export function DataTab({ element, parameters, onPatchElement }: Props): JSX.Element {
  const { t } = useTranslation();
  const [queries, setQueries] = useState<CustomQuery[]>([]);
  const [resultColumns, setResultColumns] = useState<ResultColumn[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Monotonic dispatch id: a Load-columns response is applied only if it is still the latest request.
  const loadSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void queryApi.list().then((qs) => { if (!cancelled) setQueries(qs); }).catch(() => { /* offline / auth — leave empty */ });
    return () => { cancelled = true; };
  }, []);

  // Reset loaded columns/errors whenever the selected element changes, so element B never shows
  // element A's columns. Bumping loadSeq also invalidates any in-flight run() from the old element.
  useEffect(() => {
    loadSeq.current += 1;
    setResultColumns([]);
    setLoadError(null);
  }, [element?.id]);

  if (!element || element.kind !== 'table') {
    return (
      <div className="flex flex-col gap-3 p-3">
        <p className="text-xs text-muted-foreground">{t('reportDesigner.selectTableToBind')}</p>
      </div>
    );
  }

  const el = element;
  const queryId = el.dataSource?.queryId ?? '';
  const bound: BoundColumn[] = el.boundColumns ?? [];
  // Structural changes are discrete undo steps; continuous label typing is coalesced (see relabel).
  const setBound = (next: BoundColumn[], opts?: { discrete?: boolean }) => onPatchElement(el.id, { boundColumns: next }, opts);

  const pickQuery = (id: string) => {
    onPatchElement(el.id, { dataSource: { kind: 'custom-query', queryId: id } }, { discrete: true });
    // A new query invalidates any in-flight load and the previously shown columns.
    loadSeq.current += 1;
    setResultColumns([]);
    setLoadError(null);
  };

  const loadColumns = async () => {
    const cq = queries.find((q) => q.id === el.dataSource?.queryId);
    if (!cq) return;
    const reqId = ++loadSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const values: Record<string, unknown> = {};
      for (const param of parameters) {
        const qp = cq.params.find((p) => p.id === param.key);
        if (qp) values[param.key] = param.value;
      }
      const result = await queryApi.run({ connectorId: cq.connectorId, sql: cq.sql, params: cq.params, values, limit: 1 });
      if (reqId !== loadSeq.current) return; // a newer request (or element/query switch) superseded this one
      setResultColumns(result.columns);
    } catch {
      if (reqId !== loadSeq.current) return;
      setLoadError(t('reportDesigner.loadColumnsError'));
    } finally {
      if (reqId === loadSeq.current) setLoading(false);
    }
  };

  const includedKeys = new Set(bound.map((c) => c.key));
  const toggle = (col: ResultColumn, on: boolean) => {
    if (on) setBound([...bound, { key: col.key, label: col.label }], { discrete: true });
    else setBound(bound.filter((c) => c.key !== col.key), { discrete: true });
  };
  // Coalesced: typing in the label field records one undo step per burst, like PropertiesTab's rename Input.
  const relabel = (key: string, label: string) => setBound(bound.map((c) => (c.key === key ? { ...c, label } : c)));
  const move = (key: string, dir: -1 | 1) => {
    const i = bound.findIndex((c) => c.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= bound.length) return;
    const next = bound.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setBound(next, { discrete: true });
  };

  // Included columns first (in bound order), then the remaining result columns.
  const rows: { col: ResultColumn; included: boolean }[] = [
    ...bound.map((b) => ({ col: resultColumns.find((r) => r.key === b.key) ?? { key: b.key, label: b.label }, included: true })),
    ...resultColumns.filter((r) => !includedKeys.has(r.key)).map((r) => ({ col: r, included: false })),
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.bindQuery')}</div>
        <Select value={queryId} onValueChange={pickQuery}>
          <SelectTrigger aria-label={t('reportDesigner.bindQuery')} className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>{queries.map((q) => <SelectItem key={q.id} value={q.id}>{q.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!queryId || loading} onClick={() => { void loadColumns(); }}>
          {t('reportDesigner.loadColumns')}
        </Button>
      </div>
      {loadError && <p className="text-xs text-destructive">{loadError}</p>}

      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.columns')}</div>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('reportDesigner.noColumnsLoaded')}</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {rows.map(({ col, included }, i) => {
              const boundCol = bound.find((c) => c.key === col.key);
              return (
                <div key={col.key} className="flex items-center gap-1.5 py-1.5">
                  <Checkbox aria-label={col.key} checked={included} onCheckedChange={(v) => toggle(col, v === true)} />
                  <Input aria-label={`${t('reportDesigner.columnLabel')} ${col.key}`} value={boundCol ? boundCol.label : col.label}
                    disabled={!included} onChange={(e) => relabel(col.key, e.target.value)} className="h-7 flex-1 text-xs" />
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                    aria-label={`${t('reportDesigner.moveUp')} ${col.label}`} disabled={!included || i === 0}
                    onClick={() => move(col.key, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                    aria-label={`${t('reportDesigner.moveDown')} ${col.label}`} disabled={!included || i >= bound.length - 1}
                    onClick={() => move(col.key, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
