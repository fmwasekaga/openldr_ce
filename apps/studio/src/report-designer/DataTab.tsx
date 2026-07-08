import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, ArrowDown, Plus, X } from 'lucide-react';
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
  /** Design-level parameters (edited via ParamEditor; also feed the Load-columns run values). */
  parameters: TemplateParam[];
  onPatchElement: (id: string, patch: Partial<DesignElement>, opts?: { discrete?: boolean }) => void;
  /** Replaces the whole design-parameter array (discrete push). */
  onPatchParameters: (next: TemplateParam[]) => void;
}

type ResultColumn = { key: string; label: string };
type ParamType = NonNullable<TemplateParam['type']>;

const emptyValue = (type: ParamType): TemplateParam['value'] => (type === 'daterange' ? { from: '', to: '' } : '');

/** One editable design-parameter row. Text inputs commit on blur (local state while typing). */
function ParamRow({ param, onChange, onRemove }: {
  param: TemplateParam;
  onChange: (patch: Partial<TemplateParam>) => void;
  onRemove: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const type: ParamType = param.type ?? 'text';
  const strValue = typeof param.value === 'string' ? param.value : '';
  const range = param.value && typeof param.value === 'object' ? param.value : { from: '', to: '' };

  const [key, setKey] = useState(param.key);
  const [label, setLabel] = useState(param.label);
  const [value, setValue] = useState(strValue);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);

  // Re-sync local text if the param changes upstream (undo/redo, type reset), like NumberField.
  useEffect(() => { setKey(param.key); }, [param.key]);
  useEffect(() => { setLabel(param.label); }, [param.label]);
  useEffect(() => {
    setValue(typeof param.value === 'string' ? param.value : '');
    const r = param.value && typeof param.value === 'object' ? param.value : { from: '', to: '' };
    setFrom(r.from); setTo(r.to);
  }, [param.value]);

  const commitKey = () => { const k = key.trim(); if (k && k !== param.key) onChange({ key: k }); else setKey(param.key); };

  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="flex items-center gap-1.5">
        <Input aria-label={`${t('reportDesigner.paramKey')} ${param.key}`} value={key} placeholder={t('reportDesigner.paramKey')}
          onChange={(e) => setKey(e.target.value)} onBlur={commitKey} className="h-7 flex-1 text-xs" />
        <Input aria-label={`${t('reportDesigner.paramLabel')} ${param.key}`} value={label} placeholder={t('reportDesigner.paramLabel')}
          onChange={(e) => setLabel(e.target.value)} onBlur={() => onChange({ label })} className="h-7 flex-1 text-xs" />
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0"
          aria-label={`${t('reportDesigner.removeParameter')} ${param.key}`} onClick={onRemove}><X className="h-3.5 w-3.5" /></Button>
      </div>
      <div className="flex items-center gap-1.5">
        <Select value={type} onValueChange={(v) => onChange({ type: v as ParamType, value: emptyValue(v as ParamType) })}>
          <SelectTrigger aria-label={`${t('reportDesigner.paramType')} ${param.key}`} className="h-7 w-28 shrink-0 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="text">{t('reportDesigner.paramTypeText')}</SelectItem>
            <SelectItem value="select">{t('reportDesigner.paramTypeSelect')}</SelectItem>
            <SelectItem value="daterange">{t('reportDesigner.paramTypeDaterange')}</SelectItem>
          </SelectContent>
        </Select>
        {type === 'daterange' ? (
          <div className="flex flex-1 items-center gap-1.5">
            <Input type="date" aria-label={`${t('reportDesigner.from')} ${param.key}`} value={from}
              onChange={(e) => setFrom(e.target.value)} onBlur={() => onChange({ value: { from, to } })} className="h-7 flex-1 text-xs" />
            <Input type="date" aria-label={`${t('reportDesigner.to')} ${param.key}`} value={to}
              onChange={(e) => setTo(e.target.value)} onBlur={() => onChange({ value: { from, to } })} className="h-7 flex-1 text-xs" />
          </div>
        ) : (
          <Input aria-label={`${t('reportDesigner.paramValue')} ${param.key}`} value={value}
            onChange={(e) => setValue(e.target.value)} onBlur={() => onChange({ value })} className="h-7 flex-1 text-xs" />
        )}
      </div>
    </div>
  );
}

/** Always-visible design-parameter editor (renders even with no element selected). */
function ParamEditor({ parameters, onPatchParameters }: {
  parameters: TemplateParam[];
  onPatchParameters: (next: TemplateParam[]) => void;
}): JSX.Element {
  const { t } = useTranslation();

  const add = () => {
    const keys = new Set(parameters.map((p) => p.key));
    let n = 1;
    while (keys.has(`param${n}`)) n += 1; // smallest free paramN, so keys stay unique
    onPatchParameters([...parameters, { key: `param${n}`, label: `Param ${parameters.length + 1}`, type: 'text', value: '' }]);
  };
  const update = (i: number, patch: Partial<TemplateParam>) =>
    onPatchParameters(parameters.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const remove = (i: number) => onPatchParameters(parameters.filter((_, j) => j !== i));

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.parameters')}</div>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={add}>
          <Plus className="h-3.5 w-3.5" />{t('reportDesigner.addParameter')}
        </Button>
      </div>
      {parameters.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('reportDesigner.noParameters')}</p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {parameters.map((p, i) => (
            <ParamRow key={p.key} param={p} onChange={(patch) => update(i, patch)} onRemove={() => remove(i)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function DataTab({ element, parameters, onPatchElement, onPatchParameters }: Props): JSX.Element {
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
    setLoading(false); // a new element always starts idle, even if the old one had a run in flight
  }, [element?.id]);

  if (!element || element.kind !== 'table') {
    return (
      <div className="flex flex-col gap-3 p-3">
        <p className="text-xs text-muted-foreground">{t('reportDesigner.selectTableToBind')}</p>
        <ParamEditor parameters={parameters} onPatchParameters={onPatchParameters} />
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
      // Always clear loading when a request settles. The reqId guard above already prevents stale
      // RESULTS from applying; loading must reset unconditionally or a superseded run leaves the
      // button stuck-disabled on the new element. Concurrent loads can't happen (button disabled while loading).
      setLoading(false);
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

      <ParamEditor parameters={parameters} onPatchParameters={onPatchParameters} />
    </div>
  );
}
