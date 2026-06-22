import { useTranslation } from 'react-i18next';
import type { ReportSummary, ReportParamMeta } from '../api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  report: ReportSummary;
  params: Record<string, string>;
  options: Record<string, string[]>;
  onChange: (params: Record<string, string>) => void;
  onRun: () => void;
  running: boolean;
  canRun: boolean;
}

const ALL = '__all__';

export function ReportParametersBar({ report, params, options, onChange, onRun, running, canRun }: Props) {
  const { t } = useTranslation();
  const set = (patch: Record<string, string | undefined>) => {
    const next: Record<string, string> = { ...params };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') delete next[k];
      else next[k] = v;
    }
    onChange(next);
  };

  const renderControl = (p: ReportParamMeta) => {
    if (p.type === 'daterange') {
      const value = params.from || params.to ? { from: params.from ?? '', to: params.to ?? '' } : null;
      return (
        <DateRangePicker
          value={value}
          onChange={(v) => set({ from: v?.from, to: v?.to })}
          placeholder={p.label}
        />
      );
    }
    if (p.type === 'select') {
      const opts = p.optionsKey ? options[p.optionsKey] ?? [] : [];
      return (
        <Select
          value={params[p.id] ?? ALL}
          onValueChange={(v) => set({ [p.id]: v === ALL ? undefined : v })}
        >
          <SelectTrigger className="h-9 w-48 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('reports.all')}</SelectItem>
            {opts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    return (
      <Input
        value={params[p.id] ?? ''}
        onChange={(e) => set({ [p.id]: e.target.value })}
        placeholder={p.label}
        className="h-9 w-40 text-xs"
      />
    );
  };

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
      {report.parameters.map((p) => (
        <div key={p.id} className="flex flex-col gap-1">
          <Label className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
            {p.label}{p.required && <span className="text-destructive"> *</span>}
          </Label>
          {renderControl(p)}
        </div>
      ))}
      <Button className="ml-auto h-9" onClick={onRun} disabled={!canRun || running}>
        {running ? t('reports.running') : t('reports.run')}
      </Button>
    </div>
  );
}
