import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createSchedule, updateSchedule, type ReportSchedule, type ReportParamMeta, type ScheduleInput } from '../api';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ALL = '__all__';
const WEEKDAYS: { value: string; key: string }[] = [
  { value: '1', key: 'Mon' }, { value: '2', key: 'Tue' }, { value: '3', key: 'Wed' },
  { value: '4', key: 'Thu' }, { value: '5', key: 'Fri' }, { value: '6', key: 'Sat' }, { value: '0', key: 'Sun' },
];

interface Props {
  open: boolean;
  reportId: string;
  parameters: ReportParamMeta[];
  options: Record<string, string[]>;
  initialParams: Record<string, string>;
  existing?: ReportSchedule;
  onClose: () => void;
  onSaved: () => void;
}

export function ScheduleDialog({ open, reportId, parameters, options, initialParams, existing, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [frequency, setFrequency] = useState<ScheduleInput['frequency']>(existing?.frequency ?? 'monthly');
  const [dayOfWeek, setDayOfWeek] = useState(String(existing?.dayOfWeek ?? 1));
  const [dayOfMonth, setDayOfMonth] = useState(String(existing?.dayOfMonth ?? 1));
  const [outputFormat, setOutputFormat] = useState<ScheduleInput['outputFormat']>(existing?.outputFormat ?? 'xlsx');
  const [params, setParams] = useState<Record<string, string>>(existing?.params ?? initialParams ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const paramFields = parameters.filter((p) => p.type !== 'daterange');
  const setParam = (id: string, v: string | undefined) => {
    setParams((prev) => {
      const next = { ...prev };
      if (v === undefined || v === '') delete next[id];
      else next[id] = v;
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(undefined);
    const body: ScheduleInput = {
      frequency,
      dayOfWeek: frequency === 'weekly' ? Number(dayOfWeek) : null,
      dayOfMonth: frequency === 'monthly' ? Number(dayOfMonth) : null,
      outputFormat,
      params,
    };
    try {
      if (existing) await updateSchedule(existing.id, body);
      else await createSchedule(reportId, body);
      onSaved();
      onClose();
    } catch {
      setError(t('reports.scheduling.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle>{existing ? t('reports.scheduling.edit') : t('reports.scheduling.new')}</DialogTitle>
        <div className="flex flex-col gap-3 py-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs uppercase text-muted-foreground">{t('reports.scheduling.frequency')}</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as ScheduleInput['frequency'])}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">{t('reports.scheduling.daily')}</SelectItem>
                <SelectItem value="weekly">{t('reports.scheduling.weekly')}</SelectItem>
                <SelectItem value="monthly">{t('reports.scheduling.monthly')}</SelectItem>
                <SelectItem value="quarterly">{t('reports.scheduling.quarterly')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {frequency === 'weekly' && (
            <div className="flex flex-col gap-1">
              <Label className="text-xs uppercase text-muted-foreground">{t('reports.scheduling.dayOfWeek')}</Label>
              <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((d) => <SelectItem key={d.value} value={d.value}>{d.key}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {frequency === 'monthly' && (
            <div className="flex flex-col gap-1">
              <Label className="text-xs uppercase text-muted-foreground">{t('reports.scheduling.dayOfMonth')}</Label>
              <Select value={dayOfMonth} onValueChange={setDayOfMonth}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 28 }, (_, i) => String(i + 1)).map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label className="text-xs uppercase text-muted-foreground">{t('reports.scheduling.outputFormat')}</Label>
            <Select value={outputFormat} onValueChange={(v) => setOutputFormat(v as ScheduleInput['outputFormat'])}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="xlsx">XLSX</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {paramFields.map((p) => (
            <div key={p.id} className="flex flex-col gap-1">
              <Label className="text-xs uppercase text-muted-foreground">{p.label}</Label>
              {p.type === 'select' ? (
                <Select
                  value={params[p.id] ?? ALL}
                  onValueChange={(v) => setParam(p.id, v === ALL ? undefined : v)}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('reports.all')}</SelectItem>
                    {(p.optionsKey ? options[p.optionsKey] ?? [] : []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input className="h-9" value={params[p.id] ?? ''} onChange={(e) => setParam(p.id, e.target.value)} placeholder={p.label} />
              )}
            </div>
          ))}

          <p className="text-xs text-muted-foreground">{t('reports.scheduling.dateWindowAuto')}</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t('reports.scheduling.cancel')}</Button>
          <Button onClick={handleSave} disabled={saving}>{t('reports.scheduling.save')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
