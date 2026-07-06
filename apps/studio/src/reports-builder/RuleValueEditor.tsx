import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ReportParam } from '@openldr/report-builder/pure';

const PARAM_TOKEN = /^\{\{\s*param\.(\w+)\s*\}\}$/;
export function isParamValue(v: unknown): v is string { return typeof v === 'string' && PARAM_TOKEN.test(v); }
export function paramId(v: unknown): string { return typeof v === 'string' ? (v.match(PARAM_TOKEN)?.[1] ?? '') : ''; }
export function literalToValue(op: string, raw: string): unknown {
  if (op === 'in' || op === 'between') return raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
  return raw;
}
export function valueToLiteral(v: unknown): string { return Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v); }

export function RuleValueEditor({ op, value, parameters, onChange, idPrefix }: {
  op: string; value: unknown; parameters: ReportParam[]; onChange: (v: unknown) => void; idPrefix: string;
}): JSX.Element {
  const { t } = useTranslation();
  const paramMode = isParamValue(value);
  return (
    <div className="flex items-center gap-1">
      <div className="flex">
        <Button type="button" size="sm" className="h-7 rounded-r-none px-2 text-[10px]" aria-label={`${idPrefix}-mode-literal`}
          variant={paramMode ? 'outline' : 'default'} onClick={() => onChange('')}>{t('reportBuilder.filters.value')}</Button>
        <Button type="button" size="sm" className="h-7 rounded-l-none px-2 text-[10px]" aria-label={`${idPrefix}-mode-param`}
          variant={paramMode ? 'default' : 'outline'} disabled={parameters.length === 0}
          onClick={() => onChange(`{{param.${parameters[0]?.id ?? ''}}}`)}>{t('reportBuilder.filters.param')}</Button>
      </div>
      {paramMode ? (
        <select aria-label={`${idPrefix}-param`} className="h-7 flex-1 rounded border border-border bg-background text-xs"
          value={paramId(value)} onChange={(e) => onChange(`{{param.${e.target.value}}}`)}>
          {parameters.length === 0 && <option value="">{t('reportBuilder.filters.noParameters')}</option>}
          {parameters.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      ) : (
        <Input aria-label={`${idPrefix}-value`} className="h-7 flex-1 text-xs"
          value={valueToLiteral(value)} onChange={(e) => onChange(literalToValue(op, e.target.value))} />
      )}
    </div>
  );
}
