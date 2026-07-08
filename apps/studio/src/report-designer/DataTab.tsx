import { useTranslation } from 'react-i18next';
import { Table2, CheckCircle2 } from 'lucide-react';
import type { ReportTemplate } from './types';
import { reportsOnPage } from './model';

interface Props { template: ReportTemplate; }

export function DataTab({ template }: Props): JSX.Element {
  const { t } = useTranslation();
  const reports = [...new Set(template.pages.flatMap((p) => reportsOnPage(p)))];
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.reportsInTemplate')}</div>
      {reports.length === 0 && <p className="text-xs text-muted-foreground">{t('reportDesigner.noReports')}</p>}
      {reports.map((r) => (
        <div key={r} className="flex items-center justify-between rounded-md border border-border px-2 py-1.5 text-xs">
          <span className="flex items-center gap-1.5"><Table2 className="h-3.5 w-3.5 text-muted-foreground" /> {r}</span>
          <span className="flex items-center gap-1 text-[10px] text-emerald-600"><CheckCircle2 className="h-3 w-3" /> {t('reportDesigner.ready')}</span>
        </div>
      ))}

      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.parameters')}</div>
      {template.parameters.length === 0 && <p className="text-xs text-muted-foreground">{t('reportDesigner.noParameters')}</p>}
      {template.parameters.map((pm) => (
        <div key={pm.key}>
          <div className="mb-1 text-[10px] text-muted-foreground">{pm.label}</div>
          <div className="flex h-8 items-center rounded-md border border-border bg-muted/30 px-2 text-xs">{pm.value}</div>
        </div>
      ))}
    </div>
  );
}
