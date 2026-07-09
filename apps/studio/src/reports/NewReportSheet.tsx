import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listReportDesigns, type ReportCategory } from '../api';
import type { ReportDesign } from '@openldr/report-designer/pure';
import { queryApi } from '../query/api';
import type { CustomQuery } from '../query/custom-query-types';
import { createReportDef } from './reportDefsApi';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const CATEGORIES: ReportCategory[] = ['amr', 'operational', 'quality', 'regulatory'];

function newId(): string {
  const rand = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return `r-${rand}`;
}

/** The queryId bound to the first table element found in the design, if any. */
function firstBoundQueryId(design: ReportDesign | undefined): string {
  if (!design) return '';
  for (const page of design.pages) {
    for (const el of page.elements) {
      if (el.kind === 'table' && el.dataSource) return el.dataSource.queryId;
    }
  }
  return '';
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
  /** Pre-select a template (e.g. "Publish as report" from the designer). */
  initialDesignId?: string;
}

export function NewReportSheet({ open, onOpenChange, onCreated, initialDesignId }: Props): JSX.Element {
  const { t } = useTranslation();
  const [designs, setDesigns] = useState<ReportDesign[]>([]);
  const [queries, setQueries] = useState<CustomQuery[]>([]);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ReportCategory>('operational');
  const [description, setDescription] = useState('');
  const [designId, setDesignId] = useState('');
  const [primaryQueryId, setPrimaryQueryId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setName('');
    setCategory('operational');
    setDescription('');
    setError(undefined);
    Promise.all([listReportDesigns(), queryApi.list()])
      .then(([ds, qs]) => {
        setDesigns(ds);
        setQueries(qs);
        const initial = (initialDesignId && ds.some((d) => d.id === initialDesignId)) ? initialDesignId : ds[0]?.id ?? '';
        setDesignId(initial);
        setPrimaryQueryId(firstBoundQueryId(ds.find((d) => d.id === initial)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDesignId]);

  const selectedDesign = useMemo(() => designs.find((d) => d.id === designId), [designs, designId]);

  const handleDesignChange = (id: string) => {
    setDesignId(id);
    setPrimaryQueryId(firstBoundQueryId(designs.find((d) => d.id === id)));
  };

  const canCreate = name.trim().length > 0 && designId.length > 0 && primaryQueryId.length > 0 && !saving;

  const handleCreate = async () => {
    if (!canCreate) return;
    setSaving(true);
    setError(undefined);
    try {
      await createReportDef({
        id: newId(),
        name: name.trim(),
        description: description.trim(),
        category,
        designId,
        primaryQueryId,
        status: 'published',
      });
      onCreated();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full max-w-md flex-col gap-0 border-b-0 p-0">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('reports.new.title')}</SheetTitle>
          <SheetDescription>{t('reports.new.subtitle')}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="newReportName" className="text-xs uppercase text-muted-foreground">{t('reports.new.name')}</Label>
            <Input id="newReportName" className="h-9" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="newReportCategory" className="text-xs uppercase text-muted-foreground">{t('reports.new.category')}</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as ReportCategory)}>
              <SelectTrigger id="newReportCategory" className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{t(`reports.categories.${c}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="newReportDescription" className="text-xs uppercase text-muted-foreground">{t('reports.new.description')}</Label>
            <Textarea id="newReportDescription" className="min-h-[60px] text-sm" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="newReportTemplate" className="text-xs uppercase text-muted-foreground">{t('reports.new.template')}</Label>
            <Select value={designId} onValueChange={handleDesignChange}>
              <SelectTrigger id="newReportTemplate" className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {designs.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="newReportQuery" className="text-xs uppercase text-muted-foreground">{t('reports.new.primaryQuery')}</Label>
            <Select value={primaryQueryId} onValueChange={setPrimaryQueryId}>
              <SelectTrigger id="newReportQuery" className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {queries.map((q) => <SelectItem key={q.id} value={q.id}>{q.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase text-muted-foreground">{t('reports.new.filtersPreview')}</span>
            {selectedDesign && selectedDesign.parameters.length > 0 ? (
              <ul className="flex flex-col gap-1 rounded-md border border-border p-2 text-sm">
                {selectedDesign.parameters.map((p) => <li key={p.key}>{p.label}</li>)}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">{t('reports.new.noFilters')}</p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <SheetFooter className="border-t border-border px-6 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('reports.new.cancel')}</Button>
          <Button onClick={() => { void handleCreate(); }} disabled={!canCreate}>{t('reports.new.create')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
